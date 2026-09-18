"""Small causal tempo/phase comparator, independent of video or future audio."""
import numpy as np


def rhythm_features(attack, block=10, audio_fps=50, history_seconds=16):
    """At each trailing block end, estimate repetition from received onsets only.

    This is a deliberately simple baseline, not a claim of robust beat tracking.
    Tempo search is 60–200 BPM. Phase comes from the strongest onset phase bin.
    Outputs: normalized tempo, periodicity, periodicity-weighted phase harmonics.
    """
    attack = np.asarray(attack, dtype=np.float64)
    out = np.zeros((len(attack)//block, 6), dtype=np.float32)
    lags = np.arange(int(audio_fps*60/200), int(audio_fps*60/60)+1)
    for row, end in enumerate(range(block, len(attack)+1, block)):
        raw = attack[max(0, end-int(audio_fps*history_seconds)):end]
        if len(raw) < 2*lags[-1] or np.max(raw) < 1e-5:
            continue
        centered = raw-raw.mean()
        size = 1 << (2*len(raw)-1).bit_length()
        autocorrelation = np.fft.irfft(abs(np.fft.rfft(centered, size))**2, size)[:len(raw)]
        squares = np.r_[0, np.cumsum(centered**2)]
        denom = np.sqrt(squares[len(raw)-lags]*(squares[-1]-squares[lags]))
        score = autocorrelation[lags]/np.maximum(denom, 1e-12)
        # Equal-strength multiples are common; use the shortest near-best period.
        best = int(np.flatnonzero(score >= score.max()-.01)[0]);period = int(lags[best])
        strength = float(np.clip(score[best], 0, 1))
        # No look-ahead: fold only already received onset energy at this period.
        phase_bin = int(np.argmax(np.bincount(np.arange(len(raw))%period, weights=raw, minlength=period)))
        phase = 2*np.pi*((len(raw)-1-phase_bin)%period)/period
        out[row] = [audio_fps/period/4, strength,
                    strength*np.sin(phase), strength*np.cos(phase),
                    strength*np.sin(2*phase), strength*np.cos(2*phase)]
    return out
