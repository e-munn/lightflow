"""Prepare training data by running demucs stem separation and computing energy envelopes.

For each input track:
1. Run demucs htdemucs → drums, bass, vocals, other stems
2. Analyze drums stem by frequency band → kick, snare, hats
3. Compute 6 energy envelopes at 20fps, normalized 0-1
4. Save audio.wav (resampled 22050 mono) + labels.json + stems/*.wav

Usage:
    python scripts/prepare_data.py --input-dir ~/Desktop/beatport_tracks/ --output-dir data
"""

import argparse
import json
import sys
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
]

TARGET_SR = 22050
TARGET_FPS = 20
HOP_LENGTH = TARGET_SR // TARGET_FPS  # 1102 samples per frame


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
            # Convert torch tensor to numpy and save via soundfile
            if isinstance(wav, torch.Tensor):
                wav_np = wav.cpu().numpy()
            else:
                wav_np = np.array(wav)
            # demucs tensors are (channels, samples) — soundfile wants (samples, channels)
            if wav_np.ndim == 2:
                wav_np = wav_np.T
            # Clip to prevent clipping artifacts
            wav_np = np.clip(wav_np, -1.0, 1.0)
            path.parent.mkdir(parents=True, exist_ok=True)
            sf.write(str(path), wav_np, samplerate, subtype="PCM_16")
        else:
            # Fall back to original for mp3/flac
            _original_save(wav, path, samplerate, **kwargs)

    demucs.audio.save_audio = _patched_save_audio
    print("  Patched demucs save_audio to use soundfile (bypassing torchcodec)")


def run_demucs(input_path: Path, output_dir: Path) -> Path:
    """Run demucs htdemucs on a single track using the Python API."""
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    from demucs.audio import AudioFile, save_audio

    print(f"  Running demucs on {input_path.name}...")

    # Load model
    model = get_model("htdemucs")
    model.eval()

    # Load audio
    audio_file = AudioFile(input_path).read(
        streams=0, samplerate=model.samplerate, channels=model.audio_channels
    )
    ref = audio_file.mean(0)
    audio_file = (audio_file - ref.mean()) / ref.std()

    # Separate
    device = torch.device("cpu")  # CPU for stability during data prep
    sources = apply_model(model, audio_file[None], device=device)[0]
    sources = sources * ref.std() + ref.mean()

    # Save stems
    track_stem = input_path.stem
    stems_dir = output_dir / "htdemucs" / track_stem
    stems_dir.mkdir(parents=True, exist_ok=True)

    for source_name, source_audio in zip(model.sources, sources):
        save_audio(source_audio, stems_dir / f"{source_name}.wav", model.samplerate)
        print(f"    Saved {source_name}.wav")

    return stems_dir


def compute_rms_envelope(audio: np.ndarray, hop_length: int) -> np.ndarray:
    """Compute RMS energy envelope at given hop length."""
    rms = librosa.feature.rms(y=audio, frame_length=hop_length * 2, hop_length=hop_length)[0]
    return rms


def normalize_envelope(env: np.ndarray) -> np.ndarray:
    """Normalize envelope to 0-1 range."""
    max_val = env.max()
    if max_val < 1e-10:
        return np.zeros_like(env)
    return env / max_val


def analyze_drum_bands(audio: np.ndarray, sr: int, hop_length: int) -> dict[str, np.ndarray]:
    """Analyze drums audio by frequency bands to separate kick, snare, and hats.

    Ported from backend/main.py:665-712.

    - Kick: 20-250 Hz
    - Snare: 150-400 Hz (body) + 2-5 kHz (crack/snap)
    - Hats: 6kHz+
    """
    n_fft = 2048
    S = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop_length))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    kick_mask = (freqs >= 20) & (freqs <= 250)
    snare_low_mask = (freqs >= 150) & (freqs <= 400)
    snare_high_mask = (freqs >= 2000) & (freqs <= 5000)
    hats_mask = freqs >= 6000

    kick_energy = np.sqrt(np.mean(S[kick_mask, :] ** 2, axis=0))
    snare_low_energy = np.sqrt(np.mean(S[snare_low_mask, :] ** 2, axis=0))
    snare_high_energy = np.sqrt(np.mean(S[snare_high_mask, :] ** 2, axis=0))
    snare_energy = snare_low_energy * 0.4 + snare_high_energy * 0.6
    hats_energy = np.sqrt(np.mean(S[hats_mask, :] ** 2, axis=0))

    return {
        "kick": normalize_envelope(kick_energy),
        "snare": normalize_envelope(snare_energy),
        "hats": normalize_envelope(hats_energy),
    }


def resample_envelope(env: np.ndarray, source_sr: int, source_hop: int, target_fps: int, duration: float) -> np.ndarray:
    """Resample an envelope to target FPS using linear interpolation."""
    n_target = int(duration * target_fps)
    source_times = librosa.frames_to_time(np.arange(len(env)), sr=source_sr, hop_length=source_hop)
    target_times = np.arange(n_target) / target_fps
    return np.interp(target_times, source_times, env)


