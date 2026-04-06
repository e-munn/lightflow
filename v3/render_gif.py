"""Render a show plan to an animated GIF for visual inspection.

Usage:
  python render_gif.py synthetic/synth_dnb_show.json synthetic/synth_dnb_analysis.json
  python render_gif.py synthetic/synth_dnb_show.json synthetic/synth_dnb_analysis.json -o preview.gif --fps 15
  python render_gif.py synthetic/synth_dnb_show.json synthetic/synth_dnb_analysis.json --speed 4
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from effects import EffectContext, LiveInput, render_section_frame, apply_glow, reset_smoothing
from schemas import AnalysisResult, ShowPlan, NUM_TUBES, PIXELS_PER_TUBE


# Visual layout
PIXEL_SIZE = 16       # Size of each pixel in the output image
TUBE_GAP = 4          # Gap between tubes
MARGIN = 20           # Margin around the grid
LABEL_HEIGHT = 30     # Space for section label at bottom


def grid_to_image(grid: np.ndarray, section_label: str, time_s: float) -> Image.Image:
    """Convert a 16x8x3 float grid to a PIL Image with labels."""
    rows, cols, _ = grid.shape  # 16 x 8 x 3

    img_w = MARGIN * 2 + cols * PIXEL_SIZE + (cols - 1) * TUBE_GAP
    img_h = MARGIN * 2 + rows * PIXEL_SIZE + LABEL_HEIGHT

    img = Image.new("RGB", (img_w, img_h), (15, 15, 15))
    draw = ImageDraw.Draw(img)

    for col in range(cols):
        x = MARGIN + col * (PIXEL_SIZE + TUBE_GAP)
        for row in range(rows):
            y = MARGIN + row * PIXEL_SIZE
            r = int(np.clip(grid[row, col, 0], 0, 1) * 255)
            g = int(np.clip(grid[row, col, 1], 0, 1) * 255)
            b = int(np.clip(grid[row, col, 2], 0, 1) * 255)
            draw.rectangle([x, y, x + PIXEL_SIZE - 1, y + PIXEL_SIZE - 1],
                           fill=(r, g, b))

    # Section label and time
    label_y = MARGIN + rows * PIXEL_SIZE + 6
    draw.text((MARGIN, label_y), f"{time_s:.1f}s — {section_label}",
              fill=(180, 180, 180))

    return img


def render_gif(
    show: ShowPlan,
    analysis: AnalysisResult,
    output_path: str = "preview.gif",
    render_fps: int = 15,
    speed: float = 4.0,
    max_duration: float | None = None,
):
    """Render the show plan to an animated GIF.

    Args:
        render_fps: Frames per second in the output GIF.
        speed: Playback speed multiplier (4x = 1 min song → 15s GIF).
        max_duration: Cap the song duration (seconds of song time).
    """
    reset_smoothing()
    live = LiveInput()

    frame_times = np.array([f.time for f in analysis.frames])
    duration = max_duration or analysis.duration

    # Time step per rendered frame (in song-time seconds)
    dt_song = speed / render_fps
    n_frames = int(duration / dt_song)

    frames: list[Image.Image] = []
    print(f"  Rendering {n_frames} frames at {render_fps}fps ({speed}x speed)...")

    for i in range(n_frames):
        t = i * dt_song

        # Find analysis frame
        idx = min(np.searchsorted(frame_times, t), len(analysis.frames) - 1)
        frame = analysis.frames[idx]

        # Find section
        section_label = ""
        section_effects = []
        for sp in show.sections:
            if sp.start <= t < sp.end:
                section_label = sp.section_label
                section_effects = sp.effects
                break

        if not section_effects:
            continue

        dt = 1.0 / render_fps  # use render dt for smoothing
        ctx = EffectContext(frame=frame, time=t, bpm=show.bpm, dt=dt, live=live)
        grid = render_section_frame(section_effects, ctx)
        grid = apply_glow(grid, amount=0.3)
        grid = np.clip(grid, 0, 1)

        img = grid_to_image(grid, section_label, t)
        frames.append(img)

        if (i + 1) % 50 == 0:
            print(f"    {i + 1}/{n_frames} frames")

    if not frames:
        print("  No frames rendered!")
        return

    # Save GIF
    frame_duration_ms = int(1000 / render_fps)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=frame_duration_ms,
        loop=0,
    )
    size_mb = Path(output_path).stat().st_size / (1024 * 1024)
    print(f"  Saved: {output_path} ({len(frames)} frames, {size_mb:.1f}MB)")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Render show plan to animated GIF")
    parser.add_argument("show_json", help="ShowPlan JSON file")
    parser.add_argument("analysis_json", help="AnalysisResult JSON file")
    parser.add_argument("-o", "--output", default=None, help="Output GIF path")
    parser.add_argument("--fps", type=int, default=15, help="Output GIF FPS (default 15)")
    parser.add_argument("--speed", type=float, default=4.0, help="Playback speed multiplier (default 4x)")
    parser.add_argument("--max-duration", type=float, default=None, help="Max song duration to render (seconds)")
    args = parser.parse_args()

    with open(args.show_json) as f:
        show = ShowPlan(**json.load(f))
    with open(args.analysis_json) as f:
        analysis = AnalysisResult(**json.load(f))

    output = args.output or args.show_json.replace("_show.json", "_preview.gif")
    render_gif(show, analysis, output_path=output, render_fps=args.fps,
               speed=args.speed, max_duration=args.max_duration)


if __name__ == "__main__":
    main()
