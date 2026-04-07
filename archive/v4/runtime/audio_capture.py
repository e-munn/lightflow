"""Ring buffer audio capture from mic/line input.

Captures audio at 22050Hz in a background thread, providing
a sliding window for feature extraction.
"""

from __future__ import annotations

import threading

import numpy as np
import sounddevice as sd


class AudioCapture:
    """Ring buffer audio capture for real-time processing.

    Captures mono audio at the specified sample rate and provides
    a sliding window of the most recent samples.
    """

    def __init__(
        self,
        sample_rate: int = 22050,
        buffer_seconds: float = 10.0,
        device: int | str | None = None,
    ):
        self.sample_rate = sample_rate
        self.buffer_size = int(buffer_seconds * sample_rate)
        self.device = device

        self._buffer = np.zeros(self.buffer_size, dtype=np.float32)
        self._write_pos = 0
        self._lock = threading.Lock()
        self._stream: sd.InputStream | None = None
        self._running = False

    def _audio_callback(self, indata: np.ndarray, frames: int,
                        time_info, status):
        """Called by sounddevice for each audio block."""
        if status:
            pass  # silently handle overflows
        mono = indata[:, 0] if indata.ndim > 1 else indata.flatten()
        n = len(mono)

        with self._lock:
            end = self._write_pos + n
            if end <= self.buffer_size:
                self._buffer[self._write_pos:end] = mono
            else:
                # Wrap around
                first = self.buffer_size - self._write_pos
                self._buffer[self._write_pos:] = mono[:first]
                self._buffer[:n - first] = mono[first:]
            self._write_pos = end % self.buffer_size

    def start(self):
        """Start audio capture in background."""
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=1,
            dtype="float32",
            blocksize=1024,
            device=self.device,
            callback=self._audio_callback,
        )
        self._stream.start()
        self._running = True

    def stop(self):
        """Stop audio capture."""
        self._running = False
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def get_window(self, window_samples: int) -> np.ndarray:
        """Get the most recent `window_samples` of audio.

        Args:
            window_samples: number of samples to return

        Returns:
            (window_samples,) float32 array
        """
        window_samples = min(window_samples, self.buffer_size)
        with self._lock:
            start = (self._write_pos - window_samples) % self.buffer_size
            if start < self._write_pos:
                return self._buffer[start:self._write_pos].copy()
            else:
                return np.concatenate([
                    self._buffer[start:],
                    self._buffer[:self._write_pos],
                ]).copy()

    @property
    def is_running(self) -> bool:
        return self._running
