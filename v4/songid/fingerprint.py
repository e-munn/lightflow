"""Chromaprint audio fingerprinting for song identification.

Runs fingerprinting in a background thread every 5 seconds,
comparing against a local database of known songs.
"""

from __future__ import annotations

import threading
import time

import numpy as np


class Fingerprinter:
    """Background audio fingerprinter using Chromaprint.

    Periodically fingerprints the audio buffer and looks up
    the result in the song database.
    """

    def __init__(
        self,
        database,  # SongDatabase
        sample_rate: int = 22050,
        interval: float = 5.0,
        duration: float = 10.0,
    ):
        self.database = database
        self.sample_rate = sample_rate
        self.interval = interval
        self.duration = duration

        self._thread: threading.Thread | None = None
        self._running = False
        self._audio_getter = None  # callable that returns audio buffer
        self._match: dict | None = None
        self._lock = threading.Lock()

    @property
    def match(self) -> dict | None:
        """Current matched song, or None."""
        with self._lock:
            return self._match

    def start(self, audio_getter):
        """Start background fingerprinting.

        Args:
            audio_getter: callable() -> np.ndarray, returns recent audio
        """
        self._audio_getter = audio_getter
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None

    def _run(self):
        """Background fingerprinting loop."""
        while self._running:
            try:
                audio = self._audio_getter()
                if audio is not None and len(audio) > self.sample_rate:
                    result = self._fingerprint_and_lookup(audio)
                    with self._lock:
                        self._match = result
            except Exception:
                pass  # don't crash the background thread
            time.sleep(self.interval)

    def _fingerprint_and_lookup(self, audio: np.ndarray) -> dict | None:
        """Fingerprint audio and look up in database.

        Returns:
            {"song_id": str, "song_name": str, "confidence": float} or None
        """
        try:
            import acoustid
            # Convert float32 to int16 for chromaprint
            audio_int16 = (audio * 32767).astype(np.int16)

            # Get fingerprint
            duration = len(audio) / self.sample_rate
            fp = acoustid.fingerprint(
                self.sample_rate, 1, audio_int16.tobytes(), int(duration)
            )

            if fp is None:
                return None

            # Look up in local database
            return self.database.lookup_fingerprint(fp)

        except ImportError:
            return None
        except Exception:
            return None
