from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import librosa
import librosa.segment
import numpy as np
import scipy.ndimage
import tempfile
import os
import torch
import subprocess
import json
from pathlib import Path

app = FastAPI(title="LightFlow Audio Analyzer")

# Store for stem separation results (in production, use Redis or similar)
stem_results = {}

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


def detect_segments(y: np.ndarray, sr: int) -> list[dict]:
    """
    Detect song sections optimized for dance/electronic music.
    Uses bass ONSET detection - when bass goes from silent to playing.
    This is the key marker for section changes in EDM.
    """
    from scipy.signal import find_peaks

    duration = librosa.get_duration(y=y, sr=sr)
    hop_length = 2048  # ~10 fps at 22050 sr

    # Get RMS energy
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms = rms / (rms.max() + 1e-6)

    # Get low frequency energy (bass/kick) - 20-150 Hz
    S = np.abs(librosa.stft(y, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr)
    bass_mask = (freqs >= 20) & (freqs <= 150)
    bass_energy = S[bass_mask, :].sum(axis=0)
    bass_energy = bass_energy / (bass_energy.max() + 1e-6)

    # Smooth bass energy with longer window for stable detection
    smooth_window = int(sr / hop_length)  # ~1 second smoothing
    bass_smooth = scipy.ndimage.uniform_filter1d(bass_energy, smooth_window)

    # KEY: Detect bass ONSETS - when bass goes from low to high
    # This is different from just finding changes
    bass_threshold = 0.25  # Bass is "present" above this level

    # Find where bass crosses threshold (onset = rising edge)
    bass_active = bass_smooth > bass_threshold
    bass_onset = np.diff(bass_active.astype(int))  # 1 = onset, -1 = dropout

    # Get onset and dropout positions
    onset_frames = np.where(bass_onset == 1)[0]
    dropout_frames = np.where(bass_onset == -1)[0]

    # Also detect overall energy changes for non-bass sections
    rms_smooth = scipy.ndimage.uniform_filter1d(rms, smooth_window)
    rms_diff = np.gradient(rms_smooth)

    # Find big energy rises (potential buildups/drops)
    energy_peaks, _ = find_peaks(
        np.abs(rms_diff),
        distance=int(8 * sr / hop_length),  # Min 8 seconds apart
        prominence=0.05
    )

    # Combine all boundary candidates
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

    # Priority: bass onsets > bass dropouts > energy changes
    all_boundaries = set()

    # Add bass onsets (highest priority - these define drops)
    for frame in onset_frames:
        if frame < len(times):
            all_boundaries.add(times[frame])

    # Add bass dropouts (breakdowns)
    for frame in dropout_frames:
        if frame < len(times):
            all_boundaries.add(times[frame])

    # Add energy peaks if they're not too close to bass events
    min_gap = 4.0  # seconds
    for frame in energy_peaks:
        if frame < len(times):
            t = times[frame]
            # Only add if not near existing boundary
            if len(all_boundaries) == 0 or all(abs(t - b) > min_gap for b in all_boundaries):
                all_boundaries.add(t)

    # Sort and filter boundaries
    boundaries = sorted([0.0] + list(all_boundaries) + [duration])

    # Merge boundaries that are too close together (< 6 seconds)
    merged = [boundaries[0]]
    for b in boundaries[1:]:
        if b - merged[-1] >= 6.0:
            merged.append(b)
        elif b == duration:
            merged[-1] = b  # Always include end
    boundaries = merged

    # Build segments with labels based on bass presence
    segments = []
    for i in range(len(boundaries) - 1):
        start_time = boundaries[i]
        end_time = boundaries[i + 1]

        start_frame = int(start_time * sr / hop_length)
        end_frame = min(int(end_time * sr / hop_length), len(bass_smooth))

        if start_frame < end_frame:
            avg_bass = bass_smooth[start_frame:end_frame].mean()
            avg_energy = rms_smooth[start_frame:end_frame].mean()
        else:
            avg_bass = 0
            avg_energy = 0

        # Label based on bass presence:
        # 0 = intro/outro (low energy overall)
        # 1 = breakdown (bass drops out)
        # 2 = buildup (no bass yet, building energy)
        # 3 = drop (bass is present and strong)
        if avg_energy < 0.2:
            label = 0  # intro/outro
        elif avg_bass < 0.2:
            label = 1 if avg_energy > 0.3 else 2  # breakdown or buildup
        elif avg_bass > 0.4:
            label = 3  # drop (bass is pumping)
        else:
            label = 2  # transitional

        segments.append({
            "start": round(start_time, 3),
            "end": round(end_time, 3),
            "label": label
        })

    print(f"Detected {len(segments)} sections in {duration:.1f}s (bass onsets: {len(onset_frames)}, dropouts: {len(dropout_frames)})")
    return segments


@app.post("/analyze")
async def analyze_audio(file: UploadFile = File(...)):
    """
    Analyze an audio file and return:
    - BPM
    - Beat times (in seconds)
    - Energy envelope over time
    - Duration
    """
    # Save uploaded file temporarily
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load audio with librosa
        y, sr = librosa.load(tmp_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)

        # Beat tracking
        tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        # Handle tempo - it might be an array
        if isinstance(tempo, np.ndarray):
            bpm = float(tempo[0]) if len(tempo) > 0 else 120.0
        else:
            bpm = float(tempo)

        # Energy envelope (RMS) - resample to ~30 points per second for reasonable size
        hop_length = int(sr / 30)  # ~30 fps
        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]

        # Normalize RMS to 0-1
        rms_max = rms.max() + 1e-6
        rms_normalized = rms / rms_max

        # Time points for energy
        energy_times = librosa.frames_to_time(
            np.arange(len(rms)), sr=sr, hop_length=hop_length
        )

        # Create energy data as list of {time, value} for D3
        energy = [
            {"time": float(t), "value": float(v)}
            for t, v in zip(energy_times, rms_normalized)
        ]

        # === VIBE METRICS ===

        # 1. Intensity - smoothed RMS energy
        # Use a longer window for smoother intensity curve
        intensity_window = int(sr * 0.5)  # 0.5 second window
        intensity_rms = librosa.feature.rms(y=y, hop_length=hop_length, frame_length=intensity_window)[0]
        intensity_normalized = intensity_rms / (intensity_rms.max() + 1e-6)

        # 2. Buildup - derivative of smoothed energy (positive = building up)
        # Smooth the energy first with a rolling mean
        window_size = min(30, len(rms_normalized))  # ~1 second at 30fps
        if window_size > 1:
            kernel = np.ones(window_size) / window_size
            smoothed_energy = np.convolve(rms_normalized, kernel, mode='same')
        else:
            smoothed_energy = rms_normalized

        # Calculate derivative (rate of change)
        buildup_raw = np.gradient(smoothed_energy)
        # Normalize to 0-1 range (0.5 = neutral, >0.5 = building, <0.5 = dropping)
        buildup_range = max(abs(buildup_raw.min()), abs(buildup_raw.max())) + 1e-6
        buildup_normalized = (buildup_raw / buildup_range + 1) / 2

        # 3. Complexity - spectral flatness (how noise-like vs tonal)
        spectral_flatness = librosa.feature.spectral_flatness(y=y, hop_length=hop_length)[0]
        # Also add spectral centroid variation for rhythmic complexity
        spectral_centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
        centroid_normalized = spectral_centroid / (spectral_centroid.max() + 1e-6)

        # Combine flatness and centroid variation for complexity metric
        complexity_normalized = (spectral_flatness + centroid_normalized) / 2
        complexity_normalized = complexity_normalized / (complexity_normalized.max() + 1e-6)

        # Create vibe data arrays
        intensity = [
            {"time": float(t), "value": float(v)}
            for t, v in zip(energy_times, intensity_normalized)
        ]

        buildup = [
            {"time": float(t), "value": float(v)}
            for t, v in zip(energy_times, buildup_normalized)
        ]

        complexity = [
            {"time": float(t), "value": float(v)}
            for t, v in zip(energy_times, complexity_normalized)
        ]

        # === SONG SECTIONS ===
        segments = detect_segments(y, sr)

        return JSONResponse({
            "success": True,
            "duration": duration,
            "bpm": round(bpm, 1),
            "beats": beat_times,
            "energy": energy,
            "intensity": intensity,
            "buildup": buildup,
            "complexity": complexity,
            "segments": segments,
        })

    except Exception as e:
        import traceback
        print(f"ERROR in /analyze: {e}")
        traceback.print_exc()
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )

    finally:
        # Clean up temp file
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


