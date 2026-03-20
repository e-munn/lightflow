"""FastAPI visualizer server for the LightFlow model.

Serves a browser-based visualizer with 6 pulsing lights driven by model predictions.

Routes:
    /       — File-playback visualizer (existing)
    /live   — Live mic → Canvas light show
    /ws/predict — WebSocket for file playback predictions
    /ws/live    — WebSocket broadcasting live mic predictions

Usage:
    uvicorn visualizer.server:app --port 8001
"""

import asyncio
import json
import threading
import time
from math import gcd
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from src.dataset import STEM_CHANNELS
from src.features import AudioFeatureExtractor
from src.model import build_model

app = FastAPI(title="LightFlow Visualizer")

# Globals populated on startup
_model = None
_config = None
_extractor = None
_device = None
_track_audio = {}  # track_name -> numpy array
_data_dir = Path("data")
_checkpoint_path = Path("checkpoints/best.pt")

# Live mic globals
_live_clients: list[WebSocket] = []
_live_clients_lock = threading.Lock()
_mic_thread: threading.Thread | None = None
_mic_running = False


def _get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _mic_capture_loop():
    """Background thread: mic → ring buffer → model → broadcast to WebSocket clients."""
    try:
        import pyaudio
    except ImportError:
        print("WARNING: pyaudio not installed — live mic disabled")
        return

    from scipy.signal import resample_poly

    # Load model in this thread to avoid MPS cross-thread issues
    device = _get_device()
    checkpoint = torch.load(_checkpoint_path, map_location=device, weights_only=False)
    config = checkpoint["config"]
    model = build_model(config).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    extractor = AudioFeatureExtractor(config)

    audio_cfg = config["audio"]
    model_sr = audio_cfg["sample_rate"]  # 22050
    window_sec = audio_cfg["window_seconds"]
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]

    capture_sr = 44100
    capture_window = int(window_sec * capture_sr)
    chunk_size = 2048

    # Resampling ratio
    g = gcd(capture_sr, model_sr)
    up, down = model_sr // g, capture_sr // g

    # Ring buffer
    ring_buf = np.zeros(capture_window, dtype=np.float32)
    ring_lock = threading.Lock()
    mic_rms = [0.0]

    def audio_callback(in_data, frame_count, time_info, status):
        nonlocal ring_buf
        audio = np.frombuffer(in_data, dtype=np.float32)
        rms = float(np.sqrt(np.mean(audio ** 2)))
        with ring_lock:
            mic_rms[0] = rms
            ring_buf = np.roll(ring_buf, -len(audio))
            ring_buf[-len(audio):] = audio
        return (None, pyaudio.paContinue)

    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paFloat32,
        channels=1,
        rate=capture_sr,
        input=True,
        frames_per_buffer=chunk_size,
        stream_callback=audio_callback,
    )
    stream.start_stream()
    print(f"Mic capture started (capture={capture_sr}Hz -> model={model_sr}Hz, window={window_sec}s)")

    try:
        while _mic_running and stream.is_active():
            t0 = time.time()

            # Grab latest audio
            with ring_lock:
                raw = ring_buf.copy()
                rms_level = mic_rms[0]

            # Resample 44100 -> 22050
            audio = resample_poly(raw, up, down).astype(np.float32)

            # Predict
            features = extractor.extract_fast(audio)
            feature_array = extractor.concat_features(features)

            with torch.no_grad():
                tensor = torch.from_numpy(feature_array).float().unsqueeze(0).to(device)
                prediction = model(tensor).cpu().numpy()[0]

            elapsed_ms = (time.time() - t0) * 1000
            channels = {ch: round(float(prediction[i]), 4) for i, ch in enumerate(channel_names)}
            payload = json.dumps({
                "channels": channels,
                "latency_ms": round(elapsed_ms, 1),
                "mic_rms": round(rms_level, 4),
            })

            # Broadcast to all connected /ws/live clients
            with _live_clients_lock:
                stale = []
                for ws in _live_clients:
                    try:
                        asyncio.run_coroutine_threadsafe(ws.send_text(payload), _loop)
                    except Exception:
                        stale.append(ws)
                for ws in stale:
                    _live_clients.remove(ws)

            # ~10Hz inference rate
            sleep_time = max(0, 0.1 - (time.time() - t0))
            time.sleep(sleep_time)

    except Exception as e:
        print(f"Mic thread error: {e}")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        print("Mic capture stopped")


# Reference to the asyncio event loop (set on startup)
_loop: asyncio.AbstractEventLoop = None


