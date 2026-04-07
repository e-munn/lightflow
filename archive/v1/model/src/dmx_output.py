"""DMX output mapping: converts model predictions to DMX channel values.

Maps abstract LightFlow protocol outputs (layer activations, colors, spatial hints)
to concrete DMX512 channel values for physical lighting fixtures.
"""

import colorsys
from dataclasses import dataclass

import numpy as np


@dataclass
class DMXFixture:
    """Represents a DMX lighting fixture."""
    name: str
    start_channel: int
    channels: int  # Number of DMX channels this fixture uses
    position: float  # Normalized position 0.0 (left) to 1.0 (right)

    # Channel layout (offsets from start_channel)
    dimmer_offset: int = 0
    red_offset: int = 1
    green_offset: int = 2
    blue_offset: int = 3


class DMXOutput:
    """Maps model output to DMX channel values."""

    def __init__(self, config: dict, fixtures: list[DMXFixture]):
        self.config = config
        self.fixtures = fixtures
        self.universe = config["dmx"]["universe"]
        self.per_layer_dim = config["protocol"]["per_layer_dim"]
        self.max_layers = config["protocol"]["max_layers"]

        # DMX universe: 512 channels, all starting at 0
        self.dmx_buffer = np.zeros(512, dtype=np.uint8)

    def map_prediction(self, prediction: np.ndarray) -> np.ndarray:
        """Convert model output vector to DMX channel values.

        Args:
            prediction: Model output, shape (output_dim,), values in [0, 1]

        Returns:
            DMX buffer, shape (512,), values 0-255
        """
        self.dmx_buffer[:] = 0

        # Parse prediction into layers
        layers = []
        for i in range(self.max_layers):
            base = i * self.per_layer_dim
            if base + self.per_layer_dim > len(prediction):
                break
            activation = prediction[base]
            hue = prediction[base + 1]
            saturation = prediction[base + 2]
            spatial = prediction[base + 3]
            if activation > 0.05:  # Skip inactive layers
                layers.append({
                    "activation": activation,
                    "hue": hue,
                    "saturation": saturation,
                    "spatial": spatial,
                })

        # Distribute layers across fixtures based on spatial hints
        for fixture in self.fixtures:
            r_total, g_total, b_total = 0.0, 0.0, 0.0
            brightness = 0.0

            for layer in layers:
                # Spatial weighting: how much this fixture should respond to this layer
                spatial_weight = self._spatial_weight(fixture.position, layer["spatial"])

                # Convert HSV to RGB
                r, g, b = colorsys.hsv_to_rgb(
                    layer["hue"],
                    layer["saturation"],
                    layer["activation"] * spatial_weight,
                )

                r_total += r
                g_total += g
                b_total += b
                brightness += layer["activation"] * spatial_weight

            # Clamp and scale to 0-255
            ch = fixture.start_channel
            self.dmx_buffer[ch + fixture.dimmer_offset] = int(min(brightness, 1.0) * 255)
            self.dmx_buffer[ch + fixture.red_offset] = int(min(r_total, 1.0) * 255)
            self.dmx_buffer[ch + fixture.green_offset] = int(min(g_total, 1.0) * 255)
            self.dmx_buffer[ch + fixture.blue_offset] = int(min(b_total, 1.0) * 255)

        return self.dmx_buffer.copy()

    @staticmethod
    def _spatial_weight(fixture_position: float, spatial_hint: float) -> float:
        """Compute spatial weight for a fixture given a spatial hint.

        spatial_hint is continuous 0-1:
            0.0 = edges only
            0.25 = left-biased
            0.5 = center
            0.75 = right-biased
            1.0 = all (uniform)
        """
        if spatial_hint > 0.9:  # "all" - uniform
            return 1.0

        # Distance from the spatial target to the fixture
        target = spatial_hint * 2  # Map 0-0.5 to 0-1 position range
        target = min(target, 1.0)
        distance = abs(fixture_position - target)

        # Gaussian-like falloff
        return float(np.exp(-distance * distance * 4))
