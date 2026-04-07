"""Offline song analysis: demucs stem separation + section detection + BPM + patterns.

Produces an AnalysisResult JSON with:
- Per-frame stem energies at 30fps
- Song sections with semantic labels
- BPM and rhythmic patterns

Usage:
    KMP_DUPLICATE_LIB_OK=TRUE python analyze.py "~/Desktop/song.mp3"
"""

from __future__ import annotations

import json
import time as time_mod
from pathlib import Path

import librosa
import numpy as np
import scipy.ndimage
import soundfile as sf
import torch

from schemas import (
    AnalysisResult, RhythmicPattern, Section, StemEnergies, StemFrame,
    StemOnsets, StemPans, StemBrightness,
)

TARGET_SR = 22050
TARGET_FPS = 30
HOP_LENGTH = TARGET_SR // TARGET_FPS  # ~735 samples per frame


# ---------------------------------------------------------------------------
# Demucs monkey-patch (macOS ffmpeg 8 workaround)
# ---------------------------------------------------------------------------

def _patch_demucs_save():
    import demucs.audio

    _original_save = demucs.audio.save_audio

    def _patched_save_audio(wav, path, samplerate, **kwargs):
        path = Path(path)
        if path.suffix.lower() == ".wav":
            wav_np = wav.cpu().numpy() if isinstance(wav, torch.Tensor) else np.array(wav)
            if wav_np.ndim == 2:
                wav_np = wav_np.T
            wav_np = np.clip(wav_np, -1.0, 1.0)
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(path), wav_np, samplerate, subtype="PCM_16")
        else:
            _original_save(wav, path, samplerate, **kwargs)

    demucs.audio.save_audio = _patched_save_audio
    print("  Patched demucs save_audio -> soundfile")


# ---------------------------------------------------------------------------
# Demucs separation
# ---------------------------------------------------------------------------

def run_demucs(input_path: Path, cache_dir: Path) -> Path:
    """Run htdemucs, return path to stem directory."""
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio

    stems_dir = cache_dir / "htdemucs" / input_path.stem
    expected = ["bass.wav", "drums.wav", "vocals.wav", "other.wav"]

    if stems_dir.exists() and all((stems_dir / s).exists() for s in expected):
        print(f"  Using cached stems: {stems_dir}")
        return stems_dir

    print(f"  Running htdemucs on {input_path.name}...")
    t0 = time_mod.time()

    model = get_model("htdemucs")
    model.eval()

    audio = AudioFile(input_path).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    )
    ref = audio.mean(0)
    audio = (audio - ref.mean()) / ref.std()

    sources = apply_model(model, audio[None], device=torch.device("cpu"))[0]
    sources = sources * ref.std() + ref.mean()

    stems_dir.mkdir(parents=True, exist_ok=True)
    for name, src in zip(model.sources, sources):
        save_audio(src, stems_dir / f"{name}.wav", model.samplerate)
        print(f"    {name}.wav")

    print(f"  Demucs complete in {time_mod.time() - t0:.1f}s")
    return stems_dir


# ---------------------------------------------------------------------------
# Energy extraction (ported from v2/analyze.py, bumped to 30fps)
# ---------------------------------------------------------------------------

def compute_rms_envelope(audio: np.ndarray, hop_length: int) -> np.ndarray:
    return librosa.feature.rms(y=audio, frame_length=hop_length * 2, hop_length=hop_length)[0]


def normalize_envelope(env: np.ndarray) -> np.ndarray:
    mx = env.max()
    if mx < 1e-10:
        return np.zeros_like(env)
    return env / mx


