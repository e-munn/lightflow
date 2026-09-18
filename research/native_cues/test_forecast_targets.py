import unittest
import numpy as np
from forecast_targets import future_targets


class ForecastTests(unittest.TestCase):
    def source(self):
        t = np.arange(0, 3.01, .025)
        e = np.zeros((len(t), 2), np.float32)
        m = np.ones_like(e); pair = np.ones(len(t), bool); pair[0] = False
        return t, e, m, pair

    def test_lower_open_upper_closed(self):
        t, e, m, p = self.source()
        e[4, 0] = 1   # +100 ms: excluded from near window
        e[12, 1] = 1  # +300 ms: near, excluded from far
        e[40, 0] = 1  # +1000 ms: far upper boundary included
        y, mask = future_targets([0], t, e, m, p)
        np.testing.assert_array_equal(y, [[0, 1, 1, 0]])
        self.assertTrue(mask.all())

    def test_unknown_geometry_masks_positive_and_negative(self):
        t, e, m, p = self.source(); e[8, 0] = 1; p[10] = False
        y, mask = future_targets([0], t, e, m, p)
        self.assertEqual(y[0, 0], 1)
        np.testing.assert_array_equal(mask, [[0, 0, 1, 1]])

    def test_ambiguity_masks_only_unproven_sign(self):
        t, e, m, p = self.source(); m[8] = 0; e[9, 1] = 1
        y, mask = future_targets([0], t, e, m, p)
        np.testing.assert_array_equal(mask, [[0, 1, 1, 1]])

    def test_tail_needs_full_window(self):
        t, e, m, p = self.source()
        _, mask = future_targets([2.8], t, e, m, p)
        self.assertFalse(mask.any())

    def test_source_gap_cannot_be_negative(self):
        t, e, m, p = self.source(); keep = (t<.15)|(t>.25)
        t, e, m, p = t[keep], e[keep], m[keep], p[keep]
        p[1:] &= np.diff(t)<=.05
        _, mask = future_targets([0], t, e, m, p)
        np.testing.assert_array_equal(mask, [[0, 0, 1, 1]])

    def test_prefix_windows_unchanged_by_later_labels(self):
        t, e, m, p = self.source(); q = np.array([0, .5, 1.5])
        y, mask = future_targets(q, t, e, m, p)
        e[t>1.5] = 1
        other, other_mask = future_targets(q, t, e, m, p)
        np.testing.assert_array_equal(y[:2], other[:2])
        np.testing.assert_array_equal(mask, other_mask)


if __name__=='__main__': unittest.main()
