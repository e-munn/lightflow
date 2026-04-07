"""Time alignment via onset cross-correlation.

When a known song is identified, aligns the live audio to the
pre-computed show data by cross-correlating onset envelopes.
"""

from __future__ import annotations

import numpy as np
import librosa


def compute_onset_envelope(
    audio: np.ndarray,
    sr: int = 22050,
    hop_length: int = 512,
) -> np.ndarray:
    """Compute onset strength envelope from audio."""
    return librosa.onset.onset_strength(
        y=audio, sr=sr, hop_length=hop_length,
    )


def align_to_reference(
    live_audio: np.ndarray,
    reference_onsets: np.ndarray,
    sr: int = 22050,
    hop_length: int = 512,
    max_offset_seconds: float = 30.0,
) -> tuple[float, float]:
    """Find time offset between live audio and reference onset envelope.

    Uses cross-correlation of onset envelopes to find the best alignment.

    Args:
        live_audio: recent live audio buffer
        reference_onsets: pre-computed onset envelope for the full song
        sr: sample rate
        hop_length: hop length used for onset computation
        max_offset_seconds: maximum search range

    Returns:
        (offset_seconds, confidence): the estimated position in the song
        and a confidence score [0, 1].
    """
    # Compute onset envelope of live audio
    live_onsets = compute_onset_envelope(live_audio, sr, hop_length)

    if len(live_onsets) < 10 or len(reference_onsets) < 10:
        return 0.0, 0.0

    # Normalize both
    live_norm = live_onsets - live_onsets.mean()
    std = live_norm.std()
    if std > 1e-6:
        live_norm /= std

    ref_norm = reference_onsets - reference_onsets.mean()
    std = ref_norm.std()
    if std > 1e-6:
        ref_norm /= std

    # Cross-correlate (live is shorter, slides over reference)
    max_offset_frames = int(max_offset_seconds * sr / hop_length)
    max_offset_frames = min(max_offset_frames, len(ref_norm) - len(live_norm))

    if max_offset_frames <= 0:
        return 0.0, 0.0

    # Use numpy correlate for efficiency
    corr = np.correlate(ref_norm[:max_offset_frames + len(live_norm)], live_norm, mode="valid")

    if len(corr) == 0:
        return 0.0, 0.0

    # Find best alignment
    best_lag = int(np.argmax(corr))
    best_val = corr[best_lag]

    # Convert lag to seconds
    offset_seconds = best_lag * hop_length / sr

    # Confidence: peak value relative to median
    median_corr = np.median(np.abs(corr))
    confidence = min(1.0, best_val / (median_corr + 1e-6) / 5.0)

    return offset_seconds, confidence