def compute_stem_energy(audio_path: str, sr: int = 22050) -> list:
    """Compute energy envelope for a stem audio file."""
    y, _ = librosa.load(audio_path, sr=sr, mono=True)
    hop_length = int(sr / 30)  # ~30 fps
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_normalized = rms / (rms.max() + 1e-6)
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    return [{"time": float(t), "value": float(v)} for t, v in zip(times, rms_normalized)]


def run_stem_separation(job_id: str, audio_path: str, output_dir: str):
    """Background task to run Demucs stem separation.
    Returns stems progressively: bass first, then drums, then vocals.
    Skips 'other' stem as it's not useful for dance music analysis.
    """
    try:
        stem_results[job_id] = {"status": "processing", "progress": 0, "stems": {}, "stem_names": []}

        import demucs.separate

        # Load audio
        y, sr = librosa.load(audio_path, sr=44100, mono=False)
        if y.ndim == 1:
            y = np.stack([y, y])  # Convert mono to stereo

        # Convert to torch tensor
        audio_tensor = torch.from_numpy(y).float().unsqueeze(0)  # [1, 2, samples]

        # Load model
        from demucs.pretrained import get_model
        stem_results[job_id]["progress"] = 10
        model = get_model('htdemucs')
        model.eval()

        # Run separation
        stem_results[job_id]["progress"] = 20
        with torch.no_grad():
            sources = demucs.separate.apply_model(model, audio_tensor, shifts=1, overlap=0.25)

        # sources shape: [1, num_sources, 2, samples]
        # htdemucs sources order: drums, bass, other, vocals
        source_names = model.sources  # ['drums', 'bass', 'other', 'vocals']

        # Process in priority order: bass -> drums -> vocals (skip other)
        priority_order = ['bass', 'drums', 'vocals']
        hop_length = int(sr / 30)  # ~30 fps

        for idx, stem_name in enumerate(priority_order):
            if stem_name in source_names:
                source_idx = source_names.index(stem_name)
                source_audio = sources[0, source_idx].mean(dim=0).numpy()  # Stereo to mono

                # Compute energy envelope
                rms = librosa.feature.rms(y=source_audio, hop_length=hop_length)[0]
                rms_normalized = rms / (rms.max() + 1e-6)
                times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

                stem_data = [{"time": float(t), "value": float(v)} for t, v in zip(times, rms_normalized)]

                # Update results progressively
                stem_results[job_id]["stems"][stem_name] = stem_data
                stem_results[job_id]["stem_names"].append(stem_name)
                stem_results[job_id]["progress"] = 40 + (idx + 1) * 20

        stem_results[job_id]["status"] = "complete"
        stem_results[job_id]["progress"] = 100

    except Exception as e:
        import traceback
        stem_results[job_id] = {
            "status": "error",
            "error": f"{str(e)}\n{traceback.format_exc()}"
        }

    finally:
        # Clean up temp files
        try:
            import shutil
            shutil.rmtree(output_dir, ignore_errors=True)
        except:
            pass


