"""Titan Tubes router: protocol vector -> v3 effects -> 16x8x3 grid.

Reads protocol texture/motion/dynamics channels and selects appropriate
v3 effects, then renders through v3's effect engine.

Threshold-based effect selection:
    flash > 0.3       -> kick_flash / impact
    sparkle > 0.2     -> hat_sparkle / rain
    fill > 0.1        -> bass_fill
    motion_speed > 0.3 -> chase / meteor / lighthouse
    wave > 0.2        -> vocal_wave / breathe
    pulse > 0.2       -> energy_pulse
    glow > 0.1        -> solid (base layer)
    Section overrides: buildup -> buildup_rise, drop -> strobe_chase
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

V3_DIR = Path(__file__).resolve().parent.parent.parent / "v3"
if str(V3_DIR) not in sys.path:
    sys.path.insert(0, str(V3_DIR))

from schemas import (
    NUM_TUBES, PIXELS_PER_TUBE,
    StemEnergies, StemFrame, StemOnsets, StemPans, StemBrightness,
    EffectInstance, Region, BlendMode, Color,
)
from effects import (
    EffectContext, render_section_frame, apply_glow, reset_smoothing,
)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from model.protocol import (
    Slice, SECTION_LABELS, ProtocolVector,
    normalized_to_bpm,
)
from router.base import Router


def _protocol_to_stem_frame(vec: np.ndarray, time: float) -> StemFrame:
    """Build a v3 StemFrame from protocol vector channels."""
    return StemFrame(
        time=time,
        stems=StemEnergies(
            bass=float(vec[Slice.STEM_ENERGY + 0]),
            kick=float(vec[Slice.STEM_ENERGY + 1]),
            snare=float(vec[Slice.STEM_ENERGY + 2]),
            hat=float(vec[Slice.STEM_ENERGY + 3]),
            vocals=float(vec[Slice.STEM_ENERGY + 4]),
            other=float(vec[Slice.STEM_ENERGY + 5]),
        ),
        onsets=StemOnsets(
            kick=float(vec[Slice.ONSET + 0]),
            snare=float(vec[Slice.ONSET + 1]),
            hat=float(vec[Slice.ONSET + 2]),
        ),
    )


class TitanTubeRouter(Router):
    """Routes protocol vectors to 8 Astera Titan Tubes via v3 effects."""

    def __init__(self):
        self._prev_section = ""
        reset_smoothing()

    def route(self, protocol: np.ndarray, time: float, dt: float) -> np.ndarray:
        """Convert protocol vector to 16x8x3 pixel grid.

        Args:
            protocol: (64,) protocol vector
            time: current time in seconds
            dt: delta time

        Returns:
            (16, 8, 3) float grid [0, 1]
        """
        # Extract protocol channels
        flash = float(protocol[Slice.TEXTURE + 4])
        sparkle = float(protocol[Slice.TEXTURE + 1])
        fill = float(protocol[Slice.TEXTURE + 2])
        wave = float(protocol[Slice.TEXTURE + 3])
        pulse = float(protocol[Slice.TEXTURE + 0])
        glow = float(protocol[Slice.TEXTURE + 5])

        motion_speed = float(protocol[Slice.MOTION + 0])
        motion_dir_x = float(protocol[Slice.MOTION + 1])
        motion_complexity = float(protocol[Slice.MOTION + 3])

        master_intensity = float(protocol[Slice.DYNAMICS + 2])
        gate = float(protocol[Slice.DYNAMICS + 3])

        # Section from soft encoding
        section_probs = protocol[Slice.SECTION:Slice.SECTION + 6]
        section_idx = int(np.argmax(section_probs))
        section = SECTION_LABELS[section_idx]

        # BPM from protocol
        bpm = normalized_to_bpm(float(protocol[Slice.BPM + 2]))

        # Spatial weights for tube assignment
        spatial = protocol[Slice.SPATIAL:Slice.SPATIAL + NUM_TUBES]

        # Build StemFrame for v3 effects
        stem_frame = _protocol_to_stem_frame(protocol, time)
        ctx = EffectContext(frame=stem_frame, time=time, bpm=bpm, dt=dt)

        # Build effect layers based on thresholds
        effects = []

        # Base layer: always present
        if glow > 0.1:
            effects.append(EffectInstance(
                effect="solid",
                intensity_source="none",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=glow * 0.5,
                release_ms=500.0,
            ))

        # Fill layer
        if fill > 0.1:
            effects.append(EffectInstance(
                effect="bass_fill",
                intensity_source="bass",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=fill,
                attack_ms=20.0,
                release_ms=300.0,
            ))

        # Pulse layer
        if pulse > 0.2:
            effects.append(EffectInstance(
                effect="energy_pulse",
                intensity_source="kick",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=pulse * 0.7,
                release_ms=200.0,
            ))

        # Wave layer
        if wave > 0.2:
            effect_name = "vocal_wave" if stem_frame.stems.vocals > 0.2 else "breathe"
            effects.append(EffectInstance(
                effect=effect_name,
                intensity_source="vocals" if effect_name == "vocal_wave" else "none",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=wave * 0.8,
                speed=0.8,
                release_ms=400.0,
            ))

        # Sparkle layer
        if sparkle > 0.2:
            effects.append(EffectInstance(
                effect="hat_sparkle",
                intensity_source="hat",
                region=Region(preset="all"),
                blend_mode=BlendMode.ADD,
                intensity=sparkle * 0.6,
                onset_mode=True,
                attack_ms=10.0,
                release_ms=100.0,
            ))

        # Motion layer
        if motion_speed > 0.3:
            direction = "right" if motion_dir_x > 0.6 else "left" if motion_dir_x < 0.4 else "up"
            if motion_complexity > 0.5:
                effect_name = "chase"
            elif motion_speed > 0.6:
                effect_name = "meteor"
            else:
                effect_name = "lighthouse"
            effects.append(EffectInstance(
                effect=effect_name,
                intensity_source="other",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=motion_speed * 0.7,
                speed=min(motion_speed, 0.7),
                direction=direction,
                release_ms=300.0,
            ))

        # Flash layer
        if flash > 0.3:
            if section == "drop":
                effect_name = "strobe_chase" if flash > 0.7 else "impact"
            else:
                effect_name = "kick_flash"
            effects.append(EffectInstance(
                effect=effect_name,
                intensity_source="kick",
                region=Region(preset="all"),
                blend_mode=BlendMode.ADD,
                intensity=flash,
                onset_mode=True,
                attack_ms=10.0,
                release_ms=150.0,
            ))

        # Section-specific overrides
        if section == "buildup" and fill > 0.05:
            effects.append(EffectInstance(
                effect="buildup_rise",
                intensity_source="bass",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=0.6,
                release_ms=500.0,
            ))

        # Fallback: ensure at least one effect
        if not effects:
            effects.append(EffectInstance(
                effect="solid",
                intensity_source="none",
                region=Region(preset="all"),
                blend_mode=BlendMode.MAX,
                intensity=0.2,
            ))

        # Render through v3 engine
        grid = render_section_frame(effects, ctx)

        # Apply spatial weights (per-tube intensity modulation)
        spatial_norm = spatial / (spatial.max() + 1e-6)
        for t in range(NUM_TUBES):
            grid[:, t, :] *= max(0.3, spatial_norm[t])  # floor at 0.3

        # Apply master intensity and gate
        grid *= master_intensity * gate

        # Glow post-processing
        grid = apply_glow(grid, amount=0.25)

        return np.clip(grid, 0, 1)

    def reset(self):
        """Reset smoothing state."""
        reset_smoothing()
        self._prev_section = ""
