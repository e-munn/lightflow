from fastapi import FastAPI, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import librosa
import librosa.segment
import numpy as np
import scipy.ndimage
import soundfile as sf
import tempfile
import os
import torch
import subprocess
import json
from pathlib import Path

# Load environment variables from .env.local
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).parent.parent / "webapp" / ".env.local"
    if env_path.exists():
        load_dotenv(env_path)
        print(f"Loaded environment from {env_path}")
except ImportError:
    pass  # dotenv not installed, use system env vars

app = FastAPI(title="LightFlow Audio Analyzer")

# CORS for local development - must be added BEFORE mounting static files
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store for stem separation results (in production, use Redis or similar)
stem_results = {}

# Directory for serving stem audio files
STEMS_DIR = Path(__file__).parent / "stems"
STEMS_DIR.mkdir(exist_ok=True)

# Mount static files for stem audio
app.mount("/stems", StaticFiles(directory=str(STEMS_DIR)), name="stems")


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


def detect_bpm_robust(y: np.ndarray, sr: int) -> tuple[float, float]:
    """
    Robust BPM detection using multiple methods and voting.
    Returns (bpm, confidence) where confidence is 0-1.
    """
    # Method 1: Standard beat tracking
    tempo1, _ = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo1, np.ndarray):
        tempo1 = float(tempo1[0]) if len(tempo1) > 0 else 120.0
    else:
        tempo1 = float(tempo1)

    # Method 2: Onset-based tempo with prior for EDM (120-150 typical)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo2 = librosa.feature.tempo(
        onset_envelope=onset_env,
        sr=sr,
        start_bpm=128,  # EDM prior
        std_bpm=20,
        ac_size=8.0,  # Longer autocorrelation window
        max_tempo=180,
        aggregate=None  # Get all estimates
    )

    # Method 3: Tempogram-based (more robust for complex rhythms)
    tempogram = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr)
    tempo_frequencies = librosa.tempo_frequencies(tempogram.shape[0], sr=sr)

    # Find peak in tempogram (average across time)
    mean_tempogram = tempogram.mean(axis=1)
    valid_range = (tempo_frequencies >= 60) & (tempo_frequencies <= 200)
    mean_tempogram_valid = mean_tempogram.copy()
    mean_tempogram_valid[~valid_range] = 0
    tempo3_idx = mean_tempogram_valid.argmax()
    tempo3 = tempo_frequencies[tempo3_idx]

    # Collect all estimates
    estimates = [tempo1, tempo3]
    if isinstance(tempo2, np.ndarray) and len(tempo2) > 0:
        estimates.extend(tempo2.tolist())

    # Filter to reasonable range
    estimates = [t for t in estimates if 60 <= t <= 200]

    if not estimates:
        return 120.0, 0.3  # Fallback

    # Check for tempo halving/doubling issues
    # If estimates cluster around 2x or 0.5x, normalize
    normalized = []
    for t in estimates:
        # Normalize to 80-160 range
        while t > 160:
            t /= 2
        while t < 80:
            t *= 2
        normalized.append(t)

    # Use median for robustness
    final_bpm = float(np.median(normalized))

    # Calculate confidence based on agreement
    deviations = [abs(t - final_bpm) for t in normalized]
    avg_deviation = np.mean(deviations)
    confidence = max(0.3, min(1.0, 1.0 - avg_deviation / 20))

    return round(final_bpm, 1), round(confidence, 2)


@app.post("/bpm")
async def detect_bpm(file: UploadFile = File(...)):
    """
    Fast, accurate BPM detection using multiple methods.
    Returns detected BPM with confidence score.
    """
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load audio
        y, sr = librosa.load(tmp_path, sr=22050, mono=True)

        # Detect BPM
        bpm, confidence = detect_bpm_robust(y, sr)

        return JSONResponse({
            "success": True,
            "bpm": bpm,
            "confidence": confidence,
        })

    except Exception as e:
        import traceback
        print(f"ERROR in /bpm: {e}")
        traceback.print_exc()
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


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


