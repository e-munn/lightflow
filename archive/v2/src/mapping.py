"""Maps audio features to DMX channel values.

This is the creative core - defines how sound drives light.
"""

import numpy as np


class FeatureMapper:
    """Maps spectral features to DMX values for fixture groups."""

    def __init__(self):
        # Smoothing state (EMA)
        self._prev = {}
        self._smoothing = 0.3  # 0 = no smoothing, 1 = frozen

        # Fixture layout: map logical groups to DMX start channels
        # These get configured per-venue
        self.groups = {
            "wash": {"start": 1, "channels": 7},       # RGBW par cans
            "strings": {"start": 8, "channels": 4},     # Fairy/string lights (dimmer)
            "accent": {"start": 12, "channels": 7},     # Accent uplights
        }

        # Feature-to-light mapping weights
        self.sensitivity = 1.0  # Global sensitivity multiplier

    def _smooth(self, key: str, value: float) -> float:
        if key not in self._prev:
            self._prev[key] = value
        self._prev[key] = self._smoothing * self._prev[key] + (1 - self._smoothing) * value
        return self._prev[key]

    def _norm(self, value: float, min_val: float, max_val: float) -> int:
        """Normalize a value to 0-255 DMX range."""
        clamped = np.clip((value - min_val) / (max_val - min_val + 1e-10), 0, 1)
        return int(clamped * 255 * self.sensitivity)

    def map(self, features: dict) -> dict[int, int]:
        """Convert audio features to DMX channel:value pairs.

        Returns dict of {channel_number: value} (1-indexed).
        """
        bands = features["bands"]
        rms = self._smooth("rms", features["rms"])
        centroid = self._smooth("centroid", features["centroid"])

        # Smooth band energies
        bass = self._smooth("bass", bands["bass"] + bands["sub_bass"])
        mid = self._smooth("mid", bands["mid"] + bands["low_mid"])
        high = self._smooth("high", bands["high"] + bands["high_mid"])

        output = {}

        # --- WASH LIGHTS (RGBW par cans) ---
        # Color temperature shifts with spectral centroid
        # Low centroid = warm (amber/red), high = cool (blue/white)
        warmth = 1.0 - np.clip(centroid / 4000, 0, 1)
        brightness = self._norm(rms, 0.001, 0.15)

        ws = self.groups["wash"]["start"]
        output[ws] = int(brightness * warmth)                    # R - warm
        output[ws + 1] = int(brightness * 0.3 * warmth)         # G - subtle
        output[ws + 2] = int(brightness * (1 - warmth))         # B - cool
        output[ws + 3] = int(brightness * warmth * 0.7)         # W - warm white
        output[ws + 4] = brightness                              # Dimmer
        output[ws + 5] = 0                                       # Strobe (off)
        output[ws + 6] = 0                                       # Mode

        # --- STRING LIGHTS ---
        # Gentle response to high frequencies (sparkle)
        ss = self.groups["strings"]["start"]
        base_dim = self._norm(rms, 0.005, 0.1)
        sparkle = self._norm(high, 0, 0.001)
        output[ss] = max(base_dim, 30)          # Base brightness (never fully off)
        output[ss + 1] = sparkle                # Sparkle channel
        output[ss + 2] = int(warmth * 255)      # Color temp
        output[ss + 3] = 0                      # Mode

        # --- ACCENT UPLIGHTS ---
        # Bass-reactive color pops
        as_ = self.groups["accent"]["start"]
        bass_hit = self._norm(bass, 0, 0.01)
        mid_energy = self._norm(mid, 0, 0.005)

        output[as_] = bass_hit                          # R - bass pulses
        output[as_ + 1] = mid_energy                    # G - mid response
        output[as_ + 2] = int(sparkle * 0.5)            # B - high shimmer
        output[as_ + 3] = int(warmth * 100)             # W
        output[as_ + 4] = max(bass_hit, mid_energy)     # Dimmer
        output[as_ + 5] = 0                             # Strobe
        output[as_ + 6] = 0                             # Mode

        return output


