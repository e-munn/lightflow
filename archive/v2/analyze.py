"""Offline stem analysis: run demucs on an audio file, extract per-stem energy timelines.

Produces a JSON file with 6-channel energy data at 20fps:
  bass, kick, snare, hat, vocals, other

Usage:
    KMP_DUPLICATE_LIB_OK=TRUE python analyze.py "~/Desktop/Talk of the Town.mp3"
    KMP_DUPLICATE_LIB_OK=TRUE python analyze.py song.wav --output-dir ./analysis
"""

import argparse
import json
import sys
import time
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
import torch


STEM_CHANNELS = [
    "bass_energy",
    "kick_energy",
    "snare_energy",
    "hat_energy",
    "vocals_energy",
    "other_energy",
    "mel_band_0",
    "mel_band_1",
    "mel_band_2",
    "mel_band_3",
    "mel_band_4",
    "mel_band_5",
    "mel_band_6",
    "mel_band_7",
]

TARGET_SR = 22050
TARGET_FPS = 20
HOP_LENGTH = TARGET_SR // TARGET_FPS  # 1102 samples per frame


# ---------------------------------------------------------------------------
# Demucs monkey-patch (macOS ffmpeg 8 workaround)
# ---------------------------------------------------------------------------

def _patch_demucs_save():
    """Monkey-patch demucs to save WAV via soundfile instead of torchaudio.

    torchaudio 2.9+ uses torchcodec which requires ffmpeg 4-7,
    but macOS Homebrew installs ffmpeg 8. This bypasses the issue entirely.
    """
    import demucs.audio

    _original_save = demucs.audio.save_audio

    def _patched_save_audio(wav, path, samplerate, **kwargs):
        path = Path(path)
        if path.suffix.lower() == ".wav":
            if isinstance(wav, torch.Tensor):
                wav_np = wav.cpu().numpy()
            else:
                wav_np = np.array(wav)
            if wav_np.ndim == 2:
                wav_np = wav_np.T
            wav_np = np.clip(wav_np, -1.0, 1.0)
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(path), wav_np, samplerate, subtype="PCM_16")
        else:
            _original_save(wav, path, samplerate, **kwargs)

    demucs.audio.save_audio = _patched_save_audio
    print("  Patched demucs save_audio → soundfile")


# ---------------------------------------------------------------------------
# Demucs separation
# ---------------------------------------------------------------------------

def run_demucs(input_path: Path, cache_dir: Path) -> Path:
    """Run htdemucs on an audio file, returning path to stem directory."""
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio

    stems_dir = cache_dir / "htdemucs" / input_path.stem
    expected = ["bass.wav", "drums.wav", "vocals.wav", "other.wav"]

    if stems_dir.exists() and all((stems_dir / s).exists() for s in expected):
        print(f"  Using cached stems: {stems_dir}")
        return stems_dir

    print(f"  Running htdemucs on {input_path.name}...")
    t0 = time.time()

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

    print(f"  Demucs complete in {time.time() - t0:.1f}s")
    return stems_dir


# ---------------------------------------------------------------------------
# Energy extraction
# ---------------------------------------------------------------------------

def compute_rms_envelope(audio: np.ndarray, hop_length: int) -> np.ndarray:
    """RMS energy envelope."""
    return librosa.feature.rms(y=audio, frame_length=hop_length * 2, hop_length=hop_length)[0]


def normalize_envelope(env: np.ndarray) -> np.ndarray:
    """Normalize to 0-1."""
    mx = env.max()
    if mx < 1e-10:
        return np.zeros_like(env)
    return env / mx


def analyze_drum_bands(audio: np.ndarray, sr: int, hop_length: int) -> dict[str, np.ndarray]:
    """Split drums into kick, snare, hats using non-overlapping frequency bands.

    Bands chosen to minimize bleed:
      kick:     30-120 Hz  (kick fundamental only)
      snare_lo: 200-400 Hz (snare body, above kick harmonics)
      snare_hi: 2500-6000 Hz (snare crack/rattle — most distinctive)
      hats:     8000+ Hz   (cymbal shimmer)
    """
    n_fft = 2048
    S = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    kick_raw = np.sqrt(np.mean(S[(freqs >= 30) & (freqs <= 120)] ** 2, axis=0))
    snare_lo = np.sqrt(np.mean(S[(freqs >= 200) & (freqs <= 400)] ** 2, axis=0))
    snare_hi = np.sqrt(np.mean(S[(freqs >= 2500) & (freqs <= 6000)] ** 2, axis=0))
    snare_raw = snare_lo * 0.25 + snare_hi * 0.75
    hats = np.sqrt(np.mean(S[freqs >= 8000] ** 2, axis=0))

    # Gate: suppress snare when kick dominates (prevents kick bleed)
    kick_n = normalize_envelope(kick_raw)
    snare_n = normalize_envelope(snare_raw)
    snare_gated = np.where(
        (kick_n > snare_n * 1.5) & (snare_n < 0.4),
        snare_n * 0.2,  # heavily suppress
        snare_n,
    )

    return {
        "kick": kick_n,
        "snare": normalize_envelope(snare_gated),
        "hats": normalize_envelope(hats),
    }