def safe_float(v):
    """Convert to float, replacing NaN/Inf with 0."""
    f = float(v)
    if np.isnan(f) or np.isinf(f):
        return 0.0
    return f


def compute_stem_energy(audio_path: str, sr: int = 22050) -> list:
    """Compute energy envelope for a stem audio file."""
    y, _ = librosa.load(audio_path, sr=sr, mono=True)
    hop_length = int(sr / 30)  # ~30 fps
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms_normalized = rms / (rms.max() + 1e-6)
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    return [{"time": safe_float(t), "value": safe_float(v)} for t, v in zip(times, rms_normalized)]


def detect_rhythmic_patterns(kick_envelope: np.ndarray, snare_envelope: np.ndarray,
                             hats_envelope: np.ndarray, sr: int, hop_length: int,
                             bpm: float) -> dict:
    """
    Detect rhythmic patterns from drum energy envelopes.

    Returns dict with:
    - four_on_floor: bool - kick on every beat
    - backbeat: bool - snare on beats 2 and 4
    - hat_rate: str - "8ths", "16ths", "sparse"
    - syncopation_level: float 0-1 - how much off-beat activity
    - pattern_confidence: float 0-1
    """
    from scipy.signal import find_peaks

    # Calculate samples per beat
    beat_duration_sec = 60.0 / bpm
    samples_per_beat = beat_duration_sec * sr / hop_length

    # Find peaks in each drum track
    kick_peaks, kick_props = find_peaks(kick_envelope, height=0.3, distance=int(samples_per_beat * 0.5))
    snare_peaks, snare_props = find_peaks(snare_envelope, height=0.3, distance=int(samples_per_beat * 0.5))
    hats_peaks, hats_props = find_peaks(hats_envelope, height=0.2, distance=int(samples_per_beat * 0.25))

    # Four-on-floor detection: kick should hit on every beat
    # Check if kick peaks align with quarter notes
    four_on_floor = False
    if len(kick_peaks) > 8:
        # Calculate intervals between kick peaks
        kick_intervals = np.diff(kick_peaks)
        median_interval = np.median(kick_intervals)
        # Should be close to 1 beat
        interval_error = abs(median_interval - samples_per_beat) / samples_per_beat
        four_on_floor = interval_error < 0.15  # Within 15% of beat

    # Backbeat detection: snare on 2 and 4
    # In a 4/4 bar, snare should hit at beat positions 1.0 and 3.0 (0-indexed as 1 and 3)
    backbeat = False
    if len(snare_peaks) > 4:
        snare_intervals = np.diff(snare_peaks)
        median_snare_interval = np.median(snare_intervals)
        # Snare every 2 beats = backbeat
        expected_interval = samples_per_beat * 2
        interval_error = abs(median_snare_interval - expected_interval) / expected_interval
        backbeat = interval_error < 0.2

    # Hat rate detection
    hat_rate = "sparse"
    if len(hats_peaks) > 8:
        hat_intervals = np.diff(hats_peaks)
        median_hat_interval = np.median(hat_intervals)
        if median_hat_interval < samples_per_beat * 0.35:  # 16th notes
            hat_rate = "16ths"
        elif median_hat_interval < samples_per_beat * 0.7:  # 8th notes
            hat_rate = "8ths"
        else:
            hat_rate = "quarters"

    # Syncopation: how much energy is on off-beats vs on-beats
    # Create beat grid
    total_frames = len(kick_envelope)
    beat_positions = np.arange(0, total_frames, samples_per_beat).astype(int)
    beat_positions = beat_positions[beat_positions < total_frames]

    # Sum energy at beat positions vs off-beat positions
    on_beat_energy = 0
    off_beat_energy = 0

    tolerance = int(samples_per_beat * 0.1)  # 10% tolerance for "on beat"

    combined = kick_envelope + snare_envelope * 0.5
    for i in range(total_frames):
        # Check if this position is near a beat
        near_beat = any(abs(i - bp) < tolerance for bp in beat_positions)
        if near_beat:
            on_beat_energy += combined[i]
        else:
            off_beat_energy += combined[i]

    total_energy = on_beat_energy + off_beat_energy + 1e-6
    syncopation_level = off_beat_energy / total_energy

    # Pattern confidence based on how clear the peaks are
    confidence = 0.5
    if len(kick_peaks) > 4:
        kick_std = np.std(np.diff(kick_peaks)) / samples_per_beat
        confidence = max(0.3, min(1.0, 1.0 - kick_std))

    return {
        "four_on_floor": four_on_floor,
        "backbeat": backbeat,
        "hat_rate": hat_rate,
        "syncopation_level": round(float(syncopation_level), 3),
        "pattern_confidence": round(float(confidence), 2),
    }


