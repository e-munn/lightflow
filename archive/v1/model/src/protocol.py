"""LightFlow protocol types.

Defines the data structures for the LightFlow lighting protocol,
matching the specification in PROTOCOL.md.
"""

from dataclasses import dataclass, field
from enum import Enum


class Source(str, Enum):
    BASS = "bass"
    DRUMS = "drums"
    VOCALS = "vocals"
    INTENSITY = "intensity"
    SECTION = "section"


class SpatialHint(str, Enum):
    CENTER = "center"
    ALL = "all"
    STEREO = "stereo"
    EDGES = "edges"
    RANDOM = "random"


class ResponseCurve(str, Enum):
    PULSE = "pulse"
    FLASH = "flash"
    SMOOTH = "smooth"
    INVERSE = "inverse"


class BlendMode(str, Enum):
    ADD = "add"
    MAX = "max"
    MULTIPLY = "multiply"


@dataclass
class ColorRule:
    hue: float = 0.0          # 0-1
    saturation: float = 1.0    # 0-1
    hue_follow_source: bool = False  # Shift hue based on source energy


@dataclass
class Layer:
    name: str
    source: Source
    priority: int              # Lower = more important
    spatial: SpatialHint
    response: ResponseCurve
    color: ColorRule = field(default_factory=ColorRule)


@dataclass
class LightShowProtocol:
    layers: list[Layer]
    blend_mode: BlendMode = BlendMode.ADD


@dataclass
class LightingState:
    """A single frame of lighting output from the model."""
    layer_activations: list[float]    # Per-layer activation 0-1
    layer_hues: list[float]           # Per-layer color hue 0-1
    layer_saturations: list[float]    # Per-layer color saturation 0-1
    layer_spatials: list[float]       # Per-layer spatial weight 0-1

    def to_vector(self) -> list[float]:
        """Flatten to a single vector for model output."""
        result = []
        for a, h, s, sp in zip(
            self.layer_activations,
            self.layer_hues,
            self.layer_saturations,
            self.layer_spatials,
        ):
            result.extend([a, h, s, sp])
        return result

    @classmethod
    def from_vector(cls, vector: list[float], per_layer_dim: int = 4) -> "LightingState":
        """Reconstruct from a flat vector."""
        n_layers = len(vector) // per_layer_dim
        activations, hues, saturations, spatials = [], [], [], []
        for i in range(n_layers):
            base = i * per_layer_dim
            activations.append(vector[base])
            hues.append(vector[base + 1])
            saturations.append(vector[base + 2])
            spatials.append(vector[base + 3])
        return cls(activations, hues, saturations, spatials)
