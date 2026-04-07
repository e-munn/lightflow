"""64-dim protocol vector specification for LightFlow v4.

The protocol vector is the universal intermediate representation between
the ML model and the fixture router. Every channel is continuous [0, 1]
unless noted otherwise.

Layout:
    [0:6]   stem_energies      bass, kick, snare, hat, vocals, other
    [6:9]   onset_sharpness    kick_onset, snare_onset, hat_onset
    [9:17]  spatial_weights    per-tube intensity weights (8 tubes)
    [17:21] motion             speed, dir_x, dir_y, complexity
    [21:27] texture            pulse, sparkle, fill, wave, flash, glow
    [27:31] color              warmth, saturation, hue, contrast
    [31:35] dynamics           attack, release, master_intensity, gate
    [35:41] section_encoding   6-class soft (intro, verse, buildup, drop, breakdown, outro)
    [41:44] bpm_info           beat_phase, bar_phase, normalized_bpm
    [44:64] future_prediction  +100ms subset (20-dim)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum

import numpy as np

PROTOCOL_DIM = 64
FUTURE_DIM = 20

SECTION_LABELS = ["intro", "verse", "buildup", "drop", "breakdown", "outro"]
NUM_SECTIONS = len(SECTION_LABELS)
STEM_NAMES = ["bass", "kick", "snare", "hat", "vocals", "other"]
NUM_STEMS = len(STEM_NAMES)
NUM_TUBES = 8


class Slice(IntEnum):
    """Start indices for each protocol group."""
    STEM_ENERGY = 0       # 6 dims
    ONSET = 6             # 3 dims
    SPATIAL = 9           # 8 dims
    MOTION = 17           # 4 dims
    TEXTURE = 21          # 6 dims
    COLOR = 27            # 4 dims
    DYNAMICS = 31         # 4 dims
    SECTION = 35          # 6 dims
    BPM = 41              # 3 dims
    FUTURE = 44           # 20 dims


@dataclass
class ProtocolVector:
    """Named access to protocol vector channels."""
    # Stem energies
    bass: float = 0.0
    kick: float = 0.0
    snare: float = 0.0
    hat: float = 0.0
    vocals: float = 0.0
    other: float = 0.0

    # Onset sharpness
    kick_onset: float = 0.0
    snare_onset: float = 0.0
    hat_onset: float = 0.0

    # Spatial (per-tube weights)
    spatial: np.ndarray | None = None  # (8,)

    # Motion
    motion_speed: float = 0.0
    motion_dir_x: float = 0.5   # 0=left, 0.5=center, 1=right
    motion_dir_y: float = 0.5   # 0=up, 0.5=center, 1=down
    motion_complexity: float = 0.0

    # Texture
    pulse: float = 0.0
    sparkle: float = 0.0
    fill: float = 0.0
    wave: float = 0.0
    flash: float = 0.0
    glow: float = 0.0

    # Color
    warmth: float = 0.5
    saturation: float = 0.5
    hue: float = 0.5
    contrast: float = 0.5

    # Dynamics
    attack: float = 0.5
    release: float = 0.5
    master_intensity: float = 0.0
    gate: float = 1.0

    # Section (soft encoding)
    section_probs: np.ndarray | None = None  # (6,)

    # BPM info
    beat_phase: float = 0.0
    bar_phase: float = 0.0
    normalized_bpm: float = 0.5  # mapped: 60bpm=0, 180bpm=1

    # Future prediction
    future: np.ndarray | None = None  # (20,)

    def to_array(self) -> np.ndarray:
        """Encode to 64-dim numpy array."""
        vec = np.zeros(PROTOCOL_DIM, dtype=np.float32)

        # Stems [0:6]
        vec[0] = self.bass
        vec[1] = self.kick
        vec[2] = self.snare
        vec[3] = self.hat
        vec[4] = self.vocals
        vec[5] = self.other

        # Onsets [6:9]
        vec[6] = self.kick_onset
        vec[7] = self.snare_onset
        vec[8] = self.hat_onset

        # Spatial [9:17]
        if self.spatial is not None:
            vec[9:17] = self.spatial[:NUM_TUBES]
        else:
            vec[9:17] = 0.5  # centered default

        # Motion [17:21]
        vec[17] = self.motion_speed
        vec[18] = self.motion_dir_x
        vec[19] = self.motion_dir_y
        vec[20] = self.motion_complexity

        # Texture [21:27]
        vec[21] = self.pulse
        vec[22] = self.sparkle
        vec[23] = self.fill
        vec[24] = self.wave
        vec[25] = self.flash
        vec[26] = self.glow

        # Color [27:31]
        vec[27] = self.warmth
        vec[28] = self.saturation
        vec[29] = self.hue
        vec[30] = self.contrast

        # Dynamics [31:35]
        vec[31] = self.attack
        vec[32] = self.release
        vec[33] = self.master_intensity
        vec[34] = self.gate

        # Section [35:41]
        if self.section_probs is not None:
            vec[35:41] = self.section_probs[:NUM_SECTIONS]

        # BPM [41:44]
        vec[41] = self.beat_phase
        vec[42] = self.bar_phase
        vec[43] = self.normalized_bpm

        # Future [44:64]
        if self.future is not None:
            vec[44:64] = self.future[:FUTURE_DIM]

        return np.clip(vec, 0.0, 1.0)

    @classmethod
    def from_array(cls, vec: np.ndarray) -> ProtocolVector:
        """Decode from 64-dim array."""
        return cls(
            bass=float(vec[0]),
            kick=float(vec[1]),
            snare=float(vec[2]),
            hat=float(vec[3]),
            vocals=float(vec[4]),
            other=float(vec[5]),
            kick_onset=float(vec[6]),
            snare_onset=float(vec[7]),
            hat_onset=float(vec[8]),
            spatial=vec[9:17].copy(),
            motion_speed=float(vec[17]),
            motion_dir_x=float(vec[18]),
            motion_dir_y=float(vec[19]),
            motion_complexity=float(vec[20]),
            pulse=float(vec[21]),
            sparkle=float(vec[22]),
            fill=float(vec[23]),
            wave=float(vec[24]),
            flash=float(vec[25]),
            glow=float(vec[26]),
            warmth=float(vec[27]),
            saturation=float(vec[28]),
            hue=float(vec[29]),
            contrast=float(vec[30]),
            attack=float(vec[31]),
            release=float(vec[32]),
            master_intensity=float(vec[33]),
            gate=float(vec[34]),
            section_probs=vec[35:41].copy(),
            beat_phase=float(vec[41]),
            bar_phase=float(vec[42]),
            normalized_bpm=float(vec[43]),
            future=vec[44:64].copy(),
        )


def section_to_onehot(label: str) -> np.ndarray:
    """Convert section label string to 6-dim one-hot."""
    vec = np.zeros(NUM_SECTIONS, dtype=np.float32)
    if label in SECTION_LABELS:
        vec[SECTION_LABELS.index(label)] = 1.0
    return vec


def bpm_to_normalized(bpm: float) -> float:
    """Map BPM to [0, 1] range. 60 BPM -> 0.0, 180 BPM -> 1.0."""
    return np.clip((bpm - 60.0) / 120.0, 0.0, 1.0)


def normalized_to_bpm(val: float) -> float:
    """Inverse of bpm_to_normalized."""
    return val * 120.0 + 60.0