@app.on_event("startup")
def startup():
    global _model, _config, _extractor, _device, _track_audio
    global _mic_thread, _mic_running, _loop

    _loop = asyncio.get_event_loop()
    _device = _get_device()
    print(f"Visualizer using device: {_device}")

    if _checkpoint_path.exists():
        checkpoint = torch.load(_checkpoint_path, map_location=_device, weights_only=False)
        _config = checkpoint["config"]
        _model = build_model(_config).to(_device)
        _model.load_state_dict(checkpoint["model_state_dict"])
        _model.eval()
        _extractor = AudioFeatureExtractor(_config)
        print(f"Loaded model from {_checkpoint_path}")
    else:
        print(f"WARNING: No checkpoint at {_checkpoint_path} — predictions will be zeros")

    # Pre-load track audio into memory
    if _data_dir.exists():
        import librosa
        sr = _config["audio"]["sample_rate"] if _config else 22050
        for track_dir in sorted(_data_dir.iterdir()):
            if not track_dir.is_dir():
                continue
            audio_file = track_dir / "audio.wav"
            if audio_file.exists():
                y, _ = librosa.load(audio_file, sr=sr, mono=True)
                _track_audio[track_dir.name] = y
                print(f"  Loaded {track_dir.name}: {len(y)/sr:.1f}s")
        print(f"Loaded {len(_track_audio)} tracks into memory")

    # Start mic capture thread if checkpoint exists
    if _checkpoint_path.exists():
        _mic_running = True
        _mic_thread = threading.Thread(target=_mic_capture_loop, daemon=True)
        _mic_thread.start()


@app.on_event("shutdown")
def shutdown():
    global _mic_running
    _mic_running = False


@app.get("/", response_class=HTMLResponse)
def index():
    html_path = Path(__file__).parent / "index.html"
    return HTMLResponse(html_path.read_text())


@app.get("/live", response_class=HTMLResponse)
def live():
    html_path = Path(__file__).parent / "live.html"
    return HTMLResponse(html_path.read_text())


@app.get("/api/tracks")
def list_tracks():
    tracks = []
    if _data_dir.exists():
        for track_dir in sorted(_data_dir.iterdir()):
            if not track_dir.is_dir():
                continue
            audio_file = track_dir / "audio.wav"
            labels_file = track_dir / "labels.json"
            if audio_file.exists():
                info = {"name": track_dir.name, "has_labels": labels_file.exists()}
                if labels_file.exists():
                    with open(labels_file) as f:
                        data = json.load(f)
                    info["duration"] = data.get("duration", 0)
                tracks.append(info)
    return JSONResponse(tracks)


@app.get("/api/tracks/{track_name}/audio")
def get_audio(track_name: str):
    audio_path = _data_dir / track_name / "audio.wav"
    if not audio_path.exists():
        return JSONResponse({"error": "Track not found"}, status_code=404)
    return FileResponse(audio_path, media_type="audio/wav")


@app.get("/api/tracks/{track_name}/labels")
def get_labels(track_name: str):
    labels_path = _data_dir / track_name / "labels.json"
    if not labels_path.exists():
        return JSONResponse({"error": "Labels not found"}, status_code=404)
    with open(labels_path) as f:
        data = json.load(f)
    return JSONResponse(data)


@app.websocket("/ws/predict")
async def predict_ws(websocket: WebSocket):
    await websocket.accept()
    output_dim = _config["model"]["output_dim"] if _config else 6
    channel_names = STEM_CHANNELS[:output_dim]
    sr = _config["audio"]["sample_rate"] if _config else 22050
    window_sec = _config["audio"]["window_seconds"] if _config else 0.5
    window_samples = int(window_sec * sr)

    try:
        while True:
            msg = await websocket.receive_json()
            track = msg.get("track", "")
            time_sec = msg.get("time", 0.0)

            if _model is None or track not in _track_audio:
                # Return zeros if no model or track
                result = {ch: 0.0 for ch in channel_names}
                await websocket.send_json({"time": time_sec, "channels": result})
                continue

            # Extract window centered on requested time
            y = _track_audio[track]
            center_sample = int(time_sec * sr)
            start = max(0, center_sample - window_samples // 2)
            end = start + window_samples
            if end > len(y):
                end = len(y)
                start = max(0, end - window_samples)

            window = y[start:end]
            if len(window) < window_samples:
                window = np.pad(window, (0, window_samples - len(window)))

            features = _extractor.extract(window)
            feature_array = _extractor.concat_features(features)

            with torch.no_grad():
                tensor = torch.from_numpy(feature_array).float().unsqueeze(0).to(_device)
                prediction = _model(tensor).cpu().numpy()[0]

            result = {ch: round(float(prediction[i]), 4) for i, ch in enumerate(channel_names)}
            await websocket.send_json({"time": time_sec, "channels": result})

    except WebSocketDisconnect:
        pass


@app.websocket("/ws/live")
async def live_ws(websocket: WebSocket):
    """WebSocket endpoint for live mic predictions. Server pushes at ~10Hz."""
    await websocket.accept()
    with _live_clients_lock:
        _live_clients.append(websocket)
    try:
        # Keep connection alive — client doesn't send anything
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        with _live_clients_lock:
            if websocket in _live_clients:
                _live_clients.remove(websocket)


@app.post("/api/rate")
async def rate_segment(data: dict):
    track = data.get("track", "")
    segment_start = data.get("segment_start", 0)
    rating = data.get("rating", 0)

    ratings_path = _data_dir / track / "ratings.json"
    ratings = []
    if ratings_path.exists():
        with open(ratings_path) as f:
            ratings = json.load(f)

    ratings.append({
        "segment_start": segment_start,
        "rating": rating,
    })

    ratings_path.parent.mkdir(parents=True, exist_ok=True)
    with open(ratings_path, "w") as f:
        json.dump(ratings, f, indent=2)

    return JSONResponse({"status": "ok", "total_ratings": len(ratings)})
