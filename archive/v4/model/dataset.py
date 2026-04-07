"""Sequence dataset for LightFlow v4 protocol vector training.

Loads pre-generated (v1_features, protocol_vector) pairs from .npy files
and serves sequences for StreamingGRU training.

Expected data layout:
    data/training/
        song_name/
            features_energetic.npy    # (n_frames, 143)
            labels_energetic.npy      # (n_frames, 64)
            features_dramatic.npy
            labels_dramatic.npy
            ...
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

from .protocol import PROTOCOL_DIM, NUM_SECTIONS, Slice, bpm_to_normalized


class ProtocolSequenceDataset(Dataset):
    """Sequence dataset for LightFlowGRU training.

    Each sample is a contiguous sequence of `seq_len` frames from a single
    song/style variant.

    Returns:
        features: (seq_len, 151) — 143 audio + 1 bpm + 1 beat_phase + 6 section
        labels: (seq_len, 64) — protocol vectors
    """

    def __init__(
        self,
        data_dir: str | Path,
        config: dict,
        split: str = "train",
    ):
        self.data_dir = Path(data_dir)
        self.config = config

        model_cfg = config["model"]
        self.seq_len = model_cfg.get("seq_len", 64)
        self.audio_features_dim = model_cfg.get("audio_features", 143)
        self.input_dim = model_cfg["input_channels"]  # 151

        data_cfg = config["data"]
        self.overlap = data_cfg.get("seq_overlap", 0.5)

        augment_cfg = data_cfg.get("augment", {})
        self.do_augment = split == "train" and bool(augment_cfg)
        self.augment_cfg = augment_cfg

        # Discover all song/style variants
        self.variants = self._discover_variants()
        self._split_variants(split, data_cfg)

        # Load all data into memory
        self._features_cache: dict[int, np.ndarray] = {}
        self._labels_cache: dict[int, np.ndarray] = {}
        self._load_data()

        # Build sequence index
        self.sequences = self._build_sequence_index()

    def _discover_variants(self) -> list[dict]:
        """Find all song/style variant pairs with feature + label files."""
        variants = []
        if not self.data_dir.exists():
            return variants

        for song_dir in sorted(self.data_dir.iterdir()):
            if not song_dir.is_dir() or song_dir.name.startswith("_"):
                continue

            # Find all style variants
            for feat_file in sorted(song_dir.glob("features_*.npy")):
                style = feat_file.stem.replace("features_", "")
                label_file = song_dir / f"labels_{style}.npy"
                if label_file.exists():
                    variants.append({
                        "song": song_dir.name,
                        "style": style,
                        "features": feat_file,
                        "labels": label_file,
                    })

        return variants

    def _split_variants(self, split: str, data_cfg: dict):
        """Split variants by song (not by variant, to prevent data leakage)."""
        # Group by song
        songs = sorted(set(v["song"] for v in self.variants))
        n = len(songs)
        train_end = int(n * data_cfg["train_split"])
        val_end = train_end + int(n * data_cfg["val_split"])

        if split == "train":
            keep_songs = set(songs[:train_end])
        elif split == "val":
            keep_songs = set(songs[train_end:val_end])
        else:
            keep_songs = set(songs[val_end:])

        self.variants = [v for v in self.variants if v["song"] in keep_songs]

    def _load_data(self):
        """Load all feature and label arrays into memory."""
        for idx, variant in enumerate(self.variants):
            self._features_cache[idx] = np.load(variant["features"])
            self._labels_cache[idx] = np.load(variant["labels"])

    def _build_sequence_index(self) -> list[tuple[int, int]]:
        """Build list of (variant_idx, start_frame) for all sequences."""
        sequences = []
        step = max(1, int(self.seq_len * (1 - self.overlap)))

        for idx in range(len(self.variants)):
            n_frames = len(self._features_cache[idx])
            max_start = n_frames - self.seq_len
            start = 0
            while start <= max_start:
                sequences.append((idx, start))
                start += step

        return sequences

    def _build_input_features(
        self, audio_features: np.ndarray, labels: np.ndarray
    ) -> np.ndarray:
        """Build 151-dim input by appending BPM and section feedback.

        Args:
            audio_features: (seq_len, 143)
            labels: (seq_len, 64) — used to extract BPM and section

        Returns:
            (seq_len, 151) input features
        """
        seq_len = audio_features.shape[0]
        input_features = np.zeros((seq_len, self.input_dim), dtype=np.float32)

        # Audio features [0:143]
        input_features[:, :self.audio_features_dim] = audio_features

        # BPM feedback [143] — normalized BPM from labels
        input_features[:, self.audio_features_dim] = labels[:, Slice.BPM + 2]

        # Beat phase feedback [144]
        input_features[:, self.audio_features_dim + 1] = labels[:, Slice.BPM]

        # Section feedback [145:151] — shift by 1 frame (use previous frame's section)
        section_data = labels[:, Slice.SECTION:Slice.SECTION + NUM_SECTIONS]
        input_features[1:, self.audio_features_dim + 2:self.input_dim] = section_data[:-1]
        input_features[0, self.audio_features_dim + 2:self.input_dim] = section_data[0]

        return input_features

    def __len__(self) -> int:
        return len(self.sequences)

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        """Get a training sample.

        Returns:
            features: (seq_len, 1, 151) — extra dim for Conv1d compatibility
            labels: (seq_len, 64) — protocol vectors
        """
        variant_idx, start = self.sequences[idx]
        audio_features = self._features_cache[variant_idx][start:start + self.seq_len].copy()
        labels = self._labels_cache[variant_idx][start:start + self.seq_len].copy()

        # Augmentation
        if self.do_augment:
            if self.augment_cfg.get("spatial_mirror") and np.random.random() < 0.5:
                from data.augment import augment_spatial_mirror
                audio_features, labels = augment_spatial_mirror(audio_features, labels)

            intensity_range = self.augment_cfg.get("intensity_scale")
            if intensity_range and np.random.random() < 0.3:
                from data.augment import augment_intensity_scale
                audio_features, labels = augment_intensity_scale(
                    audio_features, labels, tuple(intensity_range)
                )

            gain_range = self.augment_cfg.get("gain_jitter")
            if gain_range:
                from data.augment import augment_gain_jitter
                audio_features = augment_gain_jitter(audio_features, tuple(gain_range))

            noise_level = self.augment_cfg.get("noise_level", 0.0)
            if noise_level > 0:
                from data.augment import augment_feature_noise
                audio_features = augment_feature_noise(audio_features, noise_level)

        # Build 151-dim input
        input_features = self._build_input_features(audio_features, labels)

        # Add time dimension for Conv1d: (seq_len, 1, 151)
        input_features = input_features[:, np.newaxis, :]

        return (
            torch.from_numpy(input_features).float(),
            torch.from_numpy(labels).float(),
        )


class SilenceDataset(Dataset):
    """Synthetic silence/noise dataset for gate head training."""

    def __init__(self, n_samples: int, config: dict):
        self.n_samples = n_samples
        self.seq_len = config["model"].get("seq_len", 64)
        self.input_dim = config["model"]["input_channels"]

    def __len__(self) -> int:
        return self.n_samples

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        noise_level = np.random.uniform(0.0, 0.05)
        features = np.random.randn(self.seq_len, 1, self.input_dim).astype(np.float32) * noise_level

        labels = np.zeros((self.seq_len, PROTOCOL_DIM), dtype=np.float32)
        # gate = 0 for silence
        labels[:, Slice.DYNAMICS + 3] = 0.0

        return (
            torch.from_numpy(features).float(),
            torch.from_numpy(labels).float(),
        )
