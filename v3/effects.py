"""Composable visual effects for the 8x16 Titan Tube grid.

Each effect renders into an 8x16x3 float array (rows=pixels, cols=tubes, channels=RGB).
Effects are composited layer by layer using blend modes (max, add, replace).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from schemas import (
    NUM_TUBES, PIXELS_PER_TUBE,
    BlendMode, Color, EffectInstance, Region, StemEnergies, StemFrame,
)

STEM_NAMES = ("bass", "kick", "snare", "hat", "vocals", "other")


@dataclass
class LiveInput:
    """Runtime-only live keyboard state (not persisted)."""
    stem_boosts: dict[str, bool] = field(default_factory=dict)
    flash_remaining: float = 0.0
    strobe_remaining: float = 0.0
    color_burst_remaining: float = 0.0
    blackout_held: bool = False

    def tick(self, dt: float):
        """Decay one-shot timers."""
        if self.flash_remaining > 0:
            self.flash_remaining = max(0.0, self.flash_remaining - dt)
        if self.strobe_remaining > 0:
            self.strobe_remaining = max(0.0, self.strobe_remaining - dt)
        if self.color_burst_remaining > 0:
            self.color_burst_remaining = max(0.0, self.color_burst_remaining - dt)


class EffectContext:
    """Runtime state passed to every effect each frame."""

    def __init__(self, frame: StemFrame, time: float, bpm: float, dt: float,
                 live: LiveInput | None = None):
        self.frame = frame
        self.stems = frame.stems
        self.time = time
        self.bpm = bpm
        self.dt = dt
        self.beat_phase = (time * bpm / 60.0) % 1.0  # 0-1 within current beat
        self.bar_phase = (time * bpm / 60.0 / 4.0) % 1.0  # 0-1 within 4-beat bar
        self.live = live

    def get_stem(self, name: str) -> float:
        """Get stem energy by name. When a stem key is held, solo it (mute others)."""
        soloed = None
        if self.live:
            for s, held in self.live.stem_boosts.items():
                if held:
                    soloed = s
                    break

        if name == "none":
            # Static/ambient effects dim when a stem is soloed
            return 0.15 if soloed else 1.0

        val = getattr(self.stems, name, 0.0)
        if soloed:
            if name == soloed:
                val = min(val * 2.5, 1.0)
            else:
                val = 0.0
        return val

    def get_onset(self, name: str) -> float:
        """Get onset transient value for a drum stem."""
        return getattr(self.frame.onsets, name, 0.0)

    def get_pan(self, name: str) -> float:
        """Get stereo pan position for a stem (-1 to 1)."""
        return getattr(self.frame.pans, name, 0.0)

    def get_brightness(self, name: str) -> float:
        """Get normalized spectral brightness for a stem (0-1)."""
        return getattr(self.frame.brightness, name, 0.5)


class Effect(Protocol):
    """Protocol for effect implementations."""
    name: str

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        """Render effect into 16x8x3 float array."""
        ...


# ---------------------------------------------------------------------------
# Region helpers
# ---------------------------------------------------------------------------

def make_mask(region: Region) -> np.ndarray:
    """Create a 16x8 float mask from a Region."""
    mask = np.zeros((PIXELS_PER_TUBE, NUM_TUBES), dtype=np.float32)
    tube_flags = region.get_tube_mask()
    px_start, px_end = region.get_pixel_range()
    for t in range(NUM_TUBES):
        if tube_flags[t]:
            mask[px_start:px_end, t] = 1.0
    return mask


def apply_color(mask_2d: np.ndarray, color: Color) -> np.ndarray:
    """Expand a 16x8 intensity mask to 16x8x3 with color."""
    rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
    rgb[:, :, 0] = mask_2d * color.r
    rgb[:, :, 1] = mask_2d * color.g
    rgb[:, :, 2] = mask_2d * color.b
    return rgb


def make_pan_mask(pan: float, base_mask: np.ndarray) -> np.ndarray:
    """Shift a 16x8 mask left/right based on stereo pan value.

    Maps pan [-1,1] to tube center [0,7] with Gaussian falloff (sigma=1.5 tubes).
    """
    center = (pan + 1.0) * 0.5 * (NUM_TUBES - 1)  # -1->0, 0->3.5, 1->7
    sigma = 1.5
    pan_weights = np.zeros(NUM_TUBES, dtype=np.float32)
    for t in range(NUM_TUBES):
        pan_weights[t] = math.exp(-0.5 * ((t - center) / sigma) ** 2)
    # Normalize so peak=1
    mx = pan_weights.max()
    if mx > 0:
        pan_weights /= mx
    return base_mask * pan_weights[np.newaxis, :]


# ---------------------------------------------------------------------------
# Smoothing state (per effect instance, keyed by id)
# ---------------------------------------------------------------------------

_smooth_state: dict[int, float] = {}
_impact_trigger_times: dict[int, float] = {}  # for ImpactEffect debounce


def smooth_value(key: int, raw: float, attack_ms: float, release_ms: float, dt: float) -> float:
    """Exponential attack/release smoothing."""
    prev = _smooth_state.get(key, raw)
    if dt <= 0:
        _smooth_state[key] = raw
        return raw
    if raw > prev:
        tau = max(attack_ms / 1000.0, 0.001)
    else:
        tau = max(release_ms / 1000.0, 0.001)
    alpha = 1.0 - math.exp(-dt / tau)
    val = prev + alpha * (raw - prev)
    _smooth_state[key] = val
    return val


def smooth_bpm(key: int, raw: float, inst: EffectInstance, ctx: EffectContext) -> float:
    """BPM-aware smoothing: resolves beat-relative attack/release, then smooths."""
    return smooth_value(key, raw, inst.resolve_attack_ms(ctx.bpm), inst.resolve_release_ms(ctx.bpm), ctx.dt)


def reset_smoothing():
    """Clear all smoothing state."""
    _smooth_state.clear()
    _impact_trigger_times.clear()


# ---------------------------------------------------------------------------
# Core effects
# ---------------------------------------------------------------------------

class SolidEffect:
    name = "solid"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)
        return apply_color(mask * intensity, inst.color)


class GradientEffect:
    name = "gradient"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # Gradient from color to secondary_color along direction
        c1 = inst.color
        c2 = inst.secondary_color or Color(r=0, g=0, b=0)

        if inst.direction in ("up", "down"):
            t = np.linspace(0, 1, PIXELS_PER_TUBE).reshape(-1, 1)
            if inst.direction == "down":
                t = 1 - t
            t = np.broadcast_to(t, (PIXELS_PER_TUBE, NUM_TUBES))
        else:
            t = np.linspace(0, 1, NUM_TUBES).reshape(1, -1)
            if inst.direction == "left":
                t = 1 - t
            t = np.broadcast_to(t, (PIXELS_PER_TUBE, NUM_TUBES))

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        rgb[:, :, 0] = (c1.r * (1 - t) + c2.r * t) * mask * intensity
        rgb[:, :, 1] = (c1.g * (1 - t) + c2.g * t) * mask * intensity
        rgb[:, :, 2] = (c1.b * (1 - t) + c2.b * t) * mask * intensity
        return rgb


class ColorWashEffect:
    """Slowly cycling color across the grid."""
    name = "color_wash"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # Phase shifts across tubes for rainbow sweep
        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            phase = ctx.time * inst.speed * 0.5 + t * 0.3
            # Blend between primary and secondary using sine
            blend = math.sin(phase) * 0.5 + 0.5
            c1 = inst.color
            c2 = inst.secondary_color or Color(r=0, g=0.5, b=1.0)
            r = c1.r * (1 - blend) + c2.r * blend
            g = c1.g * (1 - blend) + c2.g * blend
            b = c1.b * (1 - blend) + c2.b * blend
            rgb[:, t, 0] = r * mask[:, t] * intensity
            rgb[:, t, 1] = g * mask[:, t] * intensity
            rgb[:, t, 2] = b * mask[:, t] * intensity
        return rgb


class BassFillEffect:
    """Bottom-up fill driven by bass energy. Deep red/purple."""
    name = "bass_fill"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        bass = ctx.get_stem(inst.intensity_source) * inst.intensity
        bass = smooth_bpm(id(inst), bass, inst, ctx)

        # Fill from bottom: pixel 15 = bottom, pixel 0 = top
        fill_height = bass * 1.1
        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)

        for px in range(PIXELS_PER_TUBE):
            # pn: 0 = top, 1 = bottom
            pn = px / (PIXELS_PER_TUBE - 1)
            # Fill from bottom up: bottom pixels light first
            fill = np.clip((fill_height - (1 - pn)) / 0.15, 0, 1)
            rgb[px, :, 0] = fill * inst.color.r * mask[px, :] * bass
            rgb[px, :, 1] = fill * inst.color.g * mask[px, :] * bass
            rgb[px, :, 2] = fill * inst.color.b * mask[px, :] * bass

        return rgb


class KickFlashEffect:
    """Full-grid white flash on kick hits."""
    name = "kick_flash"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        kick = ctx.get_stem(inst.intensity_source) * inst.intensity
        if inst.onset_mode:
            kick = max(kick, ctx.get_onset("kick"))
        kick = smooth_bpm(id(inst), kick, inst, ctx)
        if inst.pan_follow:
            mask = make_pan_mask(ctx.get_pan(inst.intensity_source), mask)

        # Quadratic for punch
        kick2 = kick * kick
        return apply_color(mask * kick2, inst.color)


class SnareAccentEffect:
    """Orange flash on outer tubes for snare hits."""
    name = "snare_accent"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        snare = ctx.get_stem(inst.intensity_source) * inst.intensity
        if inst.onset_mode:
            snare = max(snare, ctx.get_onset("snare"))
        snare = smooth_bpm(id(inst), snare, inst, ctx)
        if inst.pan_follow:
            mask = make_pan_mask(ctx.get_pan(inst.intensity_source), mask)
        return apply_color(mask * snare, inst.color)


class HatSparkleEffect:
    """Random sparkle pixels driven by hi-hat energy."""
    name = "hat_sparkle"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        hat = ctx.get_stem(inst.intensity_source) * inst.intensity
        if inst.onset_mode:
            hat = max(hat, ctx.get_onset("hat"))
        hat = smooth_bpm(id(inst), hat, inst, ctx)
        if inst.pan_follow:
            mask = make_pan_mask(ctx.get_pan(inst.intensity_source), mask)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)

        # Deterministic sparkle using time-seeded hash
        time_slot = int(ctx.time * 8)
        for t in range(NUM_TUBES):
            for px in range(PIXELS_PER_TUBE):
                seed = abs(math.sin((t * 16 + px) * 127.1 + time_slot * 311.7) * 43758.5453) % 1.0
                if seed > (1.0 - hat * 0.5):
                    spark = mask[px, t] * hat
                    rgb[px, t, 0] = spark * inst.color.r
                    rgb[px, t, 1] = spark * inst.color.g
                    rgb[px, t, 2] = spark * inst.color.b

        return rgb


class VocalWaveEffect:
    """Flowing vertical wave driven by vocal energy."""
    name = "vocal_wave"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        vocals = ctx.get_stem(inst.intensity_source) * inst.intensity
        vocals = smooth_bpm(id(inst), vocals, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            for px in range(PIXELS_PER_TUBE):
                pn = px / (PIXELS_PER_TUBE - 1)
                wave = math.sin(pn * 2 * math.pi + ctx.time * inst.speed * 1.5 + t * 0.5) * 0.5 + 0.5
                val = wave * vocals * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b

        return rgb


class EnergyPulseEffect:
    """Pulsing brightness synced to beat."""
    name = "energy_pulse"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        energy = ctx.get_stem(inst.intensity_source) * inst.intensity
        energy = smooth_bpm(id(inst), energy, inst, ctx)

        # Pulse on beat
        pulse = (math.cos(ctx.beat_phase * 2 * math.pi) * 0.5 + 0.5) * energy
        return apply_color(mask * pulse, inst.color)


class ChaseEffect:
    """Light chasing along tubes or pixels."""
    name = "chase"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # Speed modulated by stem energy (accelerates during drops)
        effective_speed = inst.speed * (0.5 + intensity * 0.5)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        beats_per_sec = ctx.bpm / 60.0

        if inst.direction in ("left", "right"):
            # Chase across tubes
            pos = (ctx.time * beats_per_sec * effective_speed) % NUM_TUBES
            if inst.direction == "left":
                pos = NUM_TUBES - 1 - pos
            for t in range(NUM_TUBES):
                dist = min(abs(t - pos), NUM_TUBES - abs(t - pos))
                val = max(0, 1.0 - dist / 2.0) * intensity
                rgb[:, t, 0] = val * inst.color.r * mask[:, t]
                rgb[:, t, 1] = val * inst.color.g * mask[:, t]
                rgb[:, t, 2] = val * inst.color.b * mask[:, t]
        else:
            # Chase along pixels (up/down)
            pos = (ctx.time * beats_per_sec * effective_speed) % PIXELS_PER_TUBE
            if inst.direction == "up":
                pos = PIXELS_PER_TUBE - 1 - pos
            for px in range(PIXELS_PER_TUBE):
                dist = min(abs(px - pos), PIXELS_PER_TUBE - abs(px - pos))
                val = max(0, 1.0 - dist / 3.0) * intensity
                rgb[px, :, 0] = val * inst.color.r * mask[px, :]
                rgb[px, :, 1] = val * inst.color.g * mask[px, :]
                rgb[px, :, 2] = val * inst.color.b * mask[px, :]

        return rgb


class ScanEffect:
    """Scanner beam sweeping across tubes."""
    name = "scan"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # Speed modulated by stem energy
        effective_speed = inst.speed * (0.5 + intensity * 0.5)

        # Ping-pong scan
        beats_per_sec = ctx.bpm / 60.0
        phase = (ctx.time * beats_per_sec * effective_speed * 0.5) % 2.0
        if phase > 1.0:
            phase = 2.0 - phase  # bounce back
        pos = phase * (NUM_TUBES - 1)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            dist = abs(t - pos)
            val = max(0, 1.0 - dist / 1.5) * intensity
            rgb[:, t, 0] = val * inst.color.r * mask[:, t]
            rgb[:, t, 1] = val * inst.color.g * mask[:, t]
            rgb[:, t, 2] = val * inst.color.b * mask[:, t]
        return rgb


class RainEffect:
    """Falling pixel drops."""
    name = "rain"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            # Each tube has drops at different phases
            for drop in range(3):
                seed = (t * 3 + drop) * 7.13
                drop_speed = 0.5 + (seed % 1.0) * inst.speed
                drop_pos = (ctx.time * drop_speed + seed * 2.7) % 1.0
                px = int(drop_pos * PIXELS_PER_TUBE)
                if 0 <= px < PIXELS_PER_TUBE:
                    val = intensity * mask[px, t]
                    rgb[px, t, 0] = val * inst.color.r
                    rgb[px, t, 1] = val * inst.color.g
                    rgb[px, t, 2] = val * inst.color.b
                    # Tail
                    for tail in range(1, 4):
                        tpx = px - tail
                        if 0 <= tpx < PIXELS_PER_TUBE:
                            fade = 1.0 - tail / 4.0
                            v = intensity * fade * mask[tpx, t]
                            rgb[tpx, t, 0] = max(rgb[tpx, t, 0], v * inst.color.r)
                            rgb[tpx, t, 1] = max(rgb[tpx, t, 1], v * inst.color.g)
                            rgb[tpx, t, 2] = max(rgb[tpx, t, 2], v * inst.color.b)
        return rgb


class RippleEffect:
    """Radial ripple from center outward."""
    name = "ripple"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        cx, cy = NUM_TUBES / 2, PIXELS_PER_TUBE / 2

        beats_per_sec = ctx.bpm / 60.0
        wave_pos = (ctx.time * beats_per_sec * inst.speed) % 10.0

        for t in range(NUM_TUBES):
            for px in range(PIXELS_PER_TUBE):
                dist = math.sqrt((t - cx) ** 2 + (px - cy) ** 2)
                wave = math.sin(dist * 1.5 - wave_pos * 3.0) * 0.5 + 0.5
                val = wave * intensity * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b
        return rgb


class BuildupRiseEffect:
    """Rising fill that builds toward the next section."""
    name = "buildup_rise"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # Intensity ramps up over time (section progress drives this externally)
        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        fill = intensity

        for px in range(PIXELS_PER_TUBE):
            pn = px / (PIXELS_PER_TUBE - 1)
            # Bottom fills up as intensity grows
            level = np.clip((fill - (1 - pn)) / 0.2, 0, 1)
            # Add pulsing at top edge
            if abs(pn - (1 - fill)) < 0.15:
                pulse = math.sin(ctx.time * inst.speed * 10) * 0.3 + 0.7
                level *= pulse
            rgb[px, :, 0] = level * inst.color.r * mask[px, :]
            rgb[px, :, 1] = level * inst.color.g * mask[px, :]
            rgb[px, :, 2] = level * inst.color.b * mask[px, :]
        return rgb


class StrobeEffect:
    name = "strobe"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity

        # Strobe at speed * BPM rate
        beats_per_sec = ctx.bpm / 60.0
        on = int(ctx.time * beats_per_sec * inst.speed * 2) % 2
        if on:
            return apply_color(mask * intensity, inst.color)
        return np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)


class BlackoutEffect:
    name = "blackout"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        # Replace blend mode: this zeros out the region
        return np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)


class FadeInEffect:
    """Fade from black to color over time within section."""
    name = "fade_in"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)
        return apply_color(mask * intensity, inst.color)


class FadeOutEffect:
    """Fade from color to black over time within section."""
    name = "fade_out"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)
        return apply_color(mask * intensity, inst.color)


class PanSweepEffect:
    """Light column follows a stem's stereo pan across tubes."""
    name = "pan_sweep"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        pan = ctx.get_pan(inst.intensity_source)
        center = (pan + 1.0) * 0.5 * (NUM_TUBES - 1)
        sigma = 0.75  # tight 1.5-tube-wide beam

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            weight = math.exp(-0.5 * ((t - center) / sigma) ** 2)
            val = weight * intensity
            rgb[:, t, 0] = val * inst.color.r * mask[:, t]
            rgb[:, t, 1] = val * inst.color.g * mask[:, t]
            rgb[:, t, 2] = val * inst.color.b * mask[:, t]
        return rgb


