"""Headless batch processor for generating v4 training data.

Pipeline per song:
  1. Run v3 analyze_song() (Demucs + features, cached)
  2. Run v3 generate_show() (Claude API, 2-3 style variants)
  3. Render every frame through v3's effect engine
  4. Convert rendered grids to protocol vectors
  5. Extract v1's 143-dim features from mixed audio
  6. Save paired training data: (v1_features, protocol_vector) per frame

Usage:
    python -m data.batch_generate --audio-dir ~/music --output-dir data/training
"""

from __future__ import annotations

import json
import sys
import time as time_mod
from pathlib import Path

import librosa
import numpy as np

# Add v3 and v1 to sys.path for imports
V3_DIR = Path(__file__).resolve().parent.parent.parent / "v3"
V1_DIR = Path(__file__).resolve().parent.parent.parent / "v1" / "model"
if str(V3_DIR) not in sys.path:
    sys.path.insert(0, str(V3_DIR))
if str(V1_DIR) not in sys.path:
    sys.path.insert(0, str(V1_DIR))

from schemas import AnalysisResult, ShowPlan
from analyze import analyze_song
from generate import generate_show

from src.features import AudioFeatureExtractor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from data.render_labels import render_protocol_vectors
from model.protocol import PROTOCOL_DIM

# v1 audio config for feature extraction
V1_AUDIO_CONFIG = {
    "audio": {
        "sample_rate": 22050,
        "hop_length": 512,
        "n_fft": 2048,
        "n_mels": 128,
        "window_seconds": 0.5,
    }
}

STYLES = ["energetic", "dramatic", "chill"]
TARGET_FPS = 30


def discover_audio_files(audio_dir: Path) -> list[Path]:
    """Find all audio files in a directory."""
    extensions = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}
    files = []
    for f in sorted(audio_dir.iterdir()):
        if f.suffix.lower() in extensions and not f.name.startswith("."):
            files.append(f)
    return files


def extract_v1_features(
    audio_path: Path,
    fps: int = TARGET_FPS,
) -> np.ndarray:
    """Extract v1's 143-dim features from mixed audio at target fps.

    Returns:
        (n_frames, 143) feature array, one vector per frame at `fps`.
    """
    extractor = AudioFeatureExtractor(V1_AUDIO_CONFIG)
    sr = V1_AUDIO_CONFIG["audio"]["sample_rate"]
    hop_length = V1_AUDIO_CONFIG["audio"]["hop_length"]
    window_samples = int(V1_AUDIO_CONFIG["audio"]["window_seconds"] * sr)
    hop_samples = int(sr / fps)  # one feature vector per frame at target fps

    y, _ = librosa.load(audio_path, sr=sr, mono=True)

    all_features = []
    pos = 0
    while pos + window_samples <= len(y):
        window = y[pos:pos + window_samples]
        features = extractor.extract_fast(window)
        feature_array = extractor.concat_features(features)
        # Global pool each window to a single feature vector
        feature_vec = feature_array.mean(axis=0)  # (143,)
        all_features.append(feature_vec)
        pos += hop_samples

    return np.stack(all_features).astype(np.float32)  # (n_frames, 143)


