"""DMX output via sACN (E1.31) for real-time fixture control.

Supports both sACN network output and ENTTEC USB Pro.
Falls back to dummy mode if no hardware is available.
"""

from __future__ import annotations

import numpy as np

NUM_TUBES = 8
PIXELS_PER_TUBE = 16
CHANNELS_PER_TUBE = PIXELS_PER_TUBE * 3  # 48
TOTAL_CHANNELS = NUM_TUBES * CHANNELS_PER_TUBE  # 384


class DMXOutput:
    """Sends pixel grid to Titan Tubes via sACN or USB DMX."""

    def __init__(
        self,
        method: str = "sacn",     # "sacn", "usb", "dummy"
        sacn_ip: str | None = None,
        usb_port: str | None = None,
        universe: int = 1,
    ):
        self._method = method
        self._sacn_ip = sacn_ip
        self._usb_port = usb_port
        self._universe = universe
        self._sender = None
        self._dmx = None
        self.channels = np.zeros(512, dtype=np.uint8)

    def open(self):
        """Initialize the output backend."""
        if self._method == "sacn":
            try:
                import sacn
                self._sender = sacn.sACNsender()
                self._sender.start()
                self._sender.activate_output(self._universe)
                if self._sacn_ip:
                    self._sender[self._universe].destination = self._sacn_ip
                self._sender[self._universe].multicast = (self._sacn_ip is None)
                print(f"[DMX] sACN output active (universe {self._universe})")
            except ImportError:
                print("[DMX] sacn not installed — dummy mode")
                self._method = "dummy"
        elif self._method == "usb":
            try:
                from dmxpy.DmxPy import DmxPy
                self._dmx = DmxPy(self._usb_port)
                print(f"[DMX] USB DMX on {self._usb_port}")
            except (ImportError, Exception) as e:
                print(f"[DMX] USB DMX failed: {e} — dummy mode")
                self._method = "dummy"
        else:
            print("[DMX] Dummy mode")

    def send_grid(self, grid: np.ndarray):
        """Send a 16x8x3 float (0-1) grid to DMX.

        Maps grid[row][col] to tube=col, pixel=row.
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
        if self._method == "sacn" and self._sender is not None:
            data = tuple(self.channels[:TOTAL_CHANNELS])
            self._sender[self._universe].dmx_data = data
        elif self._method == "usb" and self._dmx is not None:
            for i in range(TOTAL_CHANNELS):
                self._dmx.setChannel(i + 1, int(self.channels[i]))
            self._dmx.render()

    def blackout(self):
        self.channels[:] = 0
        self._send()

    def close(self):
        self.blackout()
        if self._sender is not None:
            self._sender.stop()
            self._sender = None
        self._dmx = None