class SpectralColorEffect:
    """Color interpolates between primary/secondary based on stem brightness."""
    name = "spectral_color"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        brightness = ctx.get_brightness(inst.intensity_source)
        c1 = inst.color
        c2 = inst.secondary_color or Color(r=0.0, g=0.5, b=1.0)

        # Blend colors based on brightness
        r = c1.r * (1 - brightness) + c2.r * brightness
        g = c1.g * (1 - brightness) + c2.g * brightness
        b = c1.b * (1 - brightness) + c2.b * brightness
        blended = Color(r=r, g=g, b=b)

        if inst.pan_follow:
            mask = make_pan_mask(ctx.get_pan(inst.intensity_source), mask)

        return apply_color(mask * intensity, blended)


class FluxBurstEffect:
    """Expanding radial ring triggered by spectral flux."""
    name = "flux_burst"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        flux = ctx.frame.spectral_flux * inst.intensity
        flux = smooth_bpm(id(inst), flux, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        cx, cy = NUM_TUBES / 2, PIXELS_PER_TUBE / 2

        # Expanding ring driven by flux — radius grows with time, intensity fades
        beats_per_sec = ctx.bpm / 60.0
        ring_radius = (ctx.time * beats_per_sec * inst.speed) % 12.0
        ring_width = 2.0

        for t in range(NUM_TUBES):
            for px in range(PIXELS_PER_TUBE):
                dist = math.sqrt((t - cx) ** 2 + (px - cy) ** 2)
                ring_val = max(0, 1.0 - abs(dist - ring_radius) / ring_width)
                val = ring_val * flux * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b
        return rgb


class BreatheEffect:
    """Slow sine modulation for intros/breakdowns. 1 cycle per 2 bars at speed=1."""
    name = "breathe"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        # 1 cycle per 2 bars (8 beats) at speed=1
        beats_per_sec = ctx.bpm / 60.0
        cycle_freq = beats_per_sec * inst.speed / 8.0  # Hz

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            # Subtle per-tube phase offset for organic wave
            phase_offset = t * 0.15
            breathe = math.sin(2 * math.pi * cycle_freq * ctx.time + phase_offset) * 0.5 + 0.5
            val = breathe * intensity
            rgb[:, t, 0] = val * inst.color.r * mask[:, t]
            rgb[:, t, 1] = val * inst.color.g * mask[:, t]
            rgb[:, t, 2] = val * inst.color.b * mask[:, t]
        return rgb


class MeteorEffect:
    """Bright head pixel falling down tubes with exponential decay trail behind it."""
    name = "meteor"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        beats_per_sec = ctx.bpm / 60.0
        going_up = inst.direction == "up"
        tail_len = 8

        for t in range(NUM_TUBES):
            seed = t * 2.37
            meteor_speed = 0.4 + (seed % 1.0) * 0.3
            effective_speed = meteor_speed * inst.speed * beats_per_sec * 0.25
            pos = (ctx.time * effective_speed + seed * 1.7) % 1.0
            if going_up:
                head_px = PIXELS_PER_TUBE - 1 - int(pos * PIXELS_PER_TUBE)
            else:
                head_px = int(pos * PIXELS_PER_TUBE)

            for px in range(PIXELS_PER_TUBE):
                # Trail is behind the head: above for falling, below for rising
                if going_up:
                    dist = px - head_px  # positive = below head = behind
                else:
                    dist = head_px - px  # positive = above head = behind
                if 0 <= dist <= tail_len:
                    brightness = math.exp(-dist * 0.5) * intensity
                    val = brightness * mask[px, t]
                    rgb[px, t, 0] = val * inst.color.r
                    rgb[px, t, 1] = val * inst.color.g
                    rgb[px, t, 2] = val * inst.color.b
        return rgb


class FireflyEffect:
    """12 dots with independent glow cycles (fast rise, slow decay). 1px spread."""
    name = "firefly"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        num_dots = 12

        for i in range(num_dots):
            # Deterministic position from seed
            seed_a = abs(math.sin(i * 127.1) * 43758.5453) % 1.0
            seed_b = abs(math.sin(i * 269.5) * 29103.7137) % 1.0
            tube = int(seed_a * NUM_TUBES) % NUM_TUBES
            px = int(seed_b * PIXELS_PER_TUBE) % PIXELS_PER_TUBE

            # Independent cycle: 1.5-5.5s period
            period = 1.5 + (abs(math.sin(i * 43.7)) % 1.0) * 4.0
            period /= max(inst.speed, 0.1)
            phase = (ctx.time / period + seed_a * 3.7) % 1.0

            # Asymmetric: fast rise (0-0.2), slow decay (0.2-1.0)
            if phase < 0.2:
                glow = phase / 0.2
            else:
                glow = 1.0 - (phase - 0.2) / 0.8

            val = glow * intensity * mask[px, tube]
            # Center pixel
            rgb[px, tube, 0] = max(rgb[px, tube, 0], val * inst.color.r)
            rgb[px, tube, 1] = max(rgb[px, tube, 1], val * inst.color.g)
            rgb[px, tube, 2] = max(rgb[px, tube, 2], val * inst.color.b)
            # 1px spread for softness
            for dpx in (-1, 1):
                npx = px + dpx
                if 0 <= npx < PIXELS_PER_TUBE:
                    sv = val * 0.4
                    rgb[npx, tube, 0] = max(rgb[npx, tube, 0], sv * inst.color.r)
                    rgb[npx, tube, 1] = max(rgb[npx, tube, 1], sv * inst.color.g)
                    rgb[npx, tube, 2] = max(rgb[npx, tube, 2], sv * inst.color.b)
        return rgb


class StrobeChaseEffect:
    """Strobe that advances one tube per beat with 2-tube spread. On/off within subdivisions."""
    name = "strobe_chase"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        base_intensity = inst.intensity
        # Optionally modulate with stem but keep a visible floor
        if inst.intensity_source != "none":
            base_intensity *= 0.5 + 0.5 * ctx.get_stem(inst.intensity_source)

        beats_per_sec = ctx.bpm / 60.0
        beat_num = ctx.time * beats_per_sec * inst.speed
        active_tube = int(beat_num) % NUM_TUBES

        # On/off within the beat — 8th note strobe
        sub_phase = beat_num % 1.0
        on = int(sub_phase * 4) % 2

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        if on:
            for dt in (-1, 0, 1):
                t = (active_tube + dt) % NUM_TUBES
                falloff = 1.0 if dt == 0 else 0.4
                val = base_intensity * falloff
                rgb[:, t, 0] = val * inst.color.r * mask[:, t]
                rgb[:, t, 1] = val * inst.color.g * mask[:, t]
                rgb[:, t, 2] = val * inst.color.b * mask[:, t]
        return rgb


class ImpactEffect:
    """Onset-triggered: brief flash → expanding ring decay over 1.5 beats. Debounced."""
    name = "impact"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity

        # Get onset (or energy if no onset available)
        onset = ctx.get_onset(inst.intensity_source) if inst.intensity_source in ("kick", "snare", "hat") else 0.0
        onset = max(onset, ctx.get_stem(inst.intensity_source))

        # Debounce: one trigger per quarter-beat
        beats_per_sec = ctx.bpm / 60.0 if ctx.bpm > 0 else 2.0
        quarter_beat_sec = 0.25 / beats_per_sec
        key = id(inst)
        last_trigger = _impact_trigger_times.get(key, -999.0)

        if onset > 0.6 and (ctx.time - last_trigger) > quarter_beat_sec:
            _impact_trigger_times[key] = ctx.time

        trigger_time = _impact_trigger_times.get(key, -999.0)
        elapsed = ctx.time - trigger_time

        # Decay over 1.5 beats
        decay_duration = 1.5 / beats_per_sec
        if elapsed > decay_duration:
            return np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)

        progress = elapsed / decay_duration  # 0 -> 1

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        cx, cy = NUM_TUBES / 2, PIXELS_PER_TUBE / 2

        if progress < 0.15:
            # Full flash phase
            flash = (1.0 - progress / 0.15) * intensity
            return apply_color(mask * flash, inst.color)

        # Expanding ring phase
        ring_radius = (progress - 0.15) / 0.85 * max(NUM_TUBES, PIXELS_PER_TUBE) * 0.6
        ring_fade = (1.0 - progress) * intensity
        ring_width = 2.0

        for t in range(NUM_TUBES):
            for px in range(PIXELS_PER_TUBE):
                dist = math.sqrt((t - cx) ** 2 + (px - cy) ** 2)
                ring_val = max(0, 1.0 - abs(dist - ring_radius) / ring_width)
                val = ring_val * ring_fade * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b
        return rgb


