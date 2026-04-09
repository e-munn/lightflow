"""Ingest a directory of audio files into public/songs/ as testable presets.

For each audio file in the input dir:
  1. Copy to  public/songs/<safe_slug><ext>
  2. Run analyze_song -> public/songs/<safe_slug>_analysis.json
  3. Append to  public/songs/manifest.json

Idempotent: re-running skips files whose analysis.json already exists.

Usage:
    python scripts/ingest_audio_dir.py /Users/elijah/Music/banjo/mama
    python scripts/ingest_audio_dir.py ./tracks --limit 10
    python scripts/ingest_audio_dir.py ./tracks --force
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path

# Make analyze.py importable
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "archive" / "v3-python"))

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"}
PUBLIC_SONGS = REPO_ROOT / "public" / "songs"
MANIFEST = PUBLIC_SONGS / "manifest.json"


def safe_slug(name: str) -> str:
    s = re.sub(r"\.[^.]+$", "", name)            # drop extension
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s)      # safe chars
    s = re.sub(r"_+", "_", s).strip("_-.")
    return s or "untitled"


def load_manifest() -> list[dict]:
    if not MANIFEST.exists():
        return []
    try:
        return json.loads(MANIFEST.read_text())
    except Exception:
        return []


def save_manifest(entries: list[dict]) -> None:
    PUBLIC_SONGS.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(entries, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input_dir", type=Path)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--recursive", "-r", action="store_true", help="walk nested subdirectories")
    ap.add_argument("--force", action="store_true", help="re-analyze even if analysis.json exists")
    args = ap.parse_args()

    in_dir = args.input_dir.expanduser().resolve()
    if not in_dir.exists():
        print(f"error: {in_dir} does not exist", file=sys.stderr)
        return 2

    walker = in_dir.rglob("*") if args.recursive else in_dir.iterdir()
    audio_files = sorted(p for p in walker if p.suffix.lower() in AUDIO_EXTS and p.is_file())
    if args.limit:
        audio_files = audio_files[: args.limit]

    if not audio_files:
        print(f"No audio files found in {in_dir}")
        return 0

    PUBLIC_SONGS.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    seen_slugs = {e["slug"] for e in manifest}

    print(f"Ingesting {len(audio_files)} files into {PUBLIC_SONGS}")
    print()

    # Lazy-import the analyzer (heavy: torch + demucs)
    print("Loading analyzer (torch + demucs)…")
    from analyze import analyze_song
    print()

    counts = {"analyzed": 0, "skipped": 0, "failed": 0}
    cache_dir = PUBLIC_SONGS / ".demucs_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    t0_total = time.time()

    for i, src in enumerate(audio_files, 1):
        slug = safe_slug(src.name)
        # Disambiguate if a different source already used this slug
        base_slug = slug
        n = 1
        while slug in seen_slugs and not (PUBLIC_SONGS / f"{slug}_analysis.json").exists():
            n += 1
            slug = f"{base_slug}_{n}"

        ext = src.suffix.lower()
        audio_dst = PUBLIC_SONGS / f"{slug}{ext}"
        analysis_dst = PUBLIC_SONGS / f"{slug}_analysis.json"

        if analysis_dst.exists() and not args.force:
            print(f"[{i}/{len(audio_files)}] {slug}  (cached, skip)")
            counts["skipped"] += 1
            if slug not in seen_slugs:
                manifest.append({"slug": slug, "name": src.stem, "ext": ext})
                seen_slugs.add(slug)
            continue

        try:
            t0 = time.time()
            if not audio_dst.exists():
                shutil.copy2(src, audio_dst)
            # analyze_song writes <stem>_analysis.json into the output_dir
            tmp_out = PUBLIC_SONGS / f".tmp_{slug}"
            tmp_out.mkdir(exist_ok=True)
            result = analyze_song(audio_dst, tmp_out, cache_dir)
            # Move into canonical location
            (tmp_out / f"{audio_dst.stem}_analysis.json").replace(analysis_dst)
            shutil.rmtree(tmp_out, ignore_errors=True)
            counts["analyzed"] += 1
            if slug not in seen_slugs:
                manifest.append({
                    "slug": slug,
                    "name": src.stem,
                    "ext": ext,
                    "duration": result.duration,
                    "bpm": result.bpm,
                })
                seen_slugs.add(slug)
            save_manifest(manifest)        # save incrementally
            print(f"[{i}/{len(audio_files)}] {slug}  bpm={result.bpm:.0f}  dur={result.duration:.0f}s  ({time.time()-t0:.0f}s)")
        except Exception as e:
            counts["failed"] += 1
            print(f"[{i}/{len(audio_files)}] {slug}  FAILED: {e}")

    elapsed = time.time() - t0_total
    print()
    print(f"Done in {elapsed/60:.1f} min")
    print(f"  analyzed: {counts['analyzed']}")
    print(f"  skipped:  {counts['skipped']}")
    print(f"  failed:   {counts['failed']}")
    print(f"  manifest: {MANIFEST}  ({len(manifest)} entries)")
    return 0 if counts["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
