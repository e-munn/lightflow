"""LightFlow v3 — AI Lighting Director.

CLI entry point for analyzing songs, generating show plans, and running shows.

Usage:
    python v3/main.py analyze "~/Desktop/song.mp3"
    python v3/main.py generate song_analysis.json --style energetic
    python v3/main.py run song_analysis.json song_show.json --audio "~/Desktop/song.mp3"
    python v3/main.py full "~/Desktop/song.mp3" --style energetic
"""

from __future__ import annotations

import argparse
import json

from dotenv import load_dotenv
load_dotenv()
import sys
from pathlib import Path

# Ensure v3 is on the path for local imports
sys.path.insert(0, str(Path(__file__).parent))


def cmd_analyze(args):
    from analyze import analyze_song
    from schemas import AnalysisResult

    audio_path = Path(args.audio_file).expanduser().resolve()
    if not audio_path.exists():
        print(f"Error: File not found: {audio_path}")
        sys.exit(1)

    output_dir = Path(args.output_dir) if args.output_dir else audio_path.parent
    cache_dir = Path(args.cache_dir) if args.cache_dir else Path(__file__).parent / ".demucs_cache"

    result = analyze_song(audio_path, output_dir, cache_dir)

    out_path = output_dir / f"{audio_path.stem}_analysis.json"
    print(f"\nAnalysis saved: {out_path}")
    return result


def cmd_generate(args):
    from generate import generate_show
    from schemas import AnalysisResult, ShowPlan

    analysis_path = Path(args.analysis_file).expanduser().resolve()
    if not analysis_path.exists():
        print(f"Error: File not found: {analysis_path}")
        sys.exit(1)

    with open(analysis_path) as f:
        analysis = AnalysisResult(**json.load(f))

    show = generate_show(analysis, style=args.style, model=args.model)

    output_dir = Path(args.output_dir) if args.output_dir else analysis_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / f"{analysis.song}_show.json"

    with open(out_path, "w") as f:
        json.dump(show.model_dump(), f, indent=2)

    print(f"\nShow plan saved: {out_path}")
    return show


def cmd_run(args):
    from execute import ShowExecutor
    from schemas import AnalysisResult, ShowPlan

    analysis_path = Path(args.analysis_file).expanduser().resolve()
    show_path = Path(args.show_file).expanduser().resolve()

    for p in [analysis_path, show_path]:
        if not p.exists():
            print(f"Error: File not found: {p}")
            sys.exit(1)

    with open(analysis_path) as f:
        analysis = AnalysisResult(**json.load(f))
    with open(show_path) as f:
        show = ShowPlan(**json.load(f))

    audio_path = args.audio
    if audio_path:
        audio_path = str(Path(audio_path).expanduser().resolve())

    executor = ShowExecutor(
        analysis=analysis,
        show=show,
        audio_path=audio_path,
        dmx_port=args.dmx_port,
        no_dmx=args.no_dmx,
        fps=args.fps,
        visual_offset=args.visual_offset / 1000.0,
    )
    executor.run()