class LighthouseEffect:
    """Wide Gaussian beam ping-ponging across tubes over 4 beats. Vertical gradient."""
    name = "lighthouse"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        beats_per_sec = ctx.bpm / 60.0
        # Ping-pong over 4 beats at speed=1
        phase = (ctx.time * beats_per_sec * inst.speed / 4.0) % 2.0
        if phase > 1.0:
            phase = 2.0 - phase
        beam_center = phase * (NUM_TUBES - 1)

        sigma = 1.2  # wide Gaussian

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for t in range(NUM_TUBES):
            beam = math.exp(-0.5 * ((t - beam_center) / sigma) ** 2)
            for px in range(PIXELS_PER_TUBE):
                # Vertical brightness gradient for depth
                vert_grad = 0.4 + 0.6 * (1.0 - px / (PIXELS_PER_TUBE - 1))
                val = beam * vert_grad * intensity * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b
        return rgb


class BreatheYEffect:
    """Vertical breathing wave — brightness sweeps up and down tubes."""
    name = "breathe_y"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        beats_per_sec = ctx.bpm / 60.0
        # 1 cycle per 2 bars (8 beats) at speed=1
        cycle_freq = beats_per_sec * inst.speed / 8.0

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        for px in range(PIXELS_PER_TUBE):
            pn = px / (PIXELS_PER_TUBE - 1)
            wave = math.sin(2 * math.pi * (cycle_freq * ctx.time - pn * 0.8)) * 0.5 + 0.5
            val = wave * intensity
            rgb[px, :, 0] = val * inst.color.r * mask[px, :]
            rgb[px, :, 1] = val * inst.color.g * mask[px, :]
            rgb[px, :, 2] = val * inst.color.b * mask[px, :]
        return rgb