def analyze_drum_bands(audio: np.ndarray, sr: int, hop_length: int) -> dict[str, np.ndarray]:
    """Split drums into kick, snare, hats using frequency bands."""
    n_fft = 2048
    S = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    kick_raw = np.sqrt(np.mean(S[(freqs >= 30) & (freqs <= 120)] ** 2, axis=0))
    snare_lo = np.sqrt(np.mean(S[(freqs >= 200) & (freqs <= 400)] ** 2, axis=0))
    snare_hi = np.sqrt(np.mean(S[(freqs >= 2500) & (freqs <= 6000)] ** 2, axis=0))
    snare_raw = snare_lo * 0.25 + snare_hi * 0.75
    hats = np.sqrt(np.mean(S[freqs >= 8000] ** 2, axis=0))

    # Gate snare when kick dominates
    kick_n = normalize_envelope(kick_raw)
    snare_n = normalize_envelope(snare_raw)
    snare_gated = np.where(
        (kick_n > snare_n * 1.5) & (snare_n < 0.4),
        snare_n * 0.2,
        snare_n,
    )

    # Onset detection per band
    kick_onset = librosa.onset.onset_strength(S=S[(freqs >= 30) & (freqs <= 120)], sr=sr, hop_length=hop_length)
    snare_onset = librosa.onset.onset_strength(S=S[(freqs >= 2500) & (freqs <= 6000)], sr=sr, hop_length=hop_length)
    hat_onset = librosa.onset.onset_strength(S=S[freqs >= 8000], sr=sr, hop_length=hop_length)

    return {
        "kick": kick_n,
        "snare": normalize_envelope(snare_gated),
        "hats": normalize_envelope(hats),
        "kick_onset": normalize_envelope(kick_onset),
        "snare_onset": normalize_envelope(snare_onset),
        "hat_onset": normalize_envelope(hat_onset),
    }


def resample_envelope(env: np.ndarray, sr: int, hop: int, fps: int, dur: float) -> np.ndarray:
    n = int(dur * fps)
    src_t = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop)
    dst_t = np.arange(n) / fps
    return np.interp(dst_t, src_t, env)


# ---------------------------------------------------------------------------
# BPM detection (ported from v1/backend/main.py)
# ---------------------------------------------------------------------------

def detect_bpm_robust(y: np.ndarray, sr: int) -> tuple[float, float]:
    """Robust BPM detection using multiple methods and voting."""
    # Method 1: Standard beat tracking
    tempo1, _ = librosa.beat.beat_track(y=y, sr=sr)
    if isinstance(tempo1, np.ndarray):
        tempo1 = float(tempo1[0]) if len(tempo1) > 0 else 120.0
    else:
        tempo1 = float(tempo1)

    # Method 2: Onset-based tempo
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    tempo2 = librosa.feature.tempo(
        onset_envelope=onset_env, sr=sr,
        start_bpm=128, std_bpm=20, ac_size=8.0, max_tempo=180, aggregate=None,
    )

    # Method 3: Tempogram
    tempogram = librosa.feature.tempogram(onset_envelope=onset_env, sr=sr)
    tempo_frequencies = librosa.tempo_frequencies(tempogram.shape[0], sr=sr)
    mean_tempogram = tempogram.mean(axis=1)
    valid_range = (tempo_frequencies >= 60) & (tempo_frequencies <= 200)
    mean_tempogram_valid = mean_tempogram.copy()
    mean_tempogram_valid[~valid_range] = 0
    tempo3 = tempo_frequencies[mean_tempogram_valid.argmax()]

    # Collect and normalize
    estimates = [tempo1, tempo3]
    if isinstance(tempo2, np.ndarray) and len(tempo2) > 0:
        estimates.extend(tempo2.tolist())
    estimates = [t for t in estimates if 60 <= t <= 200]

    if not estimates:
        return 120.0, 0.3

    normalized = []
    for t in estimates:
        while t > 160:
            t /= 2
        while t < 80:
            t *= 2
        normalized.append(t)

    final_bpm = float(np.median(normalized))
    deviations = [abs(t - final_bpm) for t in normalized]
    confidence = max(0.3, min(1.0, 1.0 - np.mean(deviations) / 20))

    return round(final_bpm, 1), round(confidence, 2)


# ---------------------------------------------------------------------------
# Rhythmic pattern detection (ported from v1/backend/main.py)
# ---------------------------------------------------------------------------

