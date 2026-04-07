"""Real-time BPM tracker using onset autocorrelation.

Maintains a rolling window of onset strength values and estimates
BPM via autocorrelation of the onset envelope.
"""

from __future__ import annotations

import numpy as np
import librosa


class BPMTracker:
    """Onset autocorrelation BPM tracker on a rolling window.

    Updates incrementally with each audio chunk rather than
    re-analyzing the full buffer.
    """

    def __init__(
        self,
        sample_rate: int = 22050,
        window_seconds: float = 10.0,
        hop_length: int = 512,
        min_bpm: float = 60.0,
        max_bpm: float = 200.0,
        smoothing: float = 0.9,
    ):
        self.sample_rate = sample_rate
        self.hop_length = hop_length
        self.min_bpm = min_bpm
        self.max_bpm = max_bpm
        self.smoothing = smoothing

        # Rolling onset buffer
        self._window_frames = int(window_seconds * sample_rate / hop_length)
        self._onset_buffer = np.zeros(self._window_frames, dtype=np.float32)
        self._onset_pos = 0
        self._onset_count = 0

        # State
        self._bpm = 0.0
        self._confidence = 0.0
        self._update_counter = 0
        self._update_interval = 5  # re-estimate every N calls

    @property
    def bpm(self) -> float:
        return self._bpm

    @property
    def confidence(self) -> float:
        return self._confidence

    def update(self, audio_chunk: np.ndarray):
        """Update with a new audio chunk.

        Args:
            audio_chunk: mono audio samples
        """
        # Compute onset strength for this chunk
        if len(audio_chunk) < self.hop_length * 2:
            return

        onset = librosa.onset.onset_strength(
            y=audio_chunk, sr=self.sample_rate,
            hop_length=self.hop_length,
        )

        # Append to rolling buffer
        n = len(onset)
        for i in range(n):
            self._onset_buffer[self._onset_pos % self._window_frames] = onset[i]
            self._onset_pos += 1
            self._onset_count += 1

        # Periodically re-estimate BPM
        self._update_counter += 1
        if self._update_counter >= self._update_interval and self._onset_count >= self._window_frames // 2:
            self._update_counter = 0
            self._estimate_bpm()

    def _estimate_bpm(self):
        """Estimate BPM from onset autocorrelation."""
        # Get the filled portion of the buffer
        n = min(self._onset_count, self._window_frames)
        if n < 20:
            return

        # Arrange buffer in order
        if self._onset_count >= self._window_frames:
            start = self._onset_pos % self._window_frames
            onset = np.concatenate([
                self._onset_buffer[start:],
                self._onset_buffer[:start],
            ])
        else:
            onset = self._onset_buffer[:n]

        # Normalize
        onset = onset - onset.mean()
        std = onset.std()
        if std < 1e-6:
            return
        onset = onset / std

        # Autocorrelation
        corr = np.correlate(onset, onset, mode="full")
        corr = corr[len(corr) // 2:]  # positive lags only

        # Convert lag range to BPM range
        fps = self.sample_rate / self.hop_length
        min_lag = int(fps * 60.0 / self.max_bpm)
        max_lag = int(fps * 60.0 / self.min_bpm)
        max_lag = min(max_lag, len(corr) - 1)

        if min_lag >= max_lag:
            return

        # Find peak in valid range
        search = corr[min_lag:max_lag + 1]
        peak_idx = np.argmax(search) + min_lag
        peak_val = corr[peak_idx]

        if peak_val < 0.1:
            return

        # Convert lag to BPM
        raw_bpm = fps * 60.0 / peak_idx

        # Normalize to 60-200 range
        while raw_bpm > self.max_bpm:
            raw_bpm /= 2
        while raw_bpm < self.min_bpm:
            raw_bpm *= 2

        # Confidence from peak prominence
        baseline = np.median(np.abs(search))
        confidence = min(1.0, (peak_val - baseline) / (peak_val + 1e-6))

        # Smooth
        if self._bpm > 0:
            self._bpm = self.smoothing * self._bpm + (1 - self.smoothing) * raw_bpm
        else:
            self._bpm = raw_bpm
        self._confidence = self.smoothing * self._confidence + (1 - self.smoothing) * confidence

    def reset(self):
        """Reset tracker state."""
        self._onset_buffer[:] = 0
        self._onset_pos = 0
        self._onset_count = 0
        self._bpm = 0.0
        self._confidence = 0.0
        self._update_counter = 0