class CandlesEffect:
    """Slow bottom-weighted glow dots — like candle flames at the base of tubes."""
    name = "candles"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        num_candles = 10

        for i in range(num_candles):
            seed_a = abs(math.sin(i * 127.1) * 43758.5453) % 1.0
            tube = int(seed_a * NUM_TUBES) % NUM_TUBES
            # Bottom-weighted: pixels 10-15 (bottom 40%)
            seed_b = abs(math.sin(i * 269.5) * 29103.7137) % 1.0
            px = PIXELS_PER_TUBE - 1 - int(seed_b * 6)  # pixel 10-15
            px = max(0, min(px, PIXELS_PER_TUBE - 1))

            # Slow cycle: 3-8s period
            period = 3.0 + (abs(math.sin(i * 43.7)) % 1.0) * 5.0
            period /= max(inst.speed, 0.1)
            phase = (ctx.time / period + seed_a * 2.1) % 1.0

            # Gentle flicker: smooth sine with slight wobble
            glow = (math.sin(phase * 2 * math.pi) * 0.3 + 0.7)
            wobble = math.sin(ctx.time * (2.0 + i * 0.3)) * 0.15
            glow = max(0, min(1, glow + wobble))

            # Bottom pixels are strongest — fade toward top
            bottom_weight = (px / (PIXELS_PER_TUBE - 1))  # 0 at top, 1 at bottom
            val = glow * intensity * bottom_weight * mask[px, tube]

            # 2px spread vertically for soft flame shape
            for dpx in range(-2, 3):
                npx = px + dpx
                if 0 <= npx < PIXELS_PER_TUBE:
                    falloff = math.exp(-abs(dpx) * 0.8)
                    sv = val * falloff
                    rgb[npx, tube, 0] = max(rgb[npx, tube, 0], sv * inst.color.r)
                    rgb[npx, tube, 1] = max(rgb[npx, tube, 1], sv * inst.color.g)
                    rgb[npx, tube, 2] = max(rgb[npx, tube, 2], sv * inst.color.b)
        return rgb