def process_track(input_path: Path, output_dir: Path, demucs_cache_dir: Path):
    """Process a single track: separate stems, compute envelopes, save output."""
    track_name = input_path.stem
    track_output = output_dir / track_name
    track_output.mkdir(parents=True, exist_ok=True)
    stems_out = track_output / "stems"
    stems_out.mkdir(exist_ok=True)

    print(f"\nProcessing: {track_name}")

    # Step 1: Run demucs (or use cached results if stems actually exist)
    cached_stems = demucs_cache_dir / "htdemucs" / track_name
    expected_stems = ["bass.wav", "drums.wav", "vocals.wav", "other.wav"]
    cache_valid = cached_stems.exists() and all((cached_stems / s).exists() for s in expected_stems)

    if cache_valid:
        print(f"  Using cached demucs stems from {cached_stems}")
        demucs_dir = cached_stems
    else:
        if cached_stems.exists():
            print(f"  Cache exists but incomplete — re-running demucs")
            import shutil
            shutil.rmtree(cached_stems)
        demucs_dir = run_demucs(input_path, demucs_cache_dir)

    # Step 2: Load and resample mixed audio to mono 22050
    print(f"  Loading mixed audio...")
    y_mix, _ = librosa.load(input_path, sr=TARGET_SR, mono=True)
    duration = len(y_mix) / TARGET_SR
    print(f"  Duration: {duration:.1f}s ({len(y_mix)} samples)")

    # Save resampled mix
    sf.write(str(track_output / "audio.wav"), y_mix, TARGET_SR)

    # Step 3: Load stems and compute envelopes
    stem_names = ["bass", "drums", "vocals", "other"]
    stems = {}
    for stem_name in stem_names:
        stem_path = demucs_dir / f"{stem_name}.wav"
        if not stem_path.exists():
            print(f"  WARNING: Missing stem {stem_path}")
            continue
        y_stem, _ = librosa.load(stem_path, sr=TARGET_SR, mono=True)
        stems[stem_name] = y_stem
        # Save stem copy
        sf.write(str(stems_out / f"{stem_name}.wav"), y_stem, TARGET_SR)

    if len(stems) < 4:
        raise RuntimeError(f"Only {len(stems)}/4 stems found — demucs may have failed")

    # Step 4: Compute energy envelopes
    n_frames = int(duration * TARGET_FPS)
    envelopes = {}

    # Bass energy from bass stem
    env = compute_rms_envelope(stems["bass"], HOP_LENGTH)
    envelopes["bass_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Drum sub-bands from drums stem
    drum_bands = analyze_drum_bands(stems["drums"], TARGET_SR, HOP_LENGTH)
    for band_name, channel_name in [("kick", "kick_energy"), ("snare", "snare_energy"), ("hats", "hat_energy")]:
        env = drum_bands[band_name]
        envelopes[channel_name] = resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)[:n_frames]

    # Vocals energy
    env = compute_rms_envelope(stems["vocals"], HOP_LENGTH)
    envelopes["vocals_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Other energy
    env = compute_rms_envelope(stems["other"], HOP_LENGTH)
    envelopes["other_energy"] = normalize_envelope(
        resample_envelope(env, TARGET_SR, HOP_LENGTH, TARGET_FPS, duration)
    )

    # Ensure all envelopes are same length
    min_len = min(len(v) for v in envelopes.values())
    for k in envelopes:
        envelopes[k] = envelopes[k][:min_len]

    # Step 5: Build labels.json
    states = []
    for i in range(min_len):
        t = i / TARGET_FPS
        channels = {ch: round(float(envelopes[ch][i]), 4) for ch in STEM_CHANNELS}
        states.append({"time": round(t, 4), "channels": channels})

    labels = {
        "fps": TARGET_FPS,
        "channels": STEM_CHANNELS,
        "duration": round(duration, 2),
        "source_file": input_path.name,
        "states": states,
    }

    with open(track_output / "labels.json", "w") as f:
        json.dump(labels, f)

    print(f"  Saved {min_len} frames ({min_len/TARGET_FPS:.1f}s) to {track_output}")
    print(f"  Channels: {STEM_CHANNELS}")


def main():
    parser = argparse.ArgumentParser(description="Prepare training data from audio tracks using demucs")
    parser.add_argument("--input-dir", type=str, required=True,
                        help="Directory containing WAV/MP3 tracks")
    parser.add_argument("--output-dir", type=str, default="data",
                        help="Output directory for processed training data")
    parser.add_argument("--demucs-cache", type=str, default=None,
                        help="Cache directory for demucs output (defaults to output-dir/.demucs_cache)")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    demucs_cache = Path(args.demucs_cache) if args.demucs_cache else output_dir / ".demucs_cache"

    if not input_dir.exists():
        print(f"Error: Input directory does not exist: {input_dir}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    demucs_cache.mkdir(parents=True, exist_ok=True)

    # Patch demucs to save via soundfile (bypasses torchcodec/ffmpeg version issues)
    _patch_demucs_save()

    # Find audio files
    audio_extensions = {".wav", ".mp3", ".flac", ".ogg"}
    tracks = sorted(
        p for p in input_dir.iterdir()
        if p.suffix.lower() in audio_extensions and not p.name.startswith(".")
    )

    if not tracks:
        print(f"No audio files found in {input_dir}")
        sys.exit(1)

    print(f"Found {len(tracks)} tracks in {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Demucs cache: {demucs_cache}")

    for track in tracks:
        try:
            process_track(track, output_dir, demucs_cache)
        except Exception as e:
            print(f"  ERROR processing {track.name}: {e}")
            import traceback
            traceback.print_exc()
            continue

    print(f"\nDone! Processed {len(tracks)} tracks → {output_dir}")


if __name__ == "__main__":
    main()
