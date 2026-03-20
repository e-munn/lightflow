"""Real-time audio capture and spectral analysis from mic input."""

import numpy as np
import sounddevice as sd
import librosa


class AudioAnalyzer:
    """Captures mic audio and extracts spectral features in real-time."""

    def __init__(self, sample_rate=44100, block_size=2048, hop_size=512, n_mfcc=13):
        self.sample_rate = sample_rate
        self.block_size = block_size
        self.hop_size = hop_size
        self.n_mfcc = n_mfcc
        self.n_mels = 128

        self._buffer = np.zeros(block_size, dtype=np.float32)
        self._callback = None
        self._stream = None

        # Pre-compute mel filterbank
        self._mel_basis = librosa.filters.mel(
            sr=sample_rate, n_fft=block_size, n_mels=self.n_mels
        )

    @property
    def features(self):
        """Extract all spectral features from current buffer."""
        y = self._buffer.copy()

        # FFT
        S = np.abs(np.fft.rfft(y * np.hanning(len(y))))
        S_power = S ** 2

        # Mel spectrogram
        mel = self._mel_basis @ S_power[:self._mel_basis.shape[1]]
        mel_db = librosa.power_to_db(mel, ref=np.max)

        # MFCCs
        mfcc = librosa.feature.mfcc(
            S=librosa.power_to_db(mel.reshape(-1, 1)),
            n_mfcc=self.n_mfcc,
            sr=self.sample_rate,
        ).flatten()

        # Spectral descriptors
        freqs = np.fft.rfftfreq(len(y), 1.0 / self.sample_rate)
        centroid = float(np.sum(freqs * S) / (np.sum(S) + 1e-10))
        rolloff = float(freqs[np.searchsorted(np.cumsum(S) / (np.sum(S) + 1e-10), 0.85)])
        rms = float(np.sqrt(np.mean(y ** 2)))

        # Spectral flux (would need previous frame - simplified)
        flatness = float(np.exp(np.mean(np.log(S + 1e-10))) / (np.mean(S) + 1e-10))

        # Band energies (split spectrum into regions)
        n_bins = len(S)
        bands = {
            "sub_bass": float(np.mean(S_power[:int(n_bins * 60 / 22050)])),       # 0-60 Hz
            "bass": float(np.mean(S_power[int(n_bins * 60 / 22050):int(n_bins * 250 / 22050)])),  # 60-250 Hz
            "low_mid": float(np.mean(S_power[int(n_bins * 250 / 22050):int(n_bins * 500 / 22050)])),
            "mid": float(np.mean(S_power[int(n_bins * 500 / 22050):int(n_bins * 2000 / 22050)])),
            "high_mid": float(np.mean(S_power[int(n_bins * 2000 / 22050):int(n_bins * 4000 / 22050)])),
            "high": float(np.mean(S_power[int(n_bins * 4000 / 22050):])),
        }

        return {
            "mfcc": mfcc,
            "mel_db": mel_db,
            "centroid": centroid,
            "rolloff": rolloff,
            "rms": rms,
            "flatness": flatness,
            "bands": bands,
        }

    def _audio_callback(self, indata, frames, time_info, status):
        self._buffer = indata[:, 0].copy()
        if self._callback:
            self._callback(self.features)

    def start(self, callback=None, device=None):
        """Start capturing audio. Callback receives features dict each block."""
        self._callback = callback
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            blocksize=self.block_size,
            channels=1,
            dtype="float32",
            callback=self._audio_callback,
            device=device,
        )
        self._stream.start()

    def stop(self):
        if self._stream:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    @staticmethod
    def list_devices():
        return sd.query_devices()