def detect_song_sections(y: np.ndarray, sr: int, bpm: float) -> list[dict]:
    """
    Detect musical sections with semantic labels for LLM choreography.

    Returns list of sections with:
    - start, end: timestamps
    - label: "intro", "verse", "buildup", "drop", "breakdown", "outro"
    - energy_level: float 0-1
    - bass_presence: float 0-1
    - has_vocals: bool (estimated)
    """
    hop_length = 2048

    # Get energy features
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms = rms / (rms.max() + 1e-6)

    # Get bass energy
    S = np.abs(librosa.stft(y, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr)
    bass_mask = (freqs >= 20) & (freqs <= 150)
    bass_energy = S[bass_mask, :].sum(axis=0)
    bass_energy = bass_energy / (bass_energy.max() + 1e-6)

    # Get mid/vocal frequencies
    vocal_mask = (freqs >= 200) & (freqs <= 4000)
    vocal_energy = S[vocal_mask, :].sum(axis=0)
    vocal_energy = vocal_energy / (vocal_energy.max() + 1e-6)

    # Smooth for section detection
    smooth_window = int(sr / hop_length)  # ~1 second
    bass_smooth = scipy.ndimage.uniform_filter1d(bass_energy, smooth_window)
    rms_smooth = scipy.ndimage.uniform_filter1d(rms, smooth_window)
    vocal_smooth = scipy.ndimage.uniform_filter1d(vocal_energy, smooth_window)

    # Detect changes using bass onset/dropout
    bass_threshold = 0.25
    bass_active = bass_smooth > bass_threshold
    bass_change = np.diff(bass_active.astype(int))

    onset_frames = np.where(bass_change == 1)[0]
    dropout_frames = np.where(bass_change == -1)[0]

    # Combine with energy changes
    rms_diff = np.abs(np.gradient(rms_smooth))
    from scipy.signal import find_peaks
    energy_peaks, _ = find_peaks(rms_diff, distance=int(8 * sr / hop_length), prominence=0.05)

    # Collect boundaries
    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    duration = times[-1] if len(times) > 0 else 0

    boundaries = set([0.0])
    for frame in onset_frames:
        if frame < len(times):
            boundaries.add(times[frame])
    for frame in dropout_frames:
        if frame < len(times):
            boundaries.add(times[frame])
    for frame in energy_peaks:
        if frame < len(times):
            t = times[frame]
            if all(abs(t - b) > 4.0 for b in boundaries):
                boundaries.add(t)
    boundaries.add(duration)

    # Merge close boundaries
    boundaries = sorted(boundaries)
    merged = [boundaries[0]]
    for b in boundaries[1:]:
        if b - merged[-1] >= 6.0:
            merged.append(b)
        elif b == duration:
            merged[-1] = b
    boundaries = merged

    # Build sections with semantic labels
    sections = []
    total_sections = len(boundaries) - 1

    for i in range(total_sections):
        start_time = boundaries[i]
        end_time = boundaries[i + 1]

        start_frame = int(start_time * sr / hop_length)
        end_frame = min(int(end_time * sr / hop_length), len(bass_smooth))

        if start_frame >= end_frame:
            continue

        avg_bass = float(bass_smooth[start_frame:end_frame].mean())
        avg_energy = float(rms_smooth[start_frame:end_frame].mean())
        avg_vocal = float(vocal_smooth[start_frame:end_frame].mean())

        # Energy trend within section (for buildup detection)
        section_energy = rms_smooth[start_frame:end_frame]
        if len(section_energy) > 10:
            first_third = section_energy[:len(section_energy)//3].mean()
            last_third = section_energy[-len(section_energy)//3:].mean()
            energy_trend = last_third - first_third
        else:
            energy_trend = 0

        # Semantic labeling
        position_ratio = start_time / duration if duration > 0 else 0

        if position_ratio < 0.1 and avg_energy < 0.3:
            label = "intro"
        elif position_ratio > 0.85 and avg_energy < 0.4:
            label = "outro"
        elif avg_bass > 0.4 and avg_energy > 0.5:
            label = "drop"
        elif avg_bass < 0.2 and energy_trend > 0.1:
            label = "buildup"
        elif avg_bass < 0.2 and avg_energy > 0.3:
            label = "breakdown"
        elif avg_vocal > 0.4 and avg_bass < 0.4:
            label = "verse"
        else:
            label = "verse" if avg_vocal > 0.3 else "drop"

        sections.append({
            "start": round(start_time, 2),
            "end": round(end_time, 2),
            "label": label,
            "energy_level": round(avg_energy, 2),
            "bass_presence": round(avg_bass, 2),
            "has_vocals": avg_vocal > 0.35,
        })

    return sections


def analyze_drum_bands(audio: np.ndarray, sr: int, hop_length: int) -> dict:
    """
    Analyze drums audio by frequency bands to separate kick, snare, and hats.
    Uses spectrogram-based energy extraction (more robust than bandpass filtering).

    - Kick: 20-250 Hz (sub bass through kick punch)
    - Snare: 150-400 Hz (body) + 2-5 kHz (crack/snap)
    - Hats: 6kHz+ (cymbals, hi-hats)

    Returns dict with kick, snare, hats time series data.
    """
    # Compute spectrogram
    n_fft = 2048
    S = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # Define frequency bands
    kick_mask = (freqs >= 20) & (freqs <= 250)
    snare_low_mask = (freqs >= 150) & (freqs <= 400)
    snare_high_mask = (freqs >= 2000) & (freqs <= 5000)
    hats_mask = freqs >= 6000

    # Compute energy in each band (RMS of magnitudes)
    kick_energy = np.sqrt(np.mean(S[kick_mask, :] ** 2, axis=0))
    snare_low_energy = np.sqrt(np.mean(S[snare_low_mask, :] ** 2, axis=0))
    snare_high_energy = np.sqrt(np.mean(S[snare_high_mask, :] ** 2, axis=0))
    snare_energy = snare_low_energy * 0.4 + snare_high_energy * 0.6
    hats_energy = np.sqrt(np.mean(S[hats_mask, :] ** 2, axis=0))

    # Normalize each independently
    def normalize(arr):
        max_val = arr.max()
        if max_val < 1e-10:
            return np.zeros_like(arr)
        return arr / max_val

    kick_norm = normalize(kick_energy)
    snare_norm = normalize(snare_energy)
    hats_norm = normalize(hats_energy)

    # Get time points
    times = librosa.frames_to_time(np.arange(len(kick_norm)), sr=sr, hop_length=hop_length)

    return {
        "kick": [{"time": safe_float(t), "value": safe_float(v)} for t, v in zip(times, kick_norm)],
        "snare": [{"time": safe_float(t), "value": safe_float(v)} for t, v in zip(times, snare_norm)],
        "hats": [{"time": safe_float(t), "value": safe_float(v)} for t, v in zip(times, hats_norm)],
    }


def run_stem_separation(job_id: str, audio_path: str, output_dir: str):
    """Background task to run Demucs stem separation.
    Returns stems progressively: bass first, then drums, then vocals.
    Also saves stem audio files for isolated playback.
    """
    try:
        stem_results[job_id] = {
            "status": "processing",
            "progress": 0,
            "stems": {},
            "stem_names": [],
            "stem_urls": {}  # URLs to isolated audio files
        }

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

        # Create job-specific directory for stem audio files
        job_stems_dir = STEMS_DIR / job_id
        job_stems_dir.mkdir(exist_ok=True)

        # Process in priority order: bass -> drums -> vocals -> other
        priority_order = ['bass', 'drums', 'vocals', 'other']
        hop_length = int(sr / 30)  # ~30 fps

        for idx, stem_name in enumerate(priority_order):
            if stem_name in source_names:
                source_idx = source_names.index(stem_name)
                # Keep stereo for audio file
                source_stereo = sources[0, source_idx].numpy()  # [2, samples]
                source_mono = source_stereo.mean(axis=0)  # Mono for analysis

                # Save stem audio file (stereo WAV)
                stem_audio_path = job_stems_dir / f"{stem_name}.wav"
                sf.write(str(stem_audio_path), source_stereo.T, sr)
                stem_url = f"/stems/{job_id}/{stem_name}.wav"
                stem_results[job_id]["stem_urls"][stem_name] = stem_url

                # Compute energy envelope
                rms = librosa.feature.rms(y=source_mono, hop_length=hop_length)[0]
                rms_normalized = rms / (rms.max() + 1e-6)
                times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)

                stem_data = [{"time": safe_float(t), "value": safe_float(v)} for t, v in zip(times, rms_normalized)]

                # Update results progressively
                stem_results[job_id]["stems"][stem_name] = stem_data
                stem_results[job_id]["stem_names"].append(stem_name)
                stem_results[job_id]["progress"] = 30 + (idx + 1) * 15

                # For drums stem, also analyze into kick/snare/hats bands
                if stem_name == 'drums':
                    try:
                        drum_bands = analyze_drum_bands(source_mono, sr, hop_length)
                        stem_results[job_id]["stems"]["drum_kick"] = drum_bands["kick"]
                        stem_results[job_id]["stems"]["drum_snare"] = drum_bands["snare"]
                        stem_results[job_id]["stems"]["drum_hats"] = drum_bands["hats"]
                        stem_results[job_id]["stem_names"].extend(["drum_kick", "drum_snare", "drum_hats"])
                        print(f"Drum band analysis complete: kick/snare/hats")
                    except Exception as drum_err:
                        print(f"Warning: Drum band analysis failed: {drum_err}")

        # Also save "no_vocals" (instrumental) mix
        try:
            no_vocals_sources = ['drums', 'bass', 'other']
            instrumental = np.zeros_like(sources[0, 0].numpy())
            for src_name in no_vocals_sources:
                if src_name in source_names:
                    src_idx = source_names.index(src_name)
                    instrumental += sources[0, src_idx].numpy()
            no_vocals_path = job_stems_dir / "no_vocals.wav"
            sf.write(str(no_vocals_path), instrumental.T, sr)
            stem_results[job_id]["stem_urls"]["no_vocals"] = f"/stems/{job_id}/no_vocals.wav"
        except Exception as e:
            print(f"Warning: Could not create no_vocals mix: {e}")

        stem_results[job_id]["status"] = "complete"
        stem_results[job_id]["progress"] = 100

    except Exception as e:
        import traceback
        stem_results[job_id] = {
            "status": "error",
            "error": f"{str(e)}\n{traceback.format_exc()}"
        }

    finally:
        # Clean up input temp files (keep stem audio files)
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


# ============ HUE LIGHT CONTROL ============

# Global Hue bridge instance
hue_bridge = None
HUE_CONFIG_FILE = Path(__file__).parent / "hue_bridge.json"
HUE_BRIDGE_IP = os.environ.get("HUE_BRIDGE_IP")  # Optional env var for auto-connect


@app.get("/hue/discover")
async def hue_discover():
    """Discover Hue bridge on the network."""
    from phue import Bridge
    import socket

    try:
        bridges = []

        # If HUE_BRIDGE_IP env var is set, use that first
        if HUE_BRIDGE_IP:
            bridges.append({
                "ip": HUE_BRIDGE_IP,
                "id": "env-configured",
            })
            return JSONResponse({
                "success": True,
                "bridges": bridges,
            })

        # Try to discover bridge using phue's built-in discovery
        # This uses SSDP/UPnP discovery
        from phue import PhueRegistrationException

        # Method 1: Check meethue.com discovery endpoint
        try:
            import urllib.request
            response = urllib.request.urlopen('https://discovery.meethue.com/', timeout=5)
            import json as json_module
            discovered = json_module.loads(response.read().decode())
            for bridge in discovered:
                bridges.append({
                    "ip": bridge.get("internalipaddress"),
                    "id": bridge.get("id"),
                })
        except Exception as e:
            print(f"Meethue discovery failed: {e}")

        return JSONResponse({
            "success": True,
            "bridges": bridges,
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e),
        })


@app.post("/hue/connect")
async def hue_connect(ip: str):
    """
    Connect to Hue bridge. User must press the bridge button within 30 seconds.
    First call will fail with 'link button not pressed', user presses button, then retry.
    """
    global hue_bridge
    from phue import Bridge, PhueRegistrationException

    try:
        # Try to connect - this will raise exception if button not pressed
        bridge = Bridge(ip, config_file_path=str(HUE_CONFIG_FILE))
        bridge.connect()
        hue_bridge = bridge

        # Get bridge info
        api = bridge.get_api()
        bridge_config = api.get('config', {})

        return JSONResponse({
            "success": True,
            "bridge_name": bridge_config.get('name', 'Hue Bridge'),
            "model": bridge_config.get('modelid', 'Unknown'),
            "lights_count": len(bridge.lights),
        })
    except PhueRegistrationException:
        return JSONResponse({
            "success": False,
            "error": "Press the link button on your Hue bridge, then try again.",
            "needs_button": True,
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e),
        })