class FirecrackerEffect:
    """Intense sparkle burst expanding radially from center."""
    name = "firecracker"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        cx, cy = NUM_TUBES / 2, PIXELS_PER_TUBE / 2

        beats_per_sec = ctx.bpm / 60.0
        # Burst cycle: 1 burst per beat at speed=1
        cycle_period = 1.0 / (beats_per_sec * inst.speed)
        burst_phase = (ctx.time % cycle_period) / cycle_period  # 0->1 within burst

        # Expanding wavefront radius
        max_radius = math.sqrt(cx ** 2 + cy ** 2)
        front_radius = burst_phase * max_radius * 1.5
        # Fade out as it expands
        burst_fade = max(0, 1.0 - burst_phase * 1.2)

        num_sparks = 24
        for i in range(num_sparks):
            # Each spark has a fixed angle and speed variation
            angle = i * (2 * math.pi / num_sparks) + i * 0.37
            speed_var = 0.6 + abs(math.sin(i * 73.1)) % 1.0 * 0.8
            r = front_radius * speed_var

            # Spark position
            sx = cx + math.cos(angle) * r
            sy = cy + math.sin(angle) * r
            t = int(round(sx))
            px = int(round(sy))

            if 0 <= t < NUM_TUBES and 0 <= px < PIXELS_PER_TUBE:
                # Sparkle flicker
                flicker_seed = abs(math.sin(i * 311.7 + ctx.time * 47.0)) % 1.0
                if flicker_seed > 0.3:  # 70% chance visible
                    val = burst_fade * intensity * flicker_seed * mask[px, t]
                    rgb[px, t, 0] = max(rgb[px, t, 0], val * inst.color.r)
                    rgb[px, t, 1] = max(rgb[px, t, 1], val * inst.color.g)
                    rgb[px, t, 2] = max(rgb[px, t, 2], val * inst.color.b)

        return rgb


