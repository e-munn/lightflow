"""DMX output for 8 Astera Titan Tubes (384 channels).

Simplified from v2: no render thread, just direct channel send.
The executor loop handles timing.
"""

from __future__ import annotations

import numpy as np

from schemas import NUM_TUBES, PIXELS_PER_TUBE

try:
    from dmxpy.DmxPy import DmxPy
    HAS_DMXPY = True
except ImportError:
    HAS_DMXPY = False

CHANNELS_PER_TUBE = PIXELS_PER_TUBE * 3  # 48
TOTAL_CHANNELS = NUM_TUBES * CHANNELS_PER_TUBE  # 384


class DMXOutput:
    """Sends pixel grid to Titan Tubes via ENTTEC DMX USB Pro."""

    def __init__(self, port: str | None = None):
        self._port = port
        self._dmx = None
        self._backend = "dummy"
        self.channels = np.zeros(512, dtype=np.uint8)

    def open(self):
        if HAS_DMXPY and self._port:
            self._dmx = DmxPy(self._port)
            self._backend = "dmxpy"
            print(f"[DMX] Connected via DmxPy on {self._port}")
        else:
            self._backend = "dummy"
            if not self._port:
                print("[DMX] No port specified — dummy mode")
            else:
                print("[DMX] DmxPy not installed — dummy mode")

    def send_grid(self, grid: np.ndarray):
        """Send a 16x8x3 float (0-1) grid to DMX.

        Maps grid[row][col] to tube=col, pixel=row.
        Tube 0 = ch 1-48, Tube 1 = ch 49-96, etc.
        """
        for tube in range(NUM_TUBES):
            tube_start = tube * CHANNELS_PER_TUBE
            for px in range(PIXELS_PER_TUBE):
                ch = tube_start + px * 3
                self.channels[ch] = int(np.clip(grid[px, tube, 0], 0, 1) * 255)
                self.channels[ch + 1] = int(np.clip(grid[px, tube, 1], 0, 1) * 255)
                self.channels[ch + 2] = int(np.clip(grid[px, tube, 2], 0, 1) * 255)

        self._send()

    def _send(self):
        if self._backend == "dmxpy":
            for i in range(TOTAL_CHANNELS):
                self._dmx.setChannel(i + 1, int(self.channels[i]))
            self._dmx.render()

    def blackout(self):
        self.channels[:] = 0
        self._send()

    def close(self):
        self.blackout()