@app.get("/hue/lights")
async def hue_get_lights():
    """Get list of available Hue lights."""
    global hue_bridge

    if not hue_bridge:
        # Try to reconnect if we have saved config
        if HUE_CONFIG_FILE.exists():
            try:
                from phue import Bridge
                hue_bridge = Bridge(config_file_path=str(HUE_CONFIG_FILE))
                hue_bridge.connect()
            except Exception as e:
                return JSONResponse({
                    "success": False,
                    "error": f"Not connected to bridge: {e}",
                })
        else:
            return JSONResponse({
                "success": False,
                "error": "Not connected to Hue bridge. Use /hue/connect first.",
            })

    try:
        lights = []
        for light in hue_bridge.lights:
            lights.append({
                "id": light.light_id,
                "name": light.name,
                "on": light.on,
                "brightness": light.brightness,
                "reachable": light.reachable,
                "type": light.type,
            })

        return JSONResponse({
            "success": True,
            "lights": lights,
        })
    except Exception as e:
        return JSONResponse({
            "success": False,
            "error": str(e),
        })


@app.post("/hue/control")
async def hue_control(light_id: int, brightness: float = None, on: bool = None,
                      hue: int = None, saturation: int = None, transition: int = 1):
    """
    Control a Hue light.
    - brightness: 0.0-1.0 (converted to 0-254)
    - on: true/false
    - hue: 0-65535 (color hue)
    - saturation: 0-254
    - transition: transition time in 100ms units (default 1 = 100ms)
    """
    global hue_bridge

    if not hue_bridge:
        if HUE_CONFIG_FILE.exists():
            try:
                from phue import Bridge
                hue_bridge = Bridge(config_file_path=str(HUE_CONFIG_FILE))
                hue_bridge.connect()
            except:
                return JSONResponse({"success": False, "error": "Not connected"})
        else:
            return JSONResponse({"success": False, "error": "Not connected"})

    try:
        command = {'transitiontime': transition}

        if on is not None:
            command['on'] = on

        if brightness is not None:
            if brightness <= 0.01:
                # Turn off for zero/near-zero brightness
                command['on'] = False
            else:
                # Convert 0-1 to 1-254 (Hue uses 1-254)
                bri = max(1, min(254, int(brightness * 254)))
                command['bri'] = bri
                command['on'] = True

        if hue is not None:
            command['hue'] = max(0, min(65535, hue))

        if saturation is not None:
            command['sat'] = max(0, min(254, saturation))

        hue_bridge.set_light(light_id, command)

        return JSONResponse({"success": True})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)})