class StemMapper:
    """Maps 6 stem energies (0-1) to DMX fixture groups.

    Stem behaviors:
        Bass   → Wash pars: master dimmer pulsates, deep warm color
        Kick   → All fixtures: brief full-brightness flash
        Snare  → Accent lights: orange pop
        Hats   → String lights: rapid twinkle pattern
        Vocals → Wash pars: smooth color temperature shift
        Other  → Accent lights: color follows spectral centroid
    """

    def __init__(self):
        self._prev = {}

        # Same fixture layout as FeatureMapper — configure per-venue
        self.groups = {
            "wash": {"start": 1, "channels": 7},       # RGBW par cans
            "strings": {"start": 8, "channels": 4},     # Fairy/string lights
            "accent": {"start": 12, "channels": 7},     # Accent uplights
        }

        self.sensitivity = 1.0

        # Attack/release smoothing per stem (applied here for DMX output)
        self._attack = {
            "bass": 0.4, "kick": 0.95, "snare": 0.9,
            "hat": 0.85, "vocals": 0.15, "other": 0.3,
        }
        self._release = {
            "bass": 0.08, "kick": 0.3, "snare": 0.2,
            "hat": 0.4, "vocals": 0.05, "other": 0.1,
        }

    def _smooth(self, key: str, raw: float) -> float:
        prev = self._prev.get(key, 0.0)
        if raw > prev:
            val = prev + (raw - prev) * self._attack.get(key, 0.5)
        else:
            val = prev + (raw - prev) * self._release.get(key, 0.1)
        self._prev[key] = val
        return val

    def _dmx(self, value: float) -> int:
        """Convert 0-1 float to 0-255 DMX value."""
        return int(np.clip(value * self.sensitivity, 0, 1) * 255)

    def map_stems(self, stems: dict) -> dict[int, int]:
        """Convert stem energies to DMX channel:value pairs.

        Args:
            stems: dict with keys bass_energy, kick_energy, snare_energy,
                   hat_energy, vocals_energy, other_energy (all 0-1),
                   plus optional 'centroid' (Hz).

        Returns:
            dict of {channel_number: value} (1-indexed, 0-255).
        """
        bass = self._smooth("bass", stems.get("bass_energy", 0))
        kick = self._smooth("kick", stems.get("kick_energy", 0))
        snare = self._smooth("snare", stems.get("snare_energy", 0))
        hat = self._smooth("hat", stems.get("hat_energy", 0))
        vocals = self._smooth("vocals", stems.get("vocals_energy", 0))
        other = self._smooth("other", stems.get("other_energy", 0))
        centroid = stems.get("centroid", 2000)

        output = {}

        # ── WASH LIGHTS (RGBW par cans) ──
        # Bass drives master dimmer with deep warm color
        # Vocals shift color temperature
        ws = self.groups["wash"]["start"]
        warmth = 1.0 - np.clip(centroid / 4000, 0, 1)
        vocal_tint = np.clip(vocals * 0.6, 0, 1)

        # Base color: deep red/purple from bass, shifting blue/pink with vocals
        wash_r = bass * 0.8 + vocal_tint * 0.3
        wash_g = vocal_tint * 0.15
        wash_b = bass * 0.4 + vocal_tint * 0.7
        wash_w = bass * warmth * 0.5

        # Kick flash overrides everything briefly
        if kick > 0.5:
            flash = (kick - 0.5) * 2  # 0-1 in the flash range
            wash_r = max(wash_r, flash)
            wash_g = max(wash_g, flash * 0.95)
            wash_b = max(wash_b, flash * 0.9)
            wash_w = max(wash_w, flash)

        output[ws] = self._dmx(wash_r)
        output[ws + 1] = self._dmx(wash_g)
        output[ws + 2] = self._dmx(wash_b)
        output[ws + 3] = self._dmx(wash_w)
        output[ws + 4] = self._dmx(max(bass, kick, vocals * 0.5))  # Dimmer
        output[ws + 5] = 0  # Strobe off
        output[ws + 6] = 0  # Mode

        # ── STRING LIGHTS (fairy/twinkle) ──
        # Hats drive rapid twinkle, base glow from overall energy
        ss = self.groups["strings"]["start"]
        base_glow = max(bass * 0.3, vocals * 0.2, 0.1)  # Never fully dark
        output[ss] = self._dmx(base_glow + hat * 0.7)     # Dimmer
        output[ss + 1] = self._dmx(hat)                    # Sparkle/twinkle
        output[ss + 2] = self._dmx(warmth)                 # Color temp
        output[ss + 3] = 0                                  # Mode

        # ── ACCENT UPLIGHTS ──
        # Snare drives orange pop, other/melody follows centroid color
        as_ = self.groups["accent"]["start"]

        # Melody color from centroid: low=warm amber, high=cool blue
        ct = np.clip(centroid / 5000, 0, 1)
        melody_r = other * (1 - ct) * 0.8
        melody_g = other * 0.2
        melody_b = other * ct * 0.8

        # Snare orange pop layered on top
        accent_r = max(melody_r, snare * 1.0)
        accent_g = max(melody_g, snare * 0.4)
        accent_b = melody_b

        # Kick flash on accents too
        if kick > 0.6:
            flash = (kick - 0.6) * 2.5
            accent_r = max(accent_r, flash)
            accent_g = max(accent_g, flash * 0.9)
            accent_b = max(accent_b, flash * 0.8)

        output[as_] = self._dmx(accent_r)
        output[as_ + 1] = self._dmx(accent_g)
        output[as_ + 2] = self._dmx(accent_b)
        output[as_ + 3] = self._dmx(snare * warmth * 0.3)  # W
        output[as_ + 4] = self._dmx(max(snare, other, kick * 0.5))  # Dimmer
        output[as_ + 5] = 0  # Strobe
        output[as_ + 6] = 0  # Mode

        return output


