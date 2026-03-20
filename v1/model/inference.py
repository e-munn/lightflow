"""Inference: audio → 6-channel stem energy predictions.

Modes:
  --mode file   : Process an audio file, print per-frame predictions
  --mode live   : Real-time mic input → predictions (print or WebSocket)
  --mode stream : Continuous file playback → WebSocket for visualizer

Usage:
    python inference.py --checkpoint checkpoints/best.pt --audio track.wav
    python inference.py --checkpoint checkpoints/best.pt --mode live
    python inference.py --checkpoint checkpoints/best.pt --mode live --output websocket
"""

import argparse
import time
from pathlib import Path

import numpy as np
import torch

from src.dataset import STEM_CHANNELS
from src.features import AudioFeatureExtractor
from src.model import build_model


def load_model(checkpoint_path: str, device: torch.device):
    """Load a trained model from checkpoint."""
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    config = checkpoint["config"]
    model = build_model(config).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, config


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


class StreamingPredictor:
    """Wraps a StreamingGRU model with hidden state management and gate logic.

    Maintains GRU hidden state across calls, resets on silence detection
    (gate < threshold for consecutive frames → song transition).
    """

    def __init__(self, model, extractor, device, channel_names, config):
        self.model = model
        self.extractor = extractor
        self.device = device
        self.channel_names = channel_names
        self.n_future = config["model"].get("n_future", 4)
        self.hop_seconds = config["audio"]["hop_seconds"]

        # Gate/silence tracking
        self.gate_threshold = 0.3
        self.silence_reset_frames = int(2.0 / self.hop_seconds)  # 2s of silence → reset
        self.consecutive_silence = 0

    def predict(self, window: np.ndarray, fast: bool = False) -> dict:
        """Run single-step streaming prediction.

        Args:
            window: raw audio samples for one window

        Returns:
            dict with 'channels', 'future', 'gate', 'latency_ms'
        """
        features = self.extractor.extract_fast(window) if fast else self.extractor.extract(window)
        feature_array = self.extractor.concat_features(features)
        # Global pool to single vector (matching training cache format)
        feature_vec = feature_array.mean(axis=0, keepdims=True)  # (1, 143)

        with torch.no_grad():
            # predict_step expects (1, time_frames, feat_dim)
            tensor = torch.from_numpy(feature_vec).float().unsqueeze(0).to(self.device)
            result = self.model.predict_step(tensor, self.device)

        energy = result["energy"].cpu().numpy()
        future = result["future"].cpu().numpy()
        gate = float(result["gate"].cpu())

        # Gate logic: detect silence and reset hidden state
        if gate < self.gate_threshold:
            self.consecutive_silence += 1
            if self.consecutive_silence >= self.silence_reset_frames:
                self.model.reset_hidden()
                self.consecutive_silence = 0
        else:
            self.consecutive_silence = 0

        channels = {ch: float(energy[i]) for i, ch in enumerate(self.channel_names)}

        # Future predictions: list of dicts at each horizon
        future_list = []
        for f in range(self.n_future):
            horizon_ms = (f + 1) * self.hop_seconds * 1000
            future_list.append({
                "horizon_ms": horizon_ms,
                "channels": {ch: float(future[f, i]) for i, ch in enumerate(self.channel_names)},
            })

        return {
            "channels": channels,
            "future": future_list,
            "gate": gate,
        }

    def reset(self):
        """Manually reset state (e.g., new song loaded)."""
        self.model.reset_hidden()
        self.consecutive_silence = 0


def predict_window(model, extractor, window: np.ndarray, device, channel_names,
                    fast: bool = False):
    """Run prediction on a single audio window. Returns dict of channel values."""
    features = extractor.extract_fast(window) if fast else extractor.extract(window)
    feature_array = extractor.concat_features(features)

    with torch.no_grad():
        tensor = torch.from_numpy(feature_array).float().unsqueeze(0).to(device)
        prediction = model(tensor).cpu().numpy()[0]

    return {ch: float(prediction[i]) for i, ch in enumerate(channel_names)}


def run_file(audio_path: str, checkpoint_path: str):
    """Run inference on an audio file, printing 6 named channel values per frame."""
    import librosa

    device = get_device()
    model, config = load_model(checkpoint_path, device)
    extractor = AudioFeatureExtractor(config)

    audio_cfg = config["audio"]
    sr = audio_cfg["sample_rate"]
    window_sec = audio_cfg["window_seconds"]
    hop_sec = audio_cfg["hop_seconds"]
    window_samples = int(window_sec * sr)
    hop_samples = int(hop_sec * sr)
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]
    is_streaming = config["model"]["type"] == "streaming_gru"

    y, _ = librosa.load(audio_path, sr=sr, mono=True)
    print(f"Loaded {audio_path} ({len(y)/sr:.1f}s)")
    print(f"Model: {config['model']['type']}")
    print(f"Channels: {', '.join(channel_names)}\n")

    if is_streaming:
        predictor = StreamingPredictor(model, extractor, device, channel_names, config)

    pos = 0
    frame = 0
    while pos + window_samples <= len(y):
        window = y[pos:pos + window_samples]
        current_time = pos / sr

        if is_streaming:
            result = predictor.predict(window)
            vals = [f"{name}={result['channels'][name]:.3f}" for name in channel_names]
            gate_str = f"gate={result['gate']:.2f}"
            print(f"  t={current_time:6.2f}s  {', '.join(vals)}  {gate_str}")
        else:
            values = predict_window(model, extractor, window, device, channel_names)
            vals = [f"{name}={values[name]:.3f}" for name in channel_names]
            print(f"  t={current_time:6.2f}s  {', '.join(vals)}")

        pos += hop_samples
        frame += 1

    print(f"\nProcessed {frame} frames")


