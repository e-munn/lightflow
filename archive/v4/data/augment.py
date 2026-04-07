"""Data augmentation for training data.

Augmentations that preserve musical meaning:
  - Spatial mirror: flip tube order (left-right)
  - Intensity scale: scale all energy channels
  - Time jitter: small random shifts in feature alignment
  - Noise injection: small additive noise to features
"""

from __future__ import annotations

import numpy as np

from model.protocol import Slice, NUM_TUBES, PROTOCOL_DIM


def augment_spatial_mirror(
    features: np.ndarray, labels: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Mirror the spatial dimension (flip left-right tube order).

    Args:
        features: (seq_len, feature_dim) audio features
        labels: (seq_len, 64) protocol vectors

    Returns:
        Augmented (features, labels) copies
    """
    features_aug = features.copy()
    labels_aug = labels.copy()

    # Flip spatial weights [9:17] -> reverse tube order
    labels_aug[:, Slice.SPATIAL:Slice.SPATIAL + NUM_TUBES] = \
        labels_aug[:, Slice.SPATIAL:Slice.SPATIAL + NUM_TUBES][:, ::-1]

    # Flip motion dir_x: 0->1, 1->0 (left becomes right)
    labels_aug[:, Slice.MOTION + 1] = 1.0 - labels_aug[:, Slice.MOTION + 1]

    # Flip future spatial if present
    labels_aug[:, Slice.FUTURE + 9:Slice.FUTURE + 17] = \
        labels_aug[:, Slice.FUTURE + 9:Slice.FUTURE + 17][:, ::-1]

    return features_aug, labels_aug


def augment_intensity_scale(
    features: np.ndarray, labels: np.ndarray,
    scale_range: tuple[float, float] = (0.7, 1.3),
) -> tuple[np.ndarray, np.ndarray]:
    """Scale intensity-related channels by a random factor.

    Args:
        features: (seq_len, feature_dim)
        labels: (seq_len, 64)
        scale_range: (min_scale, max_scale)

    Returns:
        Augmented (features, labels) copies
    """
    scale = np.random.uniform(scale_range[0], scale_range[1])

    features_aug = features.copy()
    labels_aug = labels.copy()

    # Scale stem energies
    labels_aug[:, Slice.STEM_ENERGY:Slice.STEM_ENERGY + 6] *= scale
    # Scale onsets
    labels_aug[:, Slice.ONSET:Slice.ONSET + 3] *= scale
    # Scale master intensity
    labels_aug[:, Slice.DYNAMICS + 2] *= scale
    # Scale texture channels
    labels_aug[:, Slice.TEXTURE:Slice.TEXTURE + 6] *= scale

    # Also scale RMS in features (last channel before centroid)
    # mel(128) + onset(1) + chroma(12) + rms(1) + centroid(1) = 143
    features_aug[:, 141] *= scale  # RMS is at index 141

    # Clip to valid range
    labels_aug = np.clip(labels_aug, 0.0, 1.0)
    return features_aug, labels_aug


def augment_feature_noise(
    features: np.ndarray,
    noise_level: float = 0.01,
) -> np.ndarray:
    """Add small Gaussian noise to features."""
    noise = np.random.randn(*features.shape).astype(np.float32) * noise_level
    return features + noise


def augment_gain_jitter(
    features: np.ndarray,
    gain_range: tuple[float, float] = (0.8, 1.2),
) -> np.ndarray:
    """Apply random gain to feature magnitudes."""
    gain = np.random.uniform(gain_range[0], gain_range[1])
    return features * gain