class AbracadabraEffect:
    """Randomly wandering focused light with decay trail — a waving wand."""
    name = "abracadabra"

    def render(self, ctx: EffectContext, inst: EffectInstance) -> np.ndarray:
        mask = make_mask(inst.region)
        intensity = ctx.get_stem(inst.intensity_source) * inst.intensity
        intensity = smooth_bpm(id(inst), intensity, inst, ctx)

        rgb = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)
        speed = inst.speed

        # Wand position: layered sine waves for organic random swing
        tube_f = (
            math.sin(ctx.time * speed * 1.3) * 2.5
            + math.sin(ctx.time * speed * 0.7 + 1.0) * 1.5
            + math.sin(ctx.time * speed * 2.9 + 2.5) * 0.8
        )
        tube_center = (NUM_TUBES - 1) / 2 + tube_f * 0.5
        tube_center = max(0, min(NUM_TUBES - 1, tube_center))

        px_f = (
            math.sin(ctx.time * speed * 0.9 + 0.5) * 4.0
            + math.sin(ctx.time * speed * 1.7 + 3.0) * 2.0
        )
        px_center = (PIXELS_PER_TUBE - 1) / 2 + px_f * 0.5
        px_center = max(0, min(PIXELS_PER_TUBE - 1, px_center))

        # Focused beam with Gaussian falloff
        sigma_t = 0.8  # tight horizontal focus
        sigma_px = 1.5  # slightly taller vertically

        for t in range(NUM_TUBES):
            wt = math.exp(-0.5 * ((t - tube_center) / sigma_t) ** 2)
            for px in range(PIXELS_PER_TUBE):
                wpx = math.exp(-0.5 * ((px - px_center) / sigma_px) ** 2)
                val = wt * wpx * intensity * mask[px, t]
                rgb[px, t, 0] = val * inst.color.r
                rgb[px, t, 1] = val * inst.color.g
                rgb[px, t, 2] = val * inst.color.b

        # Trail: render 6 past positions with decay
        for trail_i in range(1, 7):
            trail_t = ctx.time - trail_i * 0.06 / max(speed, 0.1)
            tt_f = (
                math.sin(trail_t * speed * 1.3) * 2.5
                + math.sin(trail_t * speed * 0.7 + 1.0) * 1.5
                + math.sin(trail_t * speed * 2.9 + 2.5) * 0.8
            )
            tt_center = max(0, min(NUM_TUBES - 1, (NUM_TUBES - 1) / 2 + tt_f * 0.5))
            tp_f = (
                math.sin(trail_t * speed * 0.9 + 0.5) * 4.0
                + math.sin(trail_t * speed * 1.7 + 3.0) * 2.0
            )
            tp_center = max(0, min(PIXELS_PER_TUBE - 1, (PIXELS_PER_TUBE - 1) / 2 + tp_f * 0.5))

            fade = math.exp(-trail_i * 0.5)
            for t in range(NUM_TUBES):
                wt = math.exp(-0.5 * ((t - tt_center) / sigma_t) ** 2)
                for px in range(PIXELS_PER_TUBE):
                    wpx = math.exp(-0.5 * ((px - tp_center) / sigma_px) ** 2)
                    val = wt * wpx * fade * intensity * mask[px, t]
                    rgb[px, t, 0] = max(rgb[px, t, 0], val * inst.color.r)
                    rgb[px, t, 1] = max(rgb[px, t, 1], val * inst.color.g)
                    rgb[px, t, 2] = max(rgb[px, t, 2], val * inst.color.b)

        return rgb


