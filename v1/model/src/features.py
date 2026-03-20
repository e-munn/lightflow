"""Audio feature extraction for the LightFlow model.

Extracts mel spectrograms, onset strength, chroma, and energy features
from audio windows for input to the lighting prediction model.
"""

import numpy as np
import librosa


class AudioFeatureExtractor:
    """Extracts audio features from raw waveforms."""

    def __init__(self, config: dict):
        audio_cfg = config["audio"]
        self.sample_rate = audio_cfg["sample_rate"]
        self.hop_length = audio_cfg["hop_length"]
        self.n_fft = audio_cfg["n_fft"]
        self.n_mels = audio_cfg["n_mels"]
        self.window_samples = int(audio_cfg["window_seconds"] * self.sample_rate)

    def extract(self, y: np.ndarray) -> dict[str, np.ndarray]:
        """Extract all features from an audio segment.

        Args:
            y: Audio waveform, shape (samples,)

        Returns:
            Dictionary of feature arrays, each shape (n_frames, feature_dim)
        """
        features = {}

        # Mel spectrogram: (n_mels, n_frames)
        mel = librosa.feature.melspectrogram(
            y=y, sr=self.sample_rate,
            n_fft=self.n_fft, hop_length=self.hop_length,
            n_mels=self.n_mels,
        )
        features["mel"] = librosa.power_to_db(mel, ref=np.max).T  # (n_frames, n_mels)

        # Onset strength: (n_frames,)
        onset = librosa.onset.onset_strength(
            y=y, sr=self.sample_rate, hop_length=self.hop_length,
        )
        features["onset"] = onset[:, np.newaxis]  # (n_frames, 1)

        # Chroma: (12, n_frames)
        chroma = librosa.feature.chroma_stft(
            y=y, sr=self.sample_rate,
            n_fft=self.n_fft, hop_length=self.hop_length,
        )
        features["chroma"] = chroma.T  # (n_frames, 12)

        # RMS energy: (1, n_frames)
        rms = librosa.feature.rms(y=y, hop_length=self.hop_length)
        features["rms"] = rms.T  # (n_frames, 1)

        # Spectral centroid: (1, n_frames)
        centroid = librosa.feature.spectral_centroid(
            y=y, sr=self.sample_rate, hop_length=self.hop_length,
        )
        features["centroid"] = (centroid / self.sample_rate * 2).T  # Normalize to ~0-1

        return features

    def extract_fast(self, y: np.ndarray) -> dict[str, np.ndarray]:
        """Extract features with shared STFT — ~2x faster than extract().

        Computes the STFT once and reuses it for all feature derivations.
        Produces identical output to extract().
        """
        features = {}

        # Single STFT computation
        S = librosa.stft(y, n_fft=self.n_fft, hop_length=self.hop_length)
        S_power = np.abs(S) ** 2

        # Mel from precomputed power spectrum
        mel_basis = librosa.filters.mel(
            sr=self.sample_rate, n_fft=self.n_fft, n_mels=self.n_mels
        )
        mel = mel_basis @ S_power
        features["mel"] = librosa.power_to_db(mel, ref=np.max).T

        # Onset from precomputed mel
        mel_db = librosa.power_to_db(mel, ref=np.max)
        onset = librosa.onset.onset_strength(
            S=mel_db, sr=self.sample_rate, hop_length=self.hop_length,
        )
        features["onset"] = onset[:, np.newaxis]

        # Chroma from precomputed power spectrum
        chroma = librosa.feature.chroma_stft(
            S=S_power, sr=self.sample_rate,
            n_fft=self.n_fft, hop_length=self.hop_length,
        )
        features["chroma"] = chroma.T

        # RMS from precomputed STFT magnitude
        rms = librosa.feature.rms(S=np.abs(S), frame_length=self.n_fft,
                                   hop_length=self.hop_length)
        features["rms"] = rms.T

        # Spectral centroid from precomputed power spectrum
        centroid = librosa.feature.spectral_centroid(
            S=S_power, sr=self.sample_rate, hop_length=self.hop_length,
        )
        features["centroid"] = (centroid / self.sample_rate * 2).T

        return features

    def concat_features(self, features: dict[str, np.ndarray]) -> np.ndarray:
        """Concatenate all features into a single array.

        Returns:
            Array of shape (n_frames, total_feature_dim)
        """
        # Align frame counts (take minimum)
        min_frames = min(f.shape[0] for f in features.values())
        aligned = {k: v[:min_frames] for k, v in features.items()}
        return np.concatenate(list(aligned.values()), axis=1)