def cmd_demo(args):
    """Cycle through effects in white-only to evaluate shapes and motion."""
    import math
    import time

    import numpy as np
    import pygame

    from effects import (
        ALL_EFFECTS, EffectContext, apply_glow, render_section_frame, reset_smoothing,
    )
    from preview import PreviewWindow
    from schemas import (
        PIXELS_PER_TUBE, NUM_TUBES,
        EffectInstance, Color, Region, StemFrame, StemEnergies, StemOnsets,
    )

    WHITE = Color(r=1.0, g=1.0, b=1.0)
    BPM = 128.0
    FPS = 30
    SECS_PER_EFFECT = float(args.duration)

    effect_names = [cls().name for cls in ALL_EFFECTS]
    # Skip blackout — it's just black
    effect_names = [n for n in effect_names if n != "blackout"]

    if args.effect:
        # Filter to specific effect(s)
        chosen = [e.strip() for e in args.effect.split(",")]
        effect_names = [n for n in effect_names if n in chosen]
        if not effect_names:
            print(f"Unknown effect(s): {args.effect}")
            print(f"Available: {', '.join(cls().name for cls in ALL_EFFECTS)}")
            sys.exit(1)

    print(f"Demo: {len(effect_names)} effects, {SECS_PER_EFFECT}s each, white only")
    print(f"  LEFT/RIGHT arrows to skip, ESC to quit\n")

    preview = PreviewWindow(title="LightFlow — Effect Demo")
    preview.open()
    reset_smoothing()

    idx = 0
    effect_start = time.time()
    wall_start = time.time()
    prev_t = 0.0

    try:
        while True:
            now = time.time()
            t = now - wall_start
            dt = t - prev_t
            prev_t = t

            effect_elapsed = now - effect_start

            # Auto-advance
            if effect_elapsed >= SECS_PER_EFFECT:
                idx += 1
                if idx >= len(effect_names):
                    if args.loop:
                        idx = 0
                    else:
                        break
                reset_smoothing()
                effect_start = now
                effect_elapsed = 0.0

            name = effect_names[idx]

            # Simulate musical stem data at BPM
            beat_phase = (t * BPM / 60.0) % 1.0
            bar_phase = (t * BPM / 60.0 / 4.0) % 1.0
            kick_energy = max(0, 1.0 - beat_phase * 4) ** 2  # sharp transient each beat
            snare_energy = max(0, 1.0 - ((beat_phase + 0.5) % 1.0) * 4) ** 2  # backbeat
            hat_energy = max(0, 1.0 - (beat_phase * 2 % 1.0) * 6) ** 2  # 8ths
            bass_energy = 0.5 + 0.4 * math.sin(t * BPM / 60.0 * math.pi)
            vocal_energy = 0.3 + 0.3 * math.sin(t * 0.7)

            kick_onset = 1.0 if beat_phase < 0.05 else 0.0
            snare_onset = 1.0 if abs(beat_phase - 0.5) < 0.05 else 0.0
            hat_onset = 1.0 if (beat_phase * 2 % 1.0) < 0.05 else 0.0

            frame = StemFrame(
                time=t,
                stems=StemEnergies(
                    bass=bass_energy, kick=kick_energy, snare=snare_energy,
                    hat=hat_energy, vocals=vocal_energy, other=0.2,
                ),
                onsets=StemOnsets(kick=kick_onset, snare=snare_onset, hat=hat_onset),
                spectral_flux=kick_onset * 0.5 + snare_onset * 0.3,
            )
            ctx = EffectContext(frame=frame, time=t, bpm=BPM, dt=dt)

            # Pick an appropriate intensity source for the effect
            source = "none"
            if name in ("bass_fill",):
                source = "bass"
            elif name in ("kick_flash", "impact", "firecracker"):
                source = "kick"
            elif name in ("snare_accent",):
                source = "snare"
            elif name in ("hat_sparkle",):
                source = "hat"
            elif name in ("vocal_wave", "spectral_color", "pan_sweep"):
                source = "vocals"
            elif name in ("energy_pulse", "chase", "scan", "buildup_rise",
                          "strobe", "flux_burst"):
                source = "kick"
            elif name in ("strobe_chase",):
                source = "none"

            inst = EffectInstance(
                effect=name,
                color=WHITE,
                intensity_source=source,
                region=Region(preset="all"),
                intensity=1.0,
                speed=1.0,
                release_beats=0.5,
                direction="down" if name == "meteor" else "up",
                onset_mode=name in ("kick_flash", "snare_accent", "hat_sparkle", "impact", "firecracker"),
            )
            grid = render_section_frame([inst], ctx)
            grid = apply_glow(grid, amount=0.3)

            # Handle events
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    raise KeyboardInterrupt
                if event.type == pygame.KEYDOWN:
                    if event.key == pygame.K_ESCAPE:
                        raise KeyboardInterrupt
                    elif event.key == pygame.K_RIGHT:
                        idx = min(idx + 1, len(effect_names) - 1)
                        reset_smoothing()
                        effect_start = time.time()
                    elif event.key == pygame.K_LEFT:
                        idx = max(idx - 1, 0)
                        reset_smoothing()
                        effect_start = time.time()

            if not preview.update(grid, t, f"{idx+1}/{len(effect_names)}  {name}"):
                break

            time.sleep(max(0, 1.0 / FPS - (time.time() - now)))

    except KeyboardInterrupt:
        pass
    finally:
        preview.close()

    print("Demo complete.")