# ---------------------------------------------------------------------------
# Glow post-processing
# ---------------------------------------------------------------------------

def apply_glow(grid: np.ndarray, amount: float = 0.3) -> np.ndarray:
    """Add subtle pixel bleed glow via uniform filter. Trivially fast on 16x8."""
    from scipy.ndimage import uniform_filter

    blurred = np.empty_like(grid)
    for ch in range(3):
        blurred[:, :, ch] = uniform_filter(grid[:, :, ch], size=(3, 2))
    return np.clip(grid + blurred * amount, 0, 1)


# ---------------------------------------------------------------------------
# Effect registry
# ---------------------------------------------------------------------------

ALL_EFFECTS: list[type] = [
    SolidEffect,
    GradientEffect,
    ColorWashEffect,
    BassFillEffect,
    KickFlashEffect,
    SnareAccentEffect,
    HatSparkleEffect,
    VocalWaveEffect,
    EnergyPulseEffect,
    ChaseEffect,
    ScanEffect,
    RainEffect,
    RippleEffect,
    BuildupRiseEffect,
    StrobeEffect,
    BlackoutEffect,
    FadeInEffect,
    FadeOutEffect,
    PanSweepEffect,
    SpectralColorEffect,
    FluxBurstEffect,
    BreatheEffect,
    MeteorEffect,
    FireflyEffect,
    StrobeChaseEffect,
    ImpactEffect,
    LighthouseEffect,
    BreatheYEffect,
    CandlesEffect,
    FirecrackerEffect,
    AbracadabraEffect,
]

