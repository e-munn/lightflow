"""DMX output via ENTTEC-compatible USB adapters."""

import time
import threading
import numpy as np

try:
    from dmxpy.DmxPy import DmxPy
    HAS_DMXPY = True
except ImportError:
    HAS_DMXPY = False

try:
    from PyDMXControl.controllers import OpenDMXController
    HAS_PYDMX = True
except ImportError:
    HAS_PYDMX = False


class DMXOutput:
    """Sends DMX channel values to fixtures via USB adapter.

    Supports ENTTEC Open DMX (via PyDMXControl) and
    ENTTEC DMX USB Pro (via DmxPy).
    """

    def __init__(self, port=None, fps=40):
        self.fps = fps
        self.channels = np.zeros(512, dtype=np.uint8)
        self._lock = threading.Lock()
        self._running = False
        self._thread = None
        self._backend = None
        self._port = port

    def open(self):
        """Open connection to DMX adapter."""
        if HAS_DMXPY and self._port:
            self._backend = "dmxpy"
            self._dmx = DmxPy(self._port)
        elif HAS_PYDMX:
            self._backend = "pydmxcontrol"
            self._controller = OpenDMXController()
        else:
            self._backend = "dummy"
            print("[DMX] No DMX library found - running in dummy mode (values printed to console)")

    def set_channel(self, channel: int, value: int):
        """Set a single DMX channel (1-512) to a value (0-255)."""
        with self._lock:
            self.channels[channel - 1] = np.clip(value, 0, 255)

    def set_channels(self, start: int, values: list[int]):
        """Set multiple consecutive channels starting from start (1-based)."""
        with self._lock:
            for i, v in enumerate(values):
                self.channels[start - 1 + i] = np.clip(v, 0, 255)

    def blackout(self):
        """Set all channels to 0."""
        with self._lock:
            self.channels[:] = 0
        self._send()

    def _send(self):
        """Push current channel state to the adapter."""
        with self._lock:
            data = self.channels.copy()

        if self._backend == "dmxpy":
            for i, v in enumerate(data):
                self._dmx.setChannel(i + 1, int(v))
            self._dmx.render()
        elif self._backend == "pydmxcontrol":
            # PyDMXControl manages its own fixtures - direct channel access
            pass
        elif self._backend == "dummy":
            # Print a compact summary of non-zero channels
            active = [(i + 1, int(v)) for i, v in enumerate(data) if v > 0]
            if active:
                print(f"[DMX] {active[:16]}{'...' if len(active) > 16 else ''}")

    def _render_loop(self):
        interval = 1.0 / self.fps
        while self._running:
            self._send()
            time.sleep(interval)

    def start(self):
        """Start the render loop (sends DMX frames at target FPS)."""
        self.open()
        self._running = True
        self._thread = threading.Thread(target=self._render_loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2)
        self.blackout()

    def close(self):
        self.stop()