class TitanTubeMapper:
    """Maps 6 stem energies to 384 DMX channels for 8 Astera Titan Tubes.

    Fixture: Astera FP1 Titan Tube, 16-pixel RGB mode (mode 42).
    Per tube: 48 channels (pixel 1 R,G,B, pixel 2 R,G,B, ... pixel 16 R,G,B).
    8 tubes: channels 1-384.
    Tube 0 = ch 1-48, Tube 1 = ch 49-96, ... Tube 7 = ch 337-384.

    Layout: 8 tubes in a vertical line behind the DJ booth, evenly spaced.
    """

    NUM_TUBES = 8
    PIXELS_PER_TUBE = 16
    CHANNELS_PER_TUBE = 48  # 16 pixels * 3 (RGB)

    def __init__(self):
        self._prev = {}
        self.sensitivity = 1.0
        self._time = 0.0

        self._attack = {
            "bass": 0.4, "kick": 0.95, "snare": 0.9,
            "hat": 0.85, "vocals": 0.15, "other": 0.3,
        }
        self._release = {
            "bass": 0.08, "kick": 0.3, "snare": 0.2,
            "hat": 0.4, "vocals": 0.05, "other": 0.1,
        }

    def _smooth(self, key: str, raw: float) -> float:
        prev = self._prev.get(key, 0.0)
        if raw > prev:
            val = prev + (raw - prev) * self._attack.get(key, 0.5)
        else:
            val = prev + (raw - prev) * self._release.get(key, 0.1)
        self._prev[key] = val
        return val

    def _dmx(self, value: float) -> int:
        return int(np.clip(value * self.sensitivity, 0, 1) * 255)

    def _hash(self, x: float, y: float) -> float:
        """Deterministic pseudo-random, matches GLSL hash."""
        import math
        return abs(math.fmod(math.sin(x * 127.1 + y * 311.7) * 43758.5453, 1.0))

    def _compute_pixel(self, tube_idx: int, pixel_idx: int,
                       bass: float, kick: float, snare: float,
                       hat: float, vocals: float, other: float,
                       centroid: float, t: float) -> tuple[int, int, int]:
        """Compute RGB for a single pixel. Returns (r, g, b) as 0-255."""
        import math

        # Normalized pixel position (0 = bottom, 1 = top)
        pn = pixel_idx / (self.PIXELS_PER_TUBE - 1)

        r, g, b = 0.0, 0.0, 0.0

        # --- OTHER/MELODY: ambient base ---
        ct = np.clip(centroid / 5000, 0, 1)
        r += (1 - ct) * 0.8 * other * 0.4
        g += (0.2 + ct * 0.1) * other * 0.4
        b += ct * 0.8 * other * 0.4

        # --- BASS: bottom-up fill, deep red/purple ---
        bass_fill = bass * 1.1
        bass_mask = np.clip((bass_fill - pn) / 0.15, 0, 1)
        r += (0.5 + bass * 0.3) * bass_mask * bass
        b += (0.6 - bass * 0.45) * bass_mask * bass

        # --- VOCALS: flowing vertical wave, blue->pink ---
        vocal_ct = np.clip(centroid / 4000, 0, 1)
        wave = math.sin(pn * 6.2832 + t * 1.5 + tube_idx * 0.5) * 0.5 + 0.5
        r += (0.2 + vocal_ct * 0.7) * vocals * wave * 0.7
        g += (0.3 - vocal_ct * 0.1) * vocals * wave * 0.7
        b += (0.9 - vocal_ct * 0.6) * vocals * wave * 0.7

        # --- SNARE: outer tubes flash orange ---
        is_outer = 1.0 if tube_idx in (0, 1, 6, 7) else 0.2
        r += 1.0 * snare * is_outer
        g += 0.5 * snare * is_outer
        b += 0.08 * snare * is_outer

        # --- HATS: sparkle top half, cyan/white ---
        top_mask = np.clip((pn - 0.4) / 0.3, 0, 1)
        seed = self._hash(float(tube_idx * 16 + pixel_idx), math.floor(t * 8.0))
        spark = 1.0 if seed > (1.0 - hat * 0.5) else 0.0
        spark *= top_mask
        r += (0.4 + seed * 0.6) * spark * hat
        g += (0.9 + seed * 0.1) * spark * hat
        b += 1.0 * spark * hat

        # --- KICK: white flash override ---
        kick2 = kick * kick  # quadratic for punch
        r = r * (1 - kick2) + 1.0 * kick2
        g = g * (1 - kick2) + 0.98 * kick2
        b = b * (1 - kick2) + 0.95 * kick2

        return (self._dmx(r), self._dmx(g), self._dmx(b))

    def map_stems(self, stems: dict) -> dict[int, int]:
        """Convert stem energies to DMX channel:value pairs for all 8 tubes.

        Args:
            stems: dict with keys bass_energy, kick_energy, snare_energy,
                   hat_energy, vocals_energy, other_energy (all 0-1),
                   plus optional 'centroid' (Hz) and 'time' (seconds).

        Returns:
            dict of {channel_number: value} (1-indexed, 0-255) for 384 channels.
        """
        bass = self._smooth("bass", stems.get("bass_energy", 0))
        kick = self._smooth("kick", stems.get("kick_energy", 0))
        snare = self._smooth("snare", stems.get("snare_energy", 0))
        hat = self._smooth("hat", stems.get("hat_energy", 0))
        vocals = self._smooth("vocals", stems.get("vocals_energy", 0))
        other = self._smooth("other", stems.get("other_energy", 0))
        centroid = stems.get("centroid", 2000)
        t = stems.get("time", self._time)
        self._time = t

        output = {}

        for tube in range(self.NUM_TUBES):
            tube_start = tube * self.CHANNELS_PER_TUBE + 1  # 1-indexed DMX
            for px in range(self.PIXELS_PER_TUBE):
                r, g, b = self._compute_pixel(
                    tube, px, bass, kick, snare, hat, vocals, other, centroid, t
                )
                ch = tube_start + px * 3
                output[ch] = r
                output[ch + 1] = g
                output[ch + 2] = b

        return output