def run_live(checkpoint_path: str, output_mode: str = "print"):
    """Real-time mic input → 6 stem energy channels.

    Uses threaded audio capture at native sample rate with a ring buffer
    so predictions always use the freshest audio.
    """
    try:
        import pyaudio
    except ImportError:
        print("pyaudio is required for live mode. Install with: pip install pyaudio")
        return

    import threading
    from scipy.signal import resample_poly
    from math import gcd

    device = get_device()
    model, config = load_model(checkpoint_path, device)
    extractor = AudioFeatureExtractor(config)

    audio_cfg = config["audio"]
    model_sr = audio_cfg["sample_rate"]  # 22050
    window_sec = audio_cfg["window_seconds"]
    window_samples = int(window_sec * model_sr)
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]

    # Capture at native rate, resample to model rate
    capture_sr = 44100
    capture_window = int(window_sec * capture_sr)
    chunk_size = 2048  # small chunks for low-latency capture

    # Ring buffer: holds last window_sec of audio at capture_sr
    ring_buf = np.zeros(capture_window, dtype=np.float32)
    ring_lock = threading.Lock()
    mic_rms = [0.0]  # shared mic level for display

    def audio_callback(in_data, frame_count, time_info, status):
        nonlocal ring_buf
        audio = np.frombuffer(in_data, dtype=np.float32)
        rms = float(np.sqrt(np.mean(audio ** 2)))
        with ring_lock:
            mic_rms[0] = rms
            # Shift ring buffer left and append new audio
            ring_buf = np.roll(ring_buf, -len(audio))
            ring_buf[-len(audio):] = audio
        return (None, pyaudio.paContinue)

    # Resampling ratio
    g = gcd(capture_sr, model_sr)
    up, down = model_sr // g, capture_sr // g  # 1, 2 for 22050/44100

    # WebSocket connection for visualizer output
    ws = None
    if output_mode == "websocket":
        try:
            import websocket
            ws = websocket.create_connection("ws://localhost:8001/ws/live")
            print("Connected to visualizer WebSocket")
        except Exception as e:
            print(f"Could not connect to WebSocket: {e}")
            print("Falling back to print mode")
            output_mode = "print"

    # Start audio capture with callback
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

    is_streaming = config["model"]["type"] == "streaming_gru"
    if is_streaming:
        predictor = StreamingPredictor(model, extractor, device, channel_names, config)

    print(f"Listening on microphone (window={window_sec}s, capture={capture_sr}Hz → model={model_sr}Hz)")
    print(f"Model: {config['model']['type']}")
    print(f"Output: {output_mode}")
    print(f"Channels: {', '.join(channel_names)}")
    print("Press Ctrl+C to stop\n")

    try:
        while stream.is_active():
            t0 = time.time()

            # Grab latest audio from ring buffer
            with ring_lock:
                raw = ring_buf.copy()
                rms_level = mic_rms[0]

            # Resample 44100 → 22050
            audio = resample_poly(raw, up, down).astype(np.float32)

            # Predict
            if is_streaming:
                result = predictor.predict(audio, fast=True)
                values = result["channels"]
                gate = result["gate"]
            else:
                values = predict_window(model, extractor, audio, device, channel_names,
                                        fast=True)
                gate = None

            elapsed = time.time() - t0

            if output_mode == "print":
                # Mic level indicator
                mic_bar = "█" * min(int(rms_level * 200), 10)
                mic_str = f"mic:{mic_bar:<10}{rms_level:.4f}"
                bars = []
                for name in channel_names:
                    v = values[name]
                    bar = "█" * int(v * 20) + "░" * (20 - int(v * 20))
                    short = name.replace("_energy", "")
                    bars.append(f"{short:>6}|{bar}|{v:.2f}")
                gate_str = f"  gate={gate:.2f}" if gate is not None else ""
                print(f"[{elapsed*1000:4.0f}ms] {mic_str}  " + "  ".join(bars) + gate_str)

            elif output_mode == "websocket" and ws:
                import json
                msg = {"channels": values, "latency_ms": elapsed * 1000}
                if is_streaming:
                    msg["future"] = result["future"]
                    msg["gate"] = gate
                ws.send(json.dumps(msg))

    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()
        if ws:
            ws.close()


def main():
    parser = argparse.ArgumentParser(description="LightFlow model inference")
    parser.add_argument("--checkpoint", type=str, required=True,
                        help="Path to model checkpoint (.pt)")
    parser.add_argument("--audio", type=str, default=None,
                        help="Path to audio file (for file mode)")
    parser.add_argument("--mode", type=str, default="file",
                        choices=["file", "live"],
                        help="Inference mode")
    parser.add_argument("--output", type=str, default="print",
                        choices=["print", "websocket"],
                        help="Output mode for live inference")
    args = parser.parse_args()

    if args.mode == "file":
        if not args.audio:
            print("Error: --audio required for file mode")
            return
        run_file(args.audio, args.checkpoint)
    elif args.mode == "live":
        run_live(args.checkpoint, args.output)


if __name__ == "__main__":
    main()
