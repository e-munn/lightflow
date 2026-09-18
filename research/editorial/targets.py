"""Confidence-masked weak editorial labels; camera behavior is not light behavior."""
import numpy as np


def editorial_targets(times, boundaries, strong_threshold=.9):
    times = np.asarray(times, np.float64)
    def is_strong(b):
        return b['probability'] >= strong_threshold and b.get('editorial_status') != 'uncertain'
    strong = np.array(sorted(b['peak'] for b in boundaries if is_strong(b)))
    uncertain = np.array(sorted(b['peak'] for b in boundaries if not is_strong(b)))

    def count(cuts, low, high):
        return np.searchsorted(cuts, times+high, side='right')-np.searchsorted(cuts, times+low, side='right')

    labels, masks = [], []
    for low, high, invert in [(.2, 1., False), (1., 3., False), (0., 5., True)]:
        known = count(strong, low, high) > 0
        ambiguous = count(uncertain, low, high) > 0
        labels.append(~known if invert else known)
        # An uncertain event prevents a negative claim. A strong event is sufficient
        # to establish a cut / disprove a hold, regardless of other uncertain events.
        masks.append(known | ~ambiguous)
    return np.stack(labels, 1).astype(np.float32), np.stack(masks, 1).astype(np.float32)