@app.post("/separate")
async def separate_stems(
    file: UploadFile = File(...),
    background_tasks: BackgroundTasks = None
):
    """
    Start stem separation job. Returns a job_id to poll for results.
    Separates audio into: drums, bass, vocals, other
    """
    import uuid
    job_id = str(uuid.uuid4())

    # Save uploaded file
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    tmp_dir = tempfile.mkdtemp()
    tmp_path = os.path.join(tmp_dir, f"input{suffix}")

    with open(tmp_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Start background task
    stem_results[job_id] = {"status": "queued"}
    background_tasks.add_task(run_stem_separation, job_id, tmp_path, tmp_dir)

    return JSONResponse({
        "success": True,
        "job_id": job_id,
        "message": "Stem separation started. Poll /separate/status/{job_id} for results."
    })


@app.get("/separate/status/{job_id}")
async def get_separation_status(job_id: str):
    """Get the status of a stem separation job."""
    if job_id not in stem_results:
        return JSONResponse(
            {"success": False, "error": "Job not found"},
            status_code=404
        )

    result = stem_results[job_id]
    return JSONResponse({
        "success": True,
        **result
    })


@app.post("/ml/analyze")
async def ml_analyze_audio(file: UploadFile = File(...)):
    """
    Run ML-based audio analysis using TensorFlow/YAMNet.

    Returns:
    - events: Top audio event classifications
    - instruments: Detected instrument presence scores
    """
    from ml_analysis import analyze_audio_events, get_instrument_presence

    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        y, sr = librosa.load(tmp_path, sr=16000, mono=True)

        # Get audio events and instrument presence
        events_result = analyze_audio_events(y, sr, top_k=15)
        instruments = get_instrument_presence(y, sr)

        return JSONResponse({
            "success": True,
            "events": events_result["events"],
            "instruments": instruments,
        })

    except Exception as e:
        import traceback
        print(f"ERROR in /ml/analyze: {e}")
        traceback.print_exc()
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.get("/ml/status")
async def ml_status():
    """Check if ML models are loaded and ready."""
    try:
        from ml_analysis import get_yamnet
        model, classes = get_yamnet()
        return JSONResponse({
            "success": True,
            "yamnet": {
                "loaded": True,
                "classes": len(classes)
            }
        })
    except Exception as e:
        return JSONResponse({
            "success": True,
            "yamnet": {
                "loaded": False,
                "error": str(e)
            }
        })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