def _pick_song(music_dir: Path) -> Path:
    """List audio files in a directory and let the user pick one by number."""
    exts = {".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg"}
    files = sorted(
        [f for f in music_dir.iterdir() if f.suffix.lower() in exts],
        key=lambda p: p.name.lower(),
    )
    if not files:
        print(f"No audio files found in {music_dir}")
        sys.exit(1)

    print(f"\nFound {len(files)} tracks in {music_dir.name}/\n")
    for i, f in enumerate(files, 1):
        print(f"  {i:3d}. {f.name}")
    print()

    while True:
        try:
            choice = input(f"Pick a track (1-{len(files)}): ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(files):
                return files[idx]
        except (ValueError, EOFError):
            pass
        print("  Invalid choice, try again.")


def cmd_full(args):
    """Run the full pipeline: analyze -> generate -> run."""
    from analyze import analyze_song
    from generate import generate_show
    from execute import ShowExecutor
    from schemas import AnalysisResult, ShowPlan

    # Resolve audio file: either positional arg or --music-dir picker
    if args.audio_file:
        audio_path = Path(args.audio_file).expanduser().resolve()
        if not audio_path.exists():
            print(f"Error: File not found: {audio_path}")
            sys.exit(1)
    elif args.music_dir:
        music_dir = Path(args.music_dir).expanduser().resolve()
        if not music_dir.is_dir():
            print(f"Error: Not a directory: {music_dir}")
            sys.exit(1)
        audio_path = _pick_song(music_dir)
    else:
        print("Error: Provide an audio file or --music-dir")
        sys.exit(1)

    output_dir = Path(args.output_dir) if args.output_dir else audio_path.parent
    cache_dir = Path(args.cache_dir) if args.cache_dir else Path(__file__).parent / ".demucs_cache"
    no_cache = args.no_cache

    # Step 1: Analyze
    print("\n" + "=" * 60)
    print("STEP 1: Analyzing song")
    print("=" * 60)
    analysis_path = output_dir / f"{audio_path.stem}_analysis.json"
    if not no_cache and analysis_path.exists():
        print(f"  Found existing analysis: {analysis_path.name}")
        choice = input("  Load previous analysis? [Y/n]: ").strip().lower()
        if choice != "n":
            with open(analysis_path) as f:
                analysis = AnalysisResult(**json.load(f))
            print(f"  Loaded ({len(analysis.frames)} frames, {len(analysis.sections)} sections)")
        else:
            analysis = analyze_song(audio_path, output_dir, cache_dir)
    else:
        analysis = analyze_song(audio_path, output_dir, cache_dir)

    # Step 2: Generate
    print("\n" + "=" * 60)
    print("STEP 2: Generating show plan")
    print("=" * 60)
    show_path = output_dir / f"{audio_path.stem}_show.json"
    if not no_cache and show_path.exists():
        print(f"  Found existing show: {show_path.name}")
        choice = input("  Load previous show plan? [Y/n]: ").strip().lower()
        if choice != "n":
            with open(show_path) as f:
                show = ShowPlan(**json.load(f))
            print(f"  Loaded ({len(show.sections)} sections)")
        else:
            show = generate_show(analysis, style=args.style, model=args.model)
            with open(show_path, "w") as f:
                json.dump(show.model_dump(), f, indent=2)
            print(f"  Show plan saved: {show_path}")
    else:
        show = generate_show(analysis, style=args.style, model=args.model)
        show_path.parent.mkdir(parents=True, exist_ok=True)
        with open(show_path, "w") as f:
            json.dump(show.model_dump(), f, indent=2)
        print(f"  Show plan saved: {show_path}")

    # Step 3: Run
    print("\n" + "=" * 60)
    print("STEP 3: Running show")
    print("=" * 60)
    executor = ShowExecutor(
        analysis=analysis,
        show=show,
        audio_path=str(audio_path),
        dmx_port=args.dmx_port,
        no_dmx=args.no_dmx,
        fps=args.fps,
        visual_offset=args.visual_offset / 1000.0,
    )
    executor.run()


def main():
    parser = argparse.ArgumentParser(
        description="LightFlow v3 — AI Lighting Director",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # analyze
    p_analyze = subparsers.add_parser("analyze", help="Analyze a song (demucs + sections + BPM)")
    p_analyze.add_argument("audio_file", help="Path to audio file (mp3/wav/flac)")
    p_analyze.add_argument("--output-dir", help="Output directory")
    p_analyze.add_argument("--cache-dir", help="Demucs cache directory")
    p_analyze.set_defaults(func=cmd_analyze)

    # generate
    p_gen = subparsers.add_parser("generate", help="Generate a show plan using Claude")
    p_gen.add_argument("analysis_file", help="Path to analysis JSON")
    p_gen.add_argument("--style", default="energetic", help="Show style (energetic/elegant/dramatic/chill/party)")
    p_gen.add_argument("--model", default="claude-sonnet-4-6", help="Claude model to use")
    p_gen.add_argument("--output-dir", help="Output directory")
    p_gen.set_defaults(func=cmd_generate)

    # run
    p_run = subparsers.add_parser("run", help="Run a show (audio playback + preview)")
    p_run.add_argument("analysis_file", help="Path to analysis JSON")
    p_run.add_argument("show_file", help="Path to show plan JSON")
    p_run.add_argument("--audio", help="Path to audio file for playback")
    p_run.add_argument("--dmx-port", help="DMX USB adapter port")
    p_run.add_argument("--no-dmx", action="store_true", help="Skip DMX output")
    p_run.add_argument("--fps", type=int, default=30, help="Render FPS (default: 30)")
    p_run.add_argument("--visual-offset", type=float, default=-50,
                        help="Visual timing offset in ms (default: -50, negative = delay lights)")
    p_run.set_defaults(func=cmd_run)

    # demo
    p_demo = subparsers.add_parser("demo", help="Cycle through effects in white to evaluate visuals")
    p_demo.add_argument("--effect", help="Comma-separated effect names to demo (default: all)")
    p_demo.add_argument("--duration", type=float, default=6.0, help="Seconds per effect (default: 6)")
    p_demo.add_argument("--loop", action="store_true", help="Loop forever")
    p_demo.set_defaults(func=cmd_demo)

    # full
    p_full = subparsers.add_parser("full", help="Full pipeline: analyze -> generate -> run")
    p_full.add_argument("audio_file", nargs="?", default=None, help="Path to audio file")
    p_full.add_argument("--music-dir", help="Directory of audio files (pick from list)")
    p_full.add_argument("--style", default="energetic", help="Show style")
    p_full.add_argument("--model", default="claude-sonnet-4-6", help="Claude model")
    p_full.add_argument("--output-dir", help="Output directory")
    p_full.add_argument("--cache-dir", help="Demucs cache directory")
    p_full.add_argument("--dmx-port", help="DMX USB adapter port")
    p_full.add_argument("--no-dmx", action="store_true", help="Skip DMX output")
    p_full.add_argument("--fps", type=int, default=30, help="Render FPS")
    p_full.add_argument("--no-cache", action="store_true", help="Skip cache prompts, always regenerate")
    p_full.add_argument("--visual-offset", type=float, default=-50,
                        help="Visual timing offset in ms (default: -50, negative = delay lights)")
    p_full.set_defaults(func=cmd_full)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