def process_song(
    audio_path: Path,
    output_dir: Path,
    cache_dir: Path,
    styles: list[str] | None = None,
    model: str = "claude-sonnet-4-6",
) -> dict:
    """Process a single song through the full pipeline.

    Returns:
        Summary dict with frame counts and paths.
    """
    if styles is None:
        styles = STYLES

    song_name = audio_path.stem
    song_output = output_dir / song_name
    song_output.mkdir(parents=True, exist_ok=True)

    analysis_dir = output_dir / "_analysis"
    analysis_dir.mkdir(parents=True, exist_ok=True)

    # Check for existing processed data
    existing_styles = []
    for style in styles:
        if (song_output / f"features_{style}.npy").exists() and \
           (song_output / f"labels_{style}.npy").exists():
            existing_styles.append(style)

    if len(existing_styles) == len(styles):
        print(f"  [{song_name}] Already processed all styles, skipping")
        n_frames = len(np.load(song_output / f"features_{styles[0]}.npy"))
        return {"song": song_name, "frames": n_frames * len(styles), "skipped": True}

    # Step 1: Analyze song (Demucs + features)
    analysis_path = analysis_dir / f"{song_name}_analysis.json"
    if analysis_path.exists():
        print(f"  [{song_name}] Loading cached analysis...")
        with open(analysis_path) as f:
            analysis = AnalysisResult.model_validate(json.load(f))
    else:
        print(f"  [{song_name}] Running analysis (Demucs + features)...")
        analysis = analyze_song(audio_path, analysis_dir, cache_dir)

    # Step 2: Extract v1 features from mixed audio
    features_path = song_output / "v1_features.npy"
    if features_path.exists():
        print(f"  [{song_name}] Loading cached v1 features...")
        v1_features = np.load(features_path)
    else:
        print(f"  [{song_name}] Extracting v1 features...")
        t0 = time_mod.time()
        v1_features = extract_v1_features(audio_path, fps=TARGET_FPS)
        np.save(features_path, v1_features)
        print(f"  [{song_name}] Features: {v1_features.shape} in {time_mod.time()-t0:.1f}s")

    total_frames = 0

    for style in styles:
        if style in existing_styles:
            continue

        # Step 3: Generate show plan (Claude API)
        show_path = song_output / f"show_{style}.json"
        if show_path.exists():
            print(f"  [{song_name}/{style}] Loading cached show plan...")
            with open(show_path) as f:
                show = ShowPlan.model_validate(json.load(f))
        else:
            print(f"  [{song_name}/{style}] Generating show plan...")
            show = generate_show(analysis, style=style, model=model)
            with open(show_path, "w") as f:
                json.dump(show.model_dump(), f)

        # Step 4: Render frames and extract protocol vectors
        print(f"  [{song_name}/{style}] Rendering protocol vectors...")
        t0 = time_mod.time()
        protocol_vectors = render_protocol_vectors(analysis, show)
        print(f"  [{song_name}/{style}] Rendered {len(protocol_vectors)} frames in {time_mod.time()-t0:.1f}s")

        # Align lengths (v1 features may differ slightly from analysis frames)
        n = min(len(v1_features), len(protocol_vectors))
        features_aligned = v1_features[:n]
        labels_aligned = protocol_vectors[:n]

        # Save paired data
        np.save(song_output / f"features_{style}.npy", features_aligned)
        np.save(song_output / f"labels_{style}.npy", labels_aligned)

        total_frames += n

    return {"song": song_name, "frames": total_frames, "skipped": False}


def batch_generate(
    audio_dir: Path,
    output_dir: Path,
    cache_dir: Path | None = None,
    styles: list[str] | None = None,
    model: str = "claude-sonnet-4-6",
    max_songs: int | None = None,
):
    """Process all audio files in a directory.

    Args:
        audio_dir: Directory containing audio files
        output_dir: Where to save training data
        cache_dir: Demucs cache directory (default: output_dir/_demucs_cache)
        styles: List of style variants (default: energetic, dramatic, chill)
        model: Claude model for show generation
        max_songs: Limit number of songs to process
    """
    if cache_dir is None:
        cache_dir = output_dir / "_demucs_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    audio_files = discover_audio_files(audio_dir)
    if max_songs is not None:
        audio_files = audio_files[:max_songs]

    print(f"Found {len(audio_files)} audio files in {audio_dir}")
    print(f"Output: {output_dir}")
    print(f"Styles: {styles or STYLES}")
    print()

    results = []
    for i, audio_path in enumerate(audio_files):
        print(f"\n[{i+1}/{len(audio_files)}] Processing: {audio_path.name}")
        try:
            result = process_song(audio_path, output_dir, cache_dir,
                                  styles=styles, model=model)
            results.append(result)
        except Exception as e:
            print(f"  ERROR: {e}")
            results.append({"song": audio_path.stem, "error": str(e)})

    # Summary
    total_frames = sum(r.get("frames", 0) for r in results)
    n_success = sum(1 for r in results if "error" not in r)
    n_errors = sum(1 for r in results if "error" in r)
    print(f"\n{'='*60}")
    print(f"Batch complete: {n_success} songs, {n_errors} errors, {total_frames} total frames")
    print(f"{'='*60}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate v4 training data")
    parser.add_argument("--audio-dir", type=str, required=True,
                        help="Directory containing audio files")
    parser.add_argument("--output-dir", type=str, default="data/training",
                        help="Output directory for training data")
    parser.add_argument("--cache-dir", type=str, default=None,
                        help="Demucs cache directory")
    parser.add_argument("--styles", nargs="+", default=None,
                        choices=["energetic", "dramatic", "chill", "elegant", "party"],
                        help="Style variants to generate")
    parser.add_argument("--model", type=str, default="claude-sonnet-4-6",
                        help="Claude model for show generation")
    parser.add_argument("--max-songs", type=int, default=None,
                        help="Limit number of songs")
    args = parser.parse_args()

    batch_generate(
        audio_dir=Path(args.audio_dir),
        output_dir=Path(args.output_dir),
        cache_dir=Path(args.cache_dir) if args.cache_dir else None,
        styles=args.styles,
        model=args.model,
        max_songs=args.max_songs,
    )