EFFECT_REGISTRY: dict[str, Effect] = {}

for _cls in ALL_EFFECTS:
    _inst = _cls()
    EFFECT_REGISTRY[_inst.name] = _inst


def get_effect(name: str) -> Effect:
    if name not in EFFECT_REGISTRY:
        raise ValueError(f"Unknown effect: {name!r}. Available: {list(EFFECT_REGISTRY.keys())}")
    return EFFECT_REGISTRY[name]


# ---------------------------------------------------------------------------
# Compositing
# ---------------------------------------------------------------------------

def composite_frame(
    layers: list[tuple[np.ndarray, BlendMode]],
) -> np.ndarray:
    """Composite multiple effect layers into a single 16x8x3 frame.

    Each layer is (rgb_array, blend_mode).
    """
    result = np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32)

    for layer, mode in layers:
        if mode == BlendMode.ADD:
            result += layer
        elif mode == BlendMode.REPLACE:
            # Replace where layer has any color
            mask = layer.sum(axis=2) > 0
            result[mask] = layer[mask]
        else:  # MAX (default)
            result = np.maximum(result, layer)

    return np.clip(result, 0, 1)


_WHITE = Color(r=1.0, g=1.0, b=1.0)
_BLACK = Color(r=0.0, g=0.0, b=0.0)


def render_section_frame(
    effects_list: list[EffectInstance],
    ctx: EffectContext,
) -> np.ndarray:
    """Render all effects for a section and composite them."""
    layers = []
    for inst in effects_list:
        # Force monochrome: all effects render white intensity only
        inst = inst.model_copy(update={"color": _WHITE, "secondary_color": _BLACK})
        effect = get_effect(inst.effect)
        rgb = effect.render(ctx, inst)
        layers.append((rgb, inst.blend_mode))
    return composite_frame(layers)