def analyze_spectral_bands(audio: np.ndarray, sr: int, hop_length: int, n_bands: int = 8) -> dict[str, np.ndarray]:
    """Compute energy in n_bands log-spaced frequency bands (100Hz–10kHz).

    Maps the "other" stem (synth/melody) into 8 bands for graphic-EQ style
    tube visualization. One band per tube.
    """
    n_fft = 2048
    S = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    # Log-spaced edges covering melody range
    top = min(10000, sr // 2)
    edges = np.logspace(np.log10(100), np.log10(top), n_bands + 1)

    bands = {}
    for i in range(n_bands):
        lo, hi = edges[i], edges[i + 1]
        mask = (freqs >= lo) & (freqs < hi)
        if mask.sum() == 0:
            bands[f"mel_band_{i}"] = np.zeros(S.shape[1])
        else:
            band_energy = np.sqrt(np.mean(S[mask] ** 2, axis=0))
            bands[f"mel_band_{i}"] = normalize_envelope(band_energy)

    return bands


def resample_envelope(env: np.ndarray, sr: int, hop: int, fps: int, dur: float) -> np.ndarray:
    """Resample envelope to target FPS."""
    n = int(dur * fps)
    src_t = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop)
    dst_t = np.arange(n) / fps
    return np.interp(dst_t, src_t, env)


# ---------------------------------------------------------------------------
# Main analysis pipeline
# ---------------------------------------------------------------------------

def analyze(input_path: Path, output_dir: Path, cache_dir: Path) -> Path:
    """Full analysis pipeline: demucs → energy envelopes → JSON."""
    song_name = input_path.stem
    print(f"\n{'='*60}")
    print(f"Analyzing: {song_name}")
    print(f"{'='*60}")

    # Step 1: Demucs separation
    _patch_demucs_save()
    stems_dir = run_demucs(input_path, cache_dir)

    # Step 2: Load audio and stems
    print("  Loading audio...")
    y_mix, _ = librosa.load(input_path, sr=TARGET_SR, mono=True)
    duration = len(y_mix) / TARGET_SR
    n_frames = int(duration * TARGET_FPS)
    print(f"  Duration: {duration:.1f}s | Frames: {n_frames} @ {TARGET_FPS}fps")

    stems = {}
    for name in ["bass", "drums", "vocals", "other"]:
        path = stems_dir / f"{name}.wav"
        stems[name], _ = librosa.load(path, sr=TARGET_SR, mono=True)

    # Step 3: Compute energy envelopes
    print("  Computing energy envelopes...")
    envelopes = {}

    # Bass
    env = compute_rms_envelope(stems["bass"], HOP_LENGTH)
    envelopes["bass_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Drum sub-bands
    drum_bands = analyze_drum_bands(stems["drums"], TARGET_SR, HOP_LENGTH)
    for band, ch in [("kick", "kick_energy"), ("snare", "snare_energy"), ("hats", "hat_energy")]:
        envelopes[ch] = resample_envelope(drum_bands[band], TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)[:n_frames]

    # Vocals
    env = compute_rms_envelope(stems["vocals"], HOP_LENGTH)
    envelopes["vocals_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Other / melody (overall energy)
    env = compute_rms_envelope(stems["other"], HOP_LENGTH)
    envelopes["other_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Spectral bands from "other" stem (8 bands for graphic-EQ tube display)
    print("  Computing spectral bands (other stem)...")
    mel_bands = analyze_spectral_bands(stems["other"], TARGET_SR, HOP_LENGTH)
    for band_name, band_env in mel_bands.items():
        envelopes[band_name] = resample_envelope(
            band_env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration
        )[:n_frames]

    # Align lengths
    min_len = min(len(v) for v in envelopes.values())
    for k in envelopes:
        envelopes[k] = envelopes[k][:min_len]

    # Step 4: Also compute spectral centroid on the mix for color mapping
    centroid = librosa.feature.spectral_centroid(y=y_mix, sr=TARGET_SR, hop_length=HOP_LENGTH)[0]
    centroid = resample_envelope(centroid, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)[:min_len]

    # Step 5: Build output
    states = []
    for i in range(min_len):
        channels = {ch: round(float(envelopes[ch][i]), 4) for ch in STEM_CHANNELS}
        channels["centroid"] = round(float(centroid[i]), 1)
        states.append({
            "time": round(i / TARGET_FPS, 4),
            "channels": channels,
        })

    result = {
        "song": song_name,
        "source_file": input_path.name,
        "duration": round(duration, 2),
        "fps": TARGET_FPS,
        "channels": STEM_CHANNELS + ["centroid"],
        "n_frames": min_len,
        "states": states,
    }

    # Save
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{song_name}_stems.json"
    with open(out_path, "w") as f:
        json.dump(result, f)

    # Summary stats
    print(f"\n  Results ({min_len} frames, {min_len/TARGET_FPS:.1f}s):")
    for ch in STEM_CHANNELS:
        vals = envelopes[ch]
        print(f"    {ch:16s}  mean={vals.mean():.3f}  max={vals.max():.3f}  >0.5: {(vals > 0.5).sum():5d} frames")
    print(f"\n  Saved: {out_path}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Analyze audio: demucs stem separation + energy extraction")
    parser.add_argument("audio_file", type=str, help="Path to audio file (mp3/wav/flac)")
    parser.add_argument("--output-dir", type=str, default=None,
                        help="Output directory (default: same as v2/)")
    parser.add_argument("--cache-dir", type=str, default=None,
                        help="Demucs cache directory")
    args = parser.parse_args()

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        print(f"Error: File not found: {audio_path}")
        sys.exit(1)

    script_dir = Path(__file__).parent
    output_dir = Path(args.output_dir) if args.output_dir else script_dir
    cache_dir = Path(args.cache_dir) if args.cache_dir else script_dir / ".demucs_cache"

    analyze(audio_path, output_dir, cache_dir)


if __name__ == "__main__":
    main()