def detect_rhythmic_patterns(
    kick_env: np.ndarray, snare_env: np.ndarray, hats_env: np.ndarray,
    sr: int, hop_length: int, bpm: float,
) -> RhythmicPattern:
    from scipy.signal import find_peaks

    beat_duration_sec = 60.0 / bpm
    samples_per_beat = beat_duration_sec * sr / hop_length

    kick_peaks, _ = find_peaks(kick_env, height=0.3, distance=int(samples_per_beat * 0.5))
    snare_peaks, _ = find_peaks(snare_env, height=0.3, distance=int(samples_per_beat * 0.5))
    hats_peaks, _ = find_peaks(hats_env, height=0.2, distance=int(samples_per_beat * 0.25))

    # Four-on-floor
    four_on_floor = False
    if len(kick_peaks) > 8:
        kick_intervals = np.diff(kick_peaks)
        median_interval = np.median(kick_intervals)
        interval_error = abs(median_interval - samples_per_beat) / samples_per_beat
        four_on_floor = interval_error < 0.15

    # Backbeat
    backbeat = False
    if len(snare_peaks) > 4:
        snare_intervals = np.diff(snare_peaks)
        median_snare_interval = np.median(snare_intervals)
        expected_interval = samples_per_beat * 2
        interval_error = abs(median_snare_interval - expected_interval) / expected_interval
        backbeat = interval_error < 0.2

    # Hat rate
    hat_rate = "sparse"
    if len(hats_peaks) > 8:
        hat_intervals = np.diff(hats_peaks)
        median_hat_interval = np.median(hat_intervals)
        if median_hat_interval < samples_per_beat * 0.35:
            hat_rate = "16ths"
        elif median_hat_interval < samples_per_beat * 0.7:
            hat_rate = "8ths"
        else:
            hat_rate = "quarters"

    # Syncopation
    total_frames = len(kick_env)
    beat_positions = np.arange(0, total_frames, samples_per_beat).astype(int)
    beat_positions = beat_positions[beat_positions < total_frames]

    tolerance = int(samples_per_beat * 0.1)
    combined = kick_env + snare_env * 0.5
    on_beat = sum(
        combined[i] for i in range(total_frames)
        if any(abs(i - bp) < tolerance for bp in beat_positions)
    )
    off_beat = sum(
        combined[i] for i in range(total_frames)
        if not any(abs(i - bp) < tolerance for bp in beat_positions)
    )
    syncopation = off_beat / (on_beat + off_beat + 1e-6)

    # Confidence
    confidence = 0.5
    if len(kick_peaks) > 4:
        kick_std = np.std(np.diff(kick_peaks)) / samples_per_beat
        confidence = max(0.3, min(1.0, 1.0 - kick_std))

    return RhythmicPattern(
        four_on_floor=four_on_floor,
        backbeat=backbeat,
        hat_rate=hat_rate,
        syncopation_level=round(float(syncopation), 3),
        pattern_confidence=round(float(confidence), 2),
    )


# ---------------------------------------------------------------------------
# Section detection (ported from v1/backend/main.py)
# ---------------------------------------------------------------------------

