import unittest
from tracking import PrimaryTracker, usable_pose


def body(x, visibility=0.95):
    points = [[x, 0.5, 0, visibility] for _ in range(33)]
    for i, dx, y in [(11, -.05, .3), (12, .05, .3), (23, -.05, .55), (24, .05, .55)]:
        points[i] = [x + dx, y, 0, visibility]
    return points


class TrackingTests(unittest.TestCase):
    def test_central_then_identity_even_when_detection_order_changes(self):
        tracker = PrimaryTracker()
        self.assertEqual(tracker.select([body(.15), body(.50)], 0)[0], 1)
        self.assertEqual(tracker.select([body(.49), body(.51)], .04)[0], None)  # ambiguous crossing
        self.assertEqual(tracker.select([body(.58), body(.15)], .08)[0], 0)

    def test_no_immediate_switch_to_other_dancer(self):
        tracker = PrimaryTracker()
        tracker.select([body(.5)], 0)
        self.assertEqual(tracker.select([body(.9)], .1)[2], 'gap')
        self.assertEqual(tracker.select([body(.52)], .2)[1:3], (1, 'locked'))

    def test_reselect_after_sustained_loss(self):
        tracker = PrimaryTracker()
        tracker.select([body(.5)], 0)
        self.assertEqual(tracker.select([], .2)[2], 'gap')
        self.assertEqual(tracker.select([body(.9)], 1.2)[1:3], (2, 'selected'))

    def test_low_confidence_is_missing_not_stillness(self):
        self.assertEqual(PrimaryTracker().select([body(.5, .1)], 0)[0], None)

    def test_cut_reset_allows_new_identity(self):
        tracker = PrimaryTracker()
        tracker.select([body(.2)], 0)
        tracker.reset()
        self.assertEqual(tracker.select([body(.8)], .1)[1:3], (2, 'selected'))

    def test_solo_rejects_multiple_even_if_one_has_low_confidence(self):
        tracker = PrimaryTracker(solo=True)
        self.assertEqual(tracker.select([body(.5), body(.8, .1)], 0)[2], 'multiple_bodies')
        self.assertEqual(tracker.select([body(.5)], .1)[2], 'selected')

    def test_solo_never_reacquires_after_long_gap(self):
        tracker = PrimaryTracker(solo=True)
        tracker.select([body(.5)], 0)
        self.assertEqual(tracker.select([], .1)[2], 'gap')
        self.assertEqual(tracker.select([body(.5)], 1.1)[2], 'review_required')
        self.assertEqual(tracker.select([body(.5)], 1.2)[0], None)

    def test_solo_cut_stops_association(self):
        tracker = PrimaryTracker(solo=True)
        tracker.select([body(.5)], 0)
        tracker.scene_cut()
        self.assertEqual(tracker.select([body(.5)], .04)[2], 'review_required')

    def test_pose_coverage_requires_visible_in_frame_limbs(self):
        points = body(.5)
        self.assertTrue(usable_pose(points))
        points[15][3] = .2
        self.assertFalse(usable_pose(points))
        points[15][3], points[15][0] = .9, 1.1
        self.assertFalse(usable_pose(points))


if __name__ == '__main__':
    unittest.main()
