"""Pydantic models for analysis results, show plans, and effects."""

from __future__ import annotations

from enum import Enum
from typing import Union

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Grid constants
# ---------------------------------------------------------------------------

NUM_TUBES = 8
PIXELS_PER_TUBE = 16
GRID_ROWS = PIXELS_PER_TUBE  # 16 pixels tall
GRID_COLS = NUM_TUBES  # 8 tubes wide


# ---------------------------------------------------------------------------
# Analysis models
# ---------------------------------------------------------------------------

class StemEnergies(BaseModel):
    bass: float = 0.0
    kick: float = 0.0
    snare: float = 0.0
    hat: float = 0.0
    vocals: float = 0.0
    other: float = 0.0


class StemOnsets(BaseModel):
    """Per-frame transient sharpness (0-1). Detects actual hits vs sustained energy."""
    kick: float = 0.0
    snare: float = 0.0
    hat: float = 0.0


class StemPans(BaseModel):
    """Per-frame stereo position (-1=left, 0=center, 1=right)."""
    bass: float = 0.0
    vocals: float = 0.0
    other: float = 0.0


class StemBrightness(BaseModel):
    """Per-frame normalized spectral centroid (0-1)."""
    vocals: float = 0.5
    other: float = 0.5


class StemFrame(BaseModel):
    time: float
    stems: StemEnergies
    centroid: float = 2000.0
    onsets: StemOnsets = Field(default_factory=StemOnsets)
    pans: StemPans = Field(default_factory=StemPans)
    brightness: StemBrightness = Field(default_factory=StemBrightness)
    spectral_flux: float = 0.0


class RhythmicPattern(BaseModel):
    four_on_floor: bool = False
    backbeat: bool = False
    hat_rate: str = "8ths"  # "sparse", "8ths", "16ths", "quarters"
    syncopation_level: float = 0.0
    pattern_confidence: float = 0.5


class Section(BaseModel):
    start: float
    end: float
    label: str  # "intro", "verse", "buildup", "drop", "breakdown", "outro"
    energy_level: float = 0.5
    bass_presence: float = 0.5
    has_vocals: bool = False


class AnalysisResult(BaseModel):
    song: str
    source_file: str
    duration: float
    bpm: float
    bpm_confidence: float = 0.7
    fps: int = 30
    sections: list[Section]
    patterns: RhythmicPattern
    frames: list[StemFrame]


# ---------------------------------------------------------------------------
# Show plan models
# ---------------------------------------------------------------------------

class BlendMode(str, Enum):
    MAX = "max"
    ADD = "add"
    REPLACE = "replace"


class Region(BaseModel):
    """Which pixels an effect targets. Use named presets or explicit indices."""
    preset: str | None = None  # "all", "top", "bottom", "outer", "inner", "left", "right"
    tubes: list[int] | None = None  # explicit tube indices (0-7)
    pixel_range: tuple[int, int] | None = None  # (start, end) pixel range within tubes

    def get_tube_mask(self) -> list[bool]:
        """Return 8-element mask of which tubes are active."""
        if self.tubes is not None:
            return [i in self.tubes for i in range(NUM_TUBES)]
        presets = {
            "all": [True] * 8,
            "left": [True, True, True, True, False, False, False, False],
            "right": [False, False, False, False, True, True, True, True],
            "outer": [True, True, False, False, False, False, True, True],
            "inner": [False, False, True, True, True, True, False, False],
        }
        return presets.get(self.preset or "all", [True] * 8)

    def get_pixel_range(self) -> tuple[int, int]:
        """Return (start, end) pixel indices."""
        if self.pixel_range is not None:
            return self.pixel_range
        presets = {
            "top": (0, 8),
            "bottom": (8, 16),
        }
        if self.preset in presets:
            return presets[self.preset]
        return (0, PIXELS_PER_TUBE)


class Color(BaseModel):
    r: float = 0.0  # 0-1
    g: float = 0.0
    b: float = 0.0

    @classmethod
    def from_hex(cls, hex_str: str) -> Color:
        hex_str = hex_str.lstrip("#")
        return cls(
            r=int(hex_str[0:2], 16) / 255,
            g=int(hex_str[2:4], 16) / 255,
            b=int(hex_str[4:6], 16) / 255,
        )

    def as_tuple(self) -> tuple[float, float, float]:
        return (self.r, self.g, self.b)


class EffectInstance(BaseModel):
    """A single effect layer in a section."""
    effect: str  # effect name from registry
    color: Color = Field(default_factory=lambda: Color(r=1.0, g=1.0, b=1.0))
    secondary_color: Color | None = None
    intensity_source: str = "none"  # stem name or "none" for static
    region: Region = Field(default_factory=lambda: Region(preset="all"))
    speed: float = 1.0
    direction: str = "up"  # "up", "down", "left", "right", "outward", "inward"
    blend_mode: BlendMode = BlendMode.MAX
    intensity: float = 1.0
    attack_ms: float = 50.0
    release_ms: float = 200.0
    attack_beats: float | None = None   # overrides attack_ms when set
    release_beats: float | None = None  # overrides release_ms when set
    pan_follow: bool = False
    onset_mode: bool = False

    def resolve_attack_ms(self, bpm: float) -> float:
        """Return attack time in ms, using beat-relative value if set."""
        if self.attack_beats is not None and bpm > 0:
            return self.attack_beats * (60.0 / bpm) * 1000.0
        return self.attack_ms

    def resolve_release_ms(self, bpm: float) -> float:
        """Return release time in ms, using beat-relative value if set."""
        if self.release_beats is not None and bpm > 0:
            return self.release_beats * (60.0 / bpm) * 1000.0
        return self.release_ms


class TransitionType(str, Enum):
    CROSSFADE = "crossfade"
    HARD_CUT = "hard_cut"


class SectionPlan(BaseModel):
    """The lighting plan for one section of the song."""
    section_label: str
    start: float
    end: float
    effects: list[EffectInstance]
    transition_in: TransitionType = TransitionType.CROSSFADE
    transition_duration: float = 0.5  # seconds


class ShowPlan(BaseModel):
    """Complete show plan: sections with layered effects."""
    song: str
    bpm: float
    style: str = "energetic"
    sections: list[SectionPlan]