def detect_song_sections(y: np.ndarray, sr: int, bpm: float) -> list[Section]:
    hop_length = 2048

    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    rms = rms / (rms.max() + 1e-6)

    S = np.abs(librosa.stft(y, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr)

    bass_mask = (freqs >= 20) & (freqs <= 150)
    bass_energy = S[bass_mask, :].sum(axis=0)
    bass_energy = bass_energy / (bass_energy.max() + 1e-6)

    vocal_mask = (freqs >= 200) & (freqs <= 4000)
    vocal_energy = S[vocal_mask, :].sum(axis=0)
    vocal_energy = vocal_energy / (vocal_energy.max() + 1e-6)

    smooth_window = int(sr / hop_length)
    bass_smooth = scipy.ndimage.uniform_filter1d(bass_energy, smooth_window)
    rms_smooth = scipy.ndimage.uniform_filter1d(rms, smooth_window)
    vocal_smooth = scipy.ndimage.uniform_filter1d(vocal_energy, smooth_window)

    # Bass onset/dropout
    bass_active = bass_smooth > 0.25
    bass_change = np.diff(bass_active.astype(int))
    onset_frames = np.where(bass_change == 1)[0]
    dropout_frames = np.where(bass_change == -1)[0]

    # Energy change peaks
    rms_diff = np.abs(np.gradient(rms_smooth))
    from scipy.signal import find_peaks
    energy_peaks, _ = find_peaks(rms_diff, distance=int(8 * sr / hop_length), prominence=0.05)

    times = librosa.frames_to_time(np.arange(len(rms)), sr=sr, hop_length=hop_length)
    duration = times[-1] if len(times) > 0 else 0

    boundaries = {0.0}
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

    # Label sections
    sections = []
    for i in range(len(boundaries) - 1):
        start_time = boundaries[i]
        end_time = boundaries[i + 1]

        start_frame = int(start_time * sr / hop_length)
        end_frame = min(int(end_time * sr / hop_length), len(bass_smooth))
        if start_frame >= end_frame:
            continue

        avg_bass = float(bass_smooth[start_frame:end_frame].mean())
        avg_energy = float(rms_smooth[start_frame:end_frame].mean())
        avg_vocal = float(vocal_smooth[start_frame:end_frame].mean())

        section_energy = rms_smooth[start_frame:end_frame]
        if len(section_energy) > 10:
            first_third = section_energy[:len(section_energy)//3].mean()
            last_third = section_energy[-len(section_energy)//3:].mean()
            energy_trend = last_third - first_third
        else:
            energy_trend = 0

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

        sections.append(Section(
            start=round(start_time, 2),
            end=round(end_time, 2),
            label=label,
            energy_level=round(avg_energy, 2),
            bass_presence=round(avg_bass, 2),
            has_vocals=avg_vocal > 0.35,
        ))

    return sections


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------

def analyze_song(input_path: Path, output_dir: Path, cache_dir: Path) -> AnalysisResult:
    """Full analysis pipeline: demucs -> energies -> sections -> BPM -> patterns."""
    song_name = input_path.stem
    print(f"\n{'='*60}")
    print(f"Analyzing: {song_name}")
    print(f"{'='*60}")

    # Step 1: Demucs
    _patch_demucs_save()
    stems_dir = run_demucs(input_path, cache_dir)

    # Step 2: Load audio
    print("  Loading audio...")
    y_mix, _ = librosa.load(input_path, sr=TARGET_SR, mono=True)
    duration = len(y_mix) / TARGET_SR
    n_frames = int(duration * TARGET_FPS)
    print(f"  Duration: {duration:.1f}s | Frames: {n_frames} @ {TARGET_FPS}fps")

    stems_audio = {}
    stems_stereo = {}
    for name in ["bass", "drums", "vocals", "other"]:
        stems_audio[name], _ = librosa.load(stems_dir / f"{name}.wav", sr=TARGET_SR, mono=True)
        # Load stereo for pan detection (bass, vocals, other)
        if name != "drums":
            y_stereo, _ = librosa.load(stems_dir / f"{name}.wav", sr=TARGET_SR, mono=False)
            if y_stereo.ndim == 2 and y_stereo.shape[0] == 2:
                stems_stereo[name] = y_stereo
            else:
                # Mono source, no pan info
                stems_stereo[name] = None

    # Step 3: Stem energy envelopes
    print("  Computing energy envelopes...")
    envelopes = {}

    env = compute_rms_envelope(stems_audio["bass"], HOP_LENGTH)
    envelopes["bass"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    drum_bands = analyze_drum_bands(stems_audio["drums"], TARGET_SR, HOP_LENGTH)
    for band, ch in [("kick", "kick"), ("snare", "snare"), ("hats", "hat")]:
        envelopes[ch] = resample_envelope(drum_bands[band], TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)[:n_frames]

    env = compute_rms_envelope(stems_audio["vocals"], HOP_LENGTH)
    envelopes["vocals"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    env = compute_rms_envelope(stems_audio["other"], HOP_LENGTH)
    envelopes["other"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Onset envelopes (resample to 30fps)
    onset_envelopes = {}
    for band, ch in [("kick_onset", "kick_onset"), ("snare_onset", "snare_onset"), ("hat_onset", "hat_onset")]:
        onset_envelopes[ch] = resample_envelope(drum_bands[band], TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)[:n_frames]

    # Spectral centroid
    centroid = librosa.feature.spectral_centroid(y=y_mix, sr=TARGET_SR, hop_length=HOP_LENGTH)[0]
    centroid_resampled = resample_envelope(centroid, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)

    # Per-stem brightness (normalized spectral centroid)
    print("  Computing per-stem brightness...")
    brightness_envelopes = {}
    for name in ["vocals", "other"]:
        sc = librosa.feature.spectral_centroid(y=stems_audio[name], sr=TARGET_SR, hop_length=HOP_LENGTH)[0]
        sc_resampled = resample_envelope(sc, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
        brightness_envelopes[name] = np.clip(sc_resampled / 8000.0, 0.0, 1.0)

    # Stereo pan per stem
    print("  Computing stereo pan...")
    pan_envelopes = {}
    for name in ["bass", "vocals", "other"]:
        stereo = stems_stereo.get(name)
        if stereo is not None:
            l_rms = compute_rms_envelope(stereo[0], HOP_LENGTH)
            r_rms = compute_rms_envelope(stereo[1], HOP_LENGTH)
            total = l_rms + r_rms
            pan = np.where(total > 1e-6, (r_rms - l_rms) / total, 0.0)
            pan_envelopes[name] = resample_envelope(pan, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
        else:
            pan_envelopes[name] = np.zeros(n_frames)

    # Spectral flux (full mix)
    print("  Computing spectral flux...")
    S_mix = np.abs(librosa.stft(y_mix, n_fft=2048, hop_length=HOP_LENGTH))
    flux_raw = np.linalg.norm(np.diff(S_mix, axis=1), axis=0)
    flux_raw = np.concatenate([[0.0], flux_raw])  # pad to match frame count
    flux_resampled = resample_envelope(flux_raw, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    flux_max = flux_resampled.max()
    if flux_max > 1e-10:
        flux_resampled = flux_resampled / flux_max

    # Align lengths
    all_arrays = list(envelopes.values()) + list(onset_envelopes.values()) + list(brightness_envelopes.values()) + list(pan_envelopes.values()) + [centroid_resampled, flux_resampled]
    min_len = min(len(a) for a in all_arrays)
    for k in envelopes:
        envelopes[k] = envelopes[k][:min_len]
    for k in onset_envelopes:
        onset_envelopes[k] = onset_envelopes[k][:min_len]
    for k in brightness_envelopes:
        brightness_envelopes[k] = brightness_envelopes[k][:min_len]
    for k in pan_envelopes:
        pan_envelopes[k] = pan_envelopes[k][:min_len]
    centroid_resampled = centroid_resampled[:min_len]
    flux_resampled = flux_resampled[:min_len]

    # Step 4: BPM
    print("  Detecting BPM...")
    bpm, bpm_confidence = detect_bpm_robust(y_mix, TARGET_SR)
    print(f"  BPM: {bpm} (confidence: {bpm_confidence})")

    # Step 5: Song sections
    print("  Detecting sections...")
    sections = detect_song_sections(y_mix, TARGET_SR, bpm)
    for s in sections:
        print(f"    {s.start:6.1f}-{s.end:6.1f}s  {s.label:12s}  energy={s.energy_level:.2f}  bass={s.bass_presence:.2f}")

    # Step 6: Rhythmic patterns (use raw drum envelopes at analysis resolution)
    print("  Detecting rhythmic patterns...")
    patterns = detect_rhythmic_patterns(
        drum_bands["kick"], drum_bands["snare"], drum_bands["hats"],
        TARGET_SR, HOP_LENGTH, bpm,
    )
    print(f"  Patterns: 4otf={patterns.four_on_floor} backbeat={patterns.backbeat} hats={patterns.hat_rate}")

    # Step 7: Build frames
    frames = []
    for i in range(min_len):
        frames.append(StemFrame(
            time=round(i / TARGET_FPS, 4),
            stems=StemEnergies(
                bass=round(float(envelopes["bass"][i]), 4),
                kick=round(float(envelopes["kick"][i]), 4),
                snare=round(float(envelopes["snare"][i]), 4),
                hat=round(float(envelopes["hat"][i]), 4),
                vocals=round(float(envelopes["vocals"][i]), 4),
                other=round(float(envelopes["other"][i]), 4),
            ),
            centroid=round(float(centroid_resampled[i]), 1),
            onsets=StemOnsets(
                kick=round(float(onset_envelopes["kick_onset"][i]), 4),
                snare=round(float(onset_envelopes["snare_onset"][i]), 4),
                hat=round(float(onset_envelopes["hat_onset"][i]), 4),
            ),
            pans=StemPans(
                bass=round(float(pan_envelopes["bass"][i]), 4),
                vocals=round(float(pan_envelopes["vocals"][i]), 4),
                other=round(float(pan_envelopes["other"][i]), 4),
            ),
            brightness=StemBrightness(
                vocals=round(float(brightness_envelopes["vocals"][i]), 4),
                other=round(float(brightness_envelopes["other"][i]), 4),
            ),
            spectral_flux=round(float(flux_resampled[i]), 4),
        ))

    result = AnalysisResult(
        song=song_name,
        source_file=input_path.name,
        duration=round(duration, 2),
        bpm=bpm,
        bpm_confidence=bpm_confidence,
        fps=TARGET_FPS,
        sections=sections,
        patterns=patterns,
        frames=frames,
    )

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{song_name}_analysis.json"
    with open(out_path, "w") as f:
        json.dump(result.model_dump(), f)

    print(f"\n  Saved: {out_path}")
    print(f"  {min_len} frames, {len(sections)} sections")
    return result
