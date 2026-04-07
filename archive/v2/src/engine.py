"""Main engine: wires audio analysis → mapping → DMX output."""

import signal
import sys

from .audio import AudioAnalyzer
from .dmx import DMXOutput
from .mapping import FeatureMapper


class LightEngine:
    """Real-time mic → DMX lighting engine."""

    def __init__(self, dmx_port=None, device=None, fps=40):
        self.audio = AudioAnalyzer()
        self.dmx = DMXOutput(port=dmx_port, fps=fps)
        self.mapper = FeatureMapper()
        self._device = device

    def _on_audio(self, features: dict):
        """Called each audio block with extracted features."""
        channel_values = self.mapper.map(features)
        for ch, val in channel_values.items():
            self.dmx.set_channel(ch, val)

    def run(self):
        """Start the engine. Blocks until Ctrl-C."""
        print("Starting LightFlow v2")
        print(f"  Audio device: {self._device or 'default'}")
        print(f"  DMX FPS: {self.dmx.fps}")
        print(f"  Sensitivity: {self.mapper.sensitivity}")
        print()

        # List audio devices
        print("Available audio devices:")
        print(self.audio.list_devices())
        print()

        self.dmx.start()
        self.audio.start(callback=self._on_audio, device=self._device)

        print("Running. Ctrl-C to stop.\n")

        # Block until interrupt
        signal.signal(signal.SIGINT, lambda *_: self.stop())
        signal.pause()

    def stop(self):
        print("\nStopping...")
        self.audio.stop()
        self.dmx.stop()
        sys.exit(0)
