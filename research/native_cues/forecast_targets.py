"""Future intervals on native presentation times; no video-state model inputs."""
import numpy as np

NAMES = ['brighten_100_300ms', 'dim_100_300ms', 'brighten_300_1000ms', 'dim_300_1000ms']
HORIZONS = [(0.1, 0.3), (0.3, 1.0)]


def future_targets(audio_time, source_time, edge, edge_mask, pair_valid):
    q = np.asarray(audio_time, np.float64); t = np.asarray(source_time, np.float64)
    edge = np.asarray(edge); edge_mask = np.asarray(edge_mask); pair_valid = np.asarray(pair_valid, bool)
    assert edge.shape == edge_mask.shape == (len(t), 2)
    assert pair_valid.shape == (len(t),) and np.all(np.diff(t)>0)
    y = np.zeros((len(q), 4), np.float32); mask = np.zeros_like(y)
    for i, now in enumerate(q):
        for h, (lo, hi) in enumerate(HORIZONS):
            # Small arithmetic tolerance makes nominal exact boundaries stable.
            a = np.searchsorted(t, now+lo+1e-9, side='right')
            b = np.searchsorted(t, now+hi+1e-9, side='right')
            cover = np.searchsorted(t, now+hi-1e-9, side='left')
            supported = a>=1 and cover<len(t) and b>a and pair_valid[a:cover+1].all()
            for sign in range(2):
                positive = bool(edge[a:b, sign].any())
                y[i, h*2+sign] = positive
                mask[i, h*2+sign] = supported and (positive or bool(edge_mask[a:b, sign].all()))
    return y, mask
