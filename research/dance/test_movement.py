import copy
import math
import unittest
from analyze import movement


def frame(t, shift=0, scale=1, arm=0):
    points = [[.5, .5, 0, 1] for _ in range(33)]
    for a, b, y, spread in [(11, 12, .3, .08), (13, 14, .4, .12), (15, 16, .5, .16),
                             (23, 24, .6, .06), (25, 26, .75, .06), (27, 28, .9, .08)]:
        points[a] = [.5-spread, y, 0, 1]
        points[b] = [.5+spread, y, 0, 1]
    points[15][0] += arm
    for p in points:
        p[0] = .5 + (p[0] - .5) * scale + shift
        p[1] = .5 + (p[1] - .5) * scale
    return {'t': t, 'poses': [points], 'primary': 0, 'track': 1, 'cut': False}


class MovementTests(unittest.TestCase):
    def test_stationary_hold_is_not_darkness(self):
        result = movement([frame(i/30) for i in range(60)], 16/9)
        self.assertEqual(result['frames'][30]['speed'], 0)
        self.assertTrue(result['frames'][30]['holding'])
        self.assertGreater(result['frames'][30]['punctuation'], 0)
        self.assertEqual([c['kind'] for c in result['candidates']], ['hold'])

    def test_translation_is_separate_from_relative_movement(self):
        result = movement([frame(i/30, shift=i*.003) for i in range(60)], 16/9)
        middle = result['frames'][30]
        self.assertLess(middle['speed'], 1e-12)
        self.assertGreater(middle['travel'], .2)
        self.assertFalse(middle['holding'])

    def test_constant_scale_and_position_invariance(self):
        a = movement([frame(i/30, arm=.04*math.sin(i/5)) for i in range(60)], 1)
        b = movement([frame(i/30, arm=.04*math.sin(i/5), scale=.6, shift=.1) for i in range(60)], 1)
        for x, y in zip(a['frames'][1:-1], b['frames'][1:-1]):
            self.assertAlmostEqual(x['speed'], y['speed'])
            self.assertAlmostEqual(x['extension'], y['extension'])

    def test_gaps_cuts_and_identity_changes_never_bridge(self):
        frames = [frame(i/30) for i in range(60)]
        frames[10]['primary'] = None
        frames[20]['cut'] = True
        frames[30]['poses'].append(copy.deepcopy(frames[30]['poses'][0]))
        frames[40]['poses'][0][15][3] = .2
        frames[50]['track'] = 2
        rows = movement(frames, 1)['frames']
        for index in [10, 20, 30, 40]:
            for i in [index-1, index, index+1]:
                self.assertIsNone(rows[i]['speed'])
                self.assertIsNone(rows[i]['flow'])
                self.assertFalse(rows[i]['holding'])
        self.assertIsNone(rows[50]['speed'])
        self.assertNotEqual(rows[9]['segment'], rows[11]['segment'])

    def test_unequal_frame_times_use_actual_elapsed_time(self):
        times = [0, .03, .07, .1, .14, .18, .21, .25]
        result = movement([frame(t, shift=t*.1) for t in times], 1)
        # Interior centered samples where the three-point mean stays linear.
        expected = .1 / result['parameters']['torsoScale']
        self.assertAlmostEqual(result['frames'][4]['travel'], expected, places=5)
        self.assertTrue(0 < result['parameters']['measuredFeatureLookaheadSeconds'] <= .21)

    def test_all_missing_stays_missing_and_nonfinite_rejected(self):
        frames = [frame(i/30) for i in range(10)]
        for f in frames:
            f['primary'] = None
        result = movement(frames, 1)
        self.assertEqual(result['coverage'], 0)
        self.assertEqual(result['candidates'], [])
        self.assertTrue(all(r['punctuation'] is None for r in result['frames']))
        with self.assertRaises(ValueError):
            movement([frame(1), frame(1)], 1)
        with self.assertRaises(ValueError):
            movement([frame(0)], float('nan'))


if __name__ == '__main__':
    unittest.main()