@app.get("/hue/status")
async def hue_status():
    """Check if connected to Hue bridge."""
    global hue_bridge

    connected = False
    bridge_name = None

    if hue_bridge:
        try:
            api = hue_bridge.get_api()
            bridge_name = api.get('config', {}).get('name')
            connected = True
        except:
            hue_bridge = None
    elif HUE_CONFIG_FILE.exists():
        # Try to reconnect
        try:
            from phue import Bridge
            hue_bridge = Bridge(config_file_path=str(HUE_CONFIG_FILE))
            hue_bridge.connect()
            api = hue_bridge.get_api()
            bridge_name = api.get('config', {}).get('name')
            connected = True
        except:
            pass

    return JSONResponse({
        "success": True,
        "connected": connected,
        "bridge_name": bridge_name,
    })


# ============ LLM SHOW GENERATION ============

@app.post("/show/analyze")
async def analyze_for_show(file: UploadFile = File(...)):
    """
    Comprehensive audio analysis for LLM-based show generation.
    Returns all features needed for intelligent choreography.
    """
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load audio at analysis sample rate
        y, sr = librosa.load(tmp_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        hop_length = int(sr / 30)  # ~30 fps

        # 1. BPM detection
        bpm, bpm_confidence = detect_bpm_robust(y, sr)

        # 2. Beat grid
        _, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        # 3. Section detection with semantic labels
        sections = detect_song_sections(y, sr, bpm)

        # 4. Drum pattern analysis (from full mix)
        S = np.abs(librosa.stft(y, hop_length=hop_length))
        freqs = librosa.fft_frequencies(sr=sr)

        kick_mask = (freqs >= 20) & (freqs <= 250)
        snare_low = (freqs >= 150) & (freqs <= 400)
        snare_high = (freqs >= 2000) & (freqs <= 5000)
        hats_mask = freqs >= 6000

        kick_env = np.sqrt(np.mean(S[kick_mask, :] ** 2, axis=0))
        snare_env = np.sqrt(np.mean(S[snare_low, :] ** 2, axis=0)) * 0.4 + \
                    np.sqrt(np.mean(S[snare_high, :] ** 2, axis=0)) * 0.6
        hats_env = np.sqrt(np.mean(S[hats_mask, :] ** 2, axis=0))

        # Normalize
        kick_env = kick_env / (kick_env.max() + 1e-6)
        snare_env = snare_env / (snare_env.max() + 1e-6)
        hats_env = hats_env / (hats_env.max() + 1e-6)

        patterns = detect_rhythmic_patterns(kick_env, snare_env, hats_env, sr, hop_length, bpm)

        # 5. Energy profile (downsampled for LLM context efficiency)
        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        rms = rms / (rms.max() + 1e-6)

        # Downsample to ~2 points per second for LLM context
        downsample_factor = max(1, int(30 / 2))
        energy_downsampled = rms[::downsample_factor].tolist()
        times_downsampled = np.arange(0, duration, 1/2).tolist()[:len(energy_downsampled)]

        energy_profile = [
            {"time": round(t, 1), "energy": round(e, 2)}
            for t, e in zip(times_downsampled, energy_downsampled)
        ]

        # 6. Key moments (drops, builds, breaks)
        key_moments = []
        for section in sections:
            if section["label"] in ["drop", "buildup", "breakdown"]:
                key_moments.append({
                    "time": section["start"],
                    "type": section["label"],
                    "energy": section["energy_level"],
                })

        return JSONResponse({
            "success": True,
            "analysis": {
                "duration": round(duration, 2),
                "bpm": bpm,
                "bpm_confidence": bpm_confidence,
                "beat_count": len(beat_times),
                "sections": sections,
                "patterns": patterns,
                "key_moments": key_moments,
                "energy_profile": energy_profile,
            }
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post("/show/generate")
async def generate_show(
    file: UploadFile = File(...),
    lights: str = "4",  # Number of lights or comma-separated names
    style: str = "energetic",  # Style hint: energetic, ambient, dramatic, minimal
):
    """
    Generate a complete light show configuration using Claude.

    1. Analyzes the audio
    2. Sends analysis to Claude with light setup info
    3. Returns a show configuration with per-section light assignments
    """
    import anthropic

    # Get API key from environment
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return JSONResponse({
            "success": False,
            "error": "ANTHROPIC_API_KEY not set in environment"
        }, status_code=500)

    # First, analyze the audio
    suffix = os.path.splitext(file.filename)[1] if file.filename else ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Load and analyze audio
        y, sr = librosa.load(tmp_path, sr=22050, mono=True)
        duration = librosa.get_duration(y=y, sr=sr)
        hop_length = int(sr / 30)

        bpm, bpm_confidence = detect_bpm_robust(y, sr)
        sections = detect_song_sections(y, sr, bpm)

        # Quick pattern detection
        S = np.abs(librosa.stft(y, hop_length=hop_length))
        freqs = librosa.fft_frequencies(sr=sr)
        kick_mask = (freqs >= 20) & (freqs <= 250)
        snare_low = (freqs >= 150) & (freqs <= 400)
        snare_high = (freqs >= 2000) & (freqs <= 5000)
        hats_mask = freqs >= 6000

        kick_env = np.sqrt(np.mean(S[kick_mask, :] ** 2, axis=0))
        snare_env = np.sqrt(np.mean(S[snare_low, :] ** 2, axis=0)) * 0.4 + \
                    np.sqrt(np.mean(S[snare_high, :] ** 2, axis=0)) * 0.6
        hats_env = np.sqrt(np.mean(S[hats_mask, :] ** 2, axis=0))

        kick_env = kick_env / (kick_env.max() + 1e-6)
        snare_env = snare_env / (snare_env.max() + 1e-6)
        hats_env = hats_env / (hats_env.max() + 1e-6)

        patterns = detect_rhythmic_patterns(kick_env, snare_env, hats_env, sr, hop_length, bpm)

        # Parse lights configuration
        try:
            num_lights = int(lights)
            light_names = [f"Light {i+1}" for i in range(num_lights)]
        except ValueError:
            light_names = [l.strip() for l in lights.split(",")]
            num_lights = len(light_names)

        # Build prompt for Claude
        analysis_summary = {
            "duration_sec": round(duration, 1),
            "bpm": bpm,
            "sections": sections,
            "patterns": patterns,
        }

        prompt = f"""You are a professional light show designer. Create a light show configuration for the following song analysis.

SONG ANALYSIS:
{json.dumps(analysis_summary, indent=2)}

AVAILABLE LIGHTS: {light_names}
STYLE: {style}

Create a JSON configuration that assigns each light to audio-reactive behaviors per section.

Rules:
- Each light can track: "kick", "snare", "hats", "bass", "vocals", "energy", or "off"
- Include smooth envelope settings (attack_ms, release_ms) for each assignment
- For drops: maximize energy, use kick on some lights, hats on others
- For breakdowns: use slower, ambient patterns (vocals, energy with long release)
- For buildups: gradually increase intensity
- Use complementary assignments (not all lights on the same source)

Respond with ONLY valid JSON in this format:
{{
  "show_name": "string",
  "sections": [
    {{
      "start": 0.0,
      "end": 30.0,
      "label": "intro",
      "lights": {{
        "Light 1": {{"source": "bass", "attack_ms": 20, "release_ms": 200, "intensity": 0.8}},
        "Light 2": {{"source": "hats", "attack_ms": 10, "release_ms": 100, "intensity": 0.6}}
      }}
    }}
  ]
}}"""

        # Call Claude API
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse the response
        response_text = message.content[0].text
        # Extract JSON from response (handle markdown code blocks)
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]

        show_config = json.loads(response_text.strip())

        return JSONResponse({
            "success": True,
            "analysis": {
                "duration": round(duration, 2),
                "bpm": bpm,
                "sections": sections,
                "patterns": patterns,
            },
            "show": show_config,
        })

    except json.JSONDecodeError as e:
        return JSONResponse({
            "success": False,
            "error": f"Failed to parse Claude response as JSON: {e}",
            "raw_response": response_text if 'response_text' in dir() else None
        }, status_code=500)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
