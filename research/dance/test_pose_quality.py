import tempfile
import unittest
from pathlib import Path
from process import copy_exclusive
from process_rtmw import map_pose


class PoseQualityTests(unittest.TestCase):
    def test_exclusive_copy_preserves_existing_outputs(self):
        with tempfile.TemporaryDirectory() as folder:
            source,target=Path(folder)/'source',Path(folder)/'target'
            source.write_bytes(b'original')
            copy_exclusive(source,target)
            self.assertEqual(target.read_bytes(),b'original')
            source.write_bytes(b'different')
            with self.assertRaises(FileExistsError):copy_exclusive(source,target)
            self.assertEqual(target.read_bytes(),b'original')

    def test_exact_body_and_hand_correspondences(self):
        points=[[i*2.,i*3.] for i in range(133)]
        result=map_pose(points,[.8]*133,1000,500)
        self.assertEqual(len(result),33)
        # Independent named correspondences: COCO left/right wrists, left hip,
        # left ankle, left/right pinky fingertips.
        for index,expected in [(15,[.018,.054]),(16,[.02,.06]),(23,[.022,.066]),
                               (27,[.03,.09]),(17,[.222,.666]),(18,[.264,.792])]:
            self.assertEqual(result[index][:2],expected)
        self.assertTrue(all(result[i][3]==0 for i in (1,3,4,6,9,10)))
        self.assertTrue(all(p[2]==0 for p in result),'2D adapter must not invent depth')

    def test_low_scores_and_out_of_frame_coordinates_remain_observable(self):
        points=[[.5,.5] for _ in range(133)];scores=[.8]*133
        points[9]=[-30,200];scores[9]=.1
        result=map_pose(points,scores,100,100)
        self.assertEqual(result[15],[-.3,2.,0.,.1],'Do not repair or inflate uncertain predictions')

if __name__=='__main__':unittest.main()
