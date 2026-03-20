"""Offline frame renderer: converts v3 show plans to 64-dim protocol vectors.

Takes an AnalysisResult + ShowPlan and renders every frame through v3's
effect engine, then extracts protocol vector channels from:
  - Stem energies / onsets from analysis frames
  - Spatial weights from the rendered grid
  - Texture/motion/color from the effect instances in the active section
  - Section labels from the show plan
  - BPM from analysis
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

# Add v3 to path for imports
V3_DIR = Path(__file__).resolve().parent.parent.parent / "v3"
if str(V3_DIR) not in sys.path:
    sys.path.insert(0, str(V3_DIR))

from schemas import (
    AnalysisResult, ShowPlan, StemFrame, EffectInstance,
    NUM_TUBES, PIXELS_PER_TUBE,
)
from effects import (
    EffectContext, render_section_frame, apply_glow, reset_smoothing,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from model.protocol import (
    PROTOCOL_DIM, FUTURE_DIM, NUM_SECTIONS, NUM_STEMS,
    SECTION_LABELS, STEM_NAMES, Slice,
    bpm_to_normalized, section_to_onehot,
)


def _extract_texture_from_effects(effects: list[EffectInstance]) -> dict[str, float]:
    """Infer texture channels from active effect types and parameters."""
    texture = {
        "pulse": 0.0, "sparkle": 0.0, "fill": 0.0,
        "wave": 0.0, "flash": 0.0, "glow": 0.0,
    }

    effect_texture_map = {
        "energy_pulse": ("pulse", 0.8),
        "breathe": ("pulse", 0.5),
        "breathe_y": ("pulse", 0.4),
        "hat_sparkle": ("sparkle", 0.8),
        "rain": ("sparkle", 0.5),
        "firefly": ("sparkle", 0.6),
        "firecracker": ("sparkle", 0.9),
        "bass_fill": ("fill", 0.9),
        "buildup_rise": ("fill", 0.7),
        "vocal_wave": ("wave", 0.8),
        "ripple": ("wave", 0.6),
        "color_wash": ("wave", 0.4),
        "kick_flash": ("flash", 0.9),
        "snare_accent": ("flash", 0.7),
        "strobe": ("flash", 1.0),
        "strobe_chase": ("flash", 0.8),
        "impact": ("flash", 0.9),
        "solid": ("glow", 0.6),
        "gradient": ("glow", 0.5),
        "candles": ("glow", 0.7),
        "lighthouse": ("glow", 0.5),
        "fade_in": ("glow", 0.4),
        "fade_out": ("glow", 0.3),
    }

    for inst in effects:
        if inst.effect in effect_texture_map:
            channel, strength = effect_texture_map[inst.effect]
            texture[channel] = max(texture[channel], strength * inst.intensity)

    return texture


def _extract_motion_from_effects(effects: list[EffectInstance]) -> dict[str, float]:
    """Infer motion channels from active effect types and parameters."""
    motion = {"speed": 0.0, "dir_x": 0.5, "dir_y": 0.5, "complexity": 0.0}

    moving_effects = {
        "chase", "scan", "meteor", "rain", "lighthouse",
        "abracadabra", "strobe_chase", "ripple",
    }

    dir_map = {
        "left": (0.0, 0.5), "right": (1.0, 0.5),
        "up": (0.5, 0.0), "down": (0.5, 1.0),
        "outward": (0.5, 0.5), "inward": (0.5, 0.5),
    }

    max_speed = 0.0
    n_moving = 0
    for inst in effects:
        if inst.effect in moving_effects:
            n_moving += 1
            max_speed = max(max_speed, inst.speed)
            if inst.direction in dir_map:
                dx, dy = dir_map[inst.direction]
                motion["dir_x"] = dx
                motion["dir_y"] = dy

    motion["speed"] = min(max_speed / 2.0, 1.0)  # normalize: speed 2.0 -> 1.0
    motion["complexity"] = min(n_moving / 3.0, 1.0)  # 3+ moving effects -> 1.0

    return motion


def _extract_spatial_from_grid(grid: np.ndarray) -> np.ndarray:
    """Extract per-tube intensity weights from rendered grid.

    Args:
        grid: (16, 8, 3) rendered frame

    Returns:
        (8,) per-tube mean intensity
    """
    # Mean brightness per tube
    tube_brightness = grid.mean(axis=(0, 2))  # mean over pixels and RGB -> (8,)
    mx = tube_brightness.max()
    if mx > 1e-6:
        tube_brightness = tube_brightness / mx
    return tube_brightness.astype(np.float32)


def _extract_dynamics_from_effects(
    effects: list[EffectInstance], bpm: float, overall_intensity: float
) -> dict[str, float]:
    """Infer dynamics channels from effects."""
    min_attack = 200.0
    max_release = 0.0

    for inst in effects:
        attack = inst.resolve_attack_ms(bpm)
        release = inst.resolve_release_ms(bpm)
        min_attack = min(min_attack, attack)
        max_release = max(max_release, release)

    # Normalize: 10ms -> 1.0 (fast), 200ms -> 0.0 (slow)
    attack_norm = max(0.0, 1.0 - (min_attack - 10.0) / 190.0)
    # Normalize: 50ms -> 0.0 (tight), 2000ms -> 1.0 (wash)
    release_norm = min(1.0, max_release / 2000.0)

    return {
        "attack": attack_norm,
        "release": release_norm,
        "master_intensity": min(overall_intensity, 1.0),
    }


def render_protocol_vectors(
    analysis: AnalysisResult,
    show: ShowPlan,
) -> np.ndarray:
    """Render all frames and extract protocol vectors.

    Returns:
        (n_frames, 64) array of protocol vectors
    """
    n_frames = len(analysis.frames)
    fps = analysis.fps
    bpm = analysis.bpm
    dt = 1.0 / fps

    protocol_vectors = np.zeros((n_frames, PROTOCOL_DIM), dtype=np.float32)
    reset_smoothing()

    for i, stem_frame in enumerate(analysis.frames):
        t = stem_frame.time
        vec = np.zeros(PROTOCOL_DIM, dtype=np.float32)

        # === Stem energies [0:6] ===
        vec[Slice.STEM_ENERGY + 0] = stem_frame.stems.bass
        vec[Slice.STEM_ENERGY + 1] = stem_frame.stems.kick
        vec[Slice.STEM_ENERGY + 2] = stem_frame.stems.snare
        vec[Slice.STEM_ENERGY + 3] = stem_frame.stems.hat
        vec[Slice.STEM_ENERGY + 4] = stem_frame.stems.vocals
        vec[Slice.STEM_ENERGY + 5] = stem_frame.stems.other

        # === Onsets [6:9] ===
        vec[Slice.ONSET + 0] = stem_frame.onsets.kick
        vec[Slice.ONSET + 1] = stem_frame.onsets.snare
        vec[Slice.ONSET + 2] = stem_frame.onsets.hat

        # Find active section
        active_section = None
        active_section_plan = None
        for sp in show.sections:
            if sp.start <= t < sp.end:
                active_section = sp.section_label
                active_section_plan = sp
                break

        if active_section_plan is None:
            protocol_vectors[i] = vec
            continue

        # Render the frame through v3's effect engine
        ctx = EffectContext(frame=stem_frame, time=t, bpm=bpm, dt=dt)
        grid = render_section_frame(active_section_plan.effects, ctx)
        grid = apply_glow(grid, amount=0.3)
        grid = np.clip(grid, 0, 1)

        # === Spatial [9:17] ===
        vec[Slice.SPATIAL:Slice.SPATIAL + NUM_TUBES] = _extract_spatial_from_grid(grid)

        # === Motion [17:21] ===
        motion = _extract_motion_from_effects(active_section_plan.effects)
        vec[Slice.MOTION + 0] = motion["speed"]
        vec[Slice.MOTION + 1] = motion["dir_x"]
        vec[Slice.MOTION + 2] = motion["dir_y"]
        vec[Slice.MOTION + 3] = motion["complexity"]

        # === Texture [21:27] ===
        texture = _extract_texture_from_effects(active_section_plan.effects)
        vec[Slice.TEXTURE + 0] = texture["pulse"]
        vec[Slice.TEXTURE + 1] = texture["sparkle"]
        vec[Slice.TEXTURE + 2] = texture["fill"]
        vec[Slice.TEXTURE + 3] = texture["wave"]
        vec[Slice.TEXTURE + 4] = texture["flash"]
        vec[Slice.TEXTURE + 5] = texture["glow"]

        # === Color [27:31] — inferred from grid statistics ===
        overall_brightness = grid.mean()
        max_brightness = grid.max()
        vec[Slice.COLOR + 0] = 0.5   # warmth: neutral (monochrome system)
        vec[Slice.COLOR + 1] = 0.5   # saturation: neutral
        vec[Slice.COLOR + 2] = 0.5   # hue: neutral
        vec[Slice.COLOR + 3] = max_brightness - overall_brightness  # contrast

        # === Dynamics [31:35] ===
        dynamics = _extract_dynamics_from_effects(
            active_section_plan.effects, bpm, overall_brightness
        )
        vec[Slice.DYNAMICS + 0] = dynamics["attack"]
        vec[Slice.DYNAMICS + 1] = dynamics["release"]
        vec[Slice.DYNAMICS + 2] = dynamics["master_intensity"]
        vec[Slice.DYNAMICS + 3] = 1.0  # gate: always music during labeled sections

        # === Section [35:41] ===
        vec[Slice.SECTION:Slice.SECTION + NUM_SECTIONS] = section_to_onehot(active_section)

        # === BPM [41:44] ===
        vec[Slice.BPM + 0] = (t * bpm / 60.0) % 1.0          # beat_phase
        vec[Slice.BPM + 1] = (t * bpm / 60.0 / 4.0) % 1.0    # bar_phase
        vec[Slice.BPM + 2] = bpm_to_normalized(bpm)            # normalized_bpm

        protocol_vectors[i] = np.clip(vec, 0.0, 1.0)

    # === Future prediction [44:64] ===
    # Fill from offset frames (stems + onsets + spatial + motion speed = 20 dims)
    future_offset = max(1, int(0.1 * fps))  # ~100ms ahead
    for i in range(n_frames):
        future_idx = min(i + future_offset, n_frames - 1)
        future_vec = protocol_vectors[future_idx]
        # Future subset: stems(6) + onsets(3) + spatial(8) + motion_speed(1) + master_intensity(1) + flash(1) = 20
        protocol_vectors[i, Slice.FUTURE:Slice.FUTURE + 6] = future_vec[Slice.STEM_ENERGY:Slice.STEM_ENERGY + 6]
        protocol_vectors[i, Slice.FUTURE + 6:Slice.FUTURE + 9] = future_vec[Slice.ONSET:Slice.ONSET + 3]
        protocol_vectors[i, Slice.FUTURE + 9:Slice.FUTURE + 17] = future_vec[Slice.SPATIAL:Slice.SPATIAL + 8]
        protocol_vectors[i, Slice.FUTURE + 17] = future_vec[Slice.MOTION]     # speed
        protocol_vectors[i, Slice.FUTURE + 18] = future_vec[Slice.DYNAMICS + 2]  # master_intensity
        protocol_vectors[i, Slice.FUTURE + 19] = future_vec[Slice.TEXTURE + 4]   # flash

    return protocol_vectors
