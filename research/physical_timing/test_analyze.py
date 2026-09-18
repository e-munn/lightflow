import unittest
from analyze import analyze
class TimingTests(unittest.TestCase):
 def data(self):return dict(provenance='synthetic',audio=[[1,1],[3,3],[5,5]],light=[[1.08,1.09],[3.1,3.11],[5.07,5.08]])
 def test_delay_intervals(self):
  r=analyze(self.data());self.assertEqual(len(r['pairs']),3);self.assertAlmostEqual(r['raw']['median_midpoint_ms'],85);self.assertFalse(r['physical_measurement_declared']);self.assertIsNone(r['calibrated'])
 def test_calibration_sign(self):
  d=self.data();d['calibration']=dict(light_minus_audio_clock_offset_s=.02,offset_uncertainty_s=.005,method='fixture');r=analyze(d);self.assertAlmostEqual(r['calibrated']['median_midpoint_ms'],65);self.assertAlmostEqual(r['calibrated']['median_interval_width_ms'],20);self.assertFalse(r['physical_measurement_declared'])
 def test_ambiguity_not_best_match(self):
  d=self.data();d['light'].insert(1,[1.2,1.21]);r=analyze(d);self.assertEqual(r['ambiguous_audio'],[0]);self.assertEqual(r['unpaired_audio'],[0]);self.assertEqual(len(r['pairs']),2)
 def test_missing_and_extra(self):
  d=self.data();d['light']=[[1.08,1.09],[7,7.01]];r=analyze(d);self.assertEqual(r['unpaired_audio'],[1,2]);self.assertEqual(r['unpaired_light'],[1])
 def test_negative_preserved(self):
  d=self.data();d['light']=[[.8,.81]];r=analyze(d);self.assertLess(r['raw']['median_midpoint_ms'],0)
 def test_large_known_clock_offset(self):
  d=self.data();d['light']=[[a+2,b+2] for a,b in d['light']];d['calibration']=dict(light_minus_audio_clock_offset_s=2,offset_uncertainty_s=0,method='known test shift');r=analyze(d);self.assertEqual(len(r['pairs']),3);self.assertAlmostEqual(r['calibrated']['median_midpoint_ms'],85)
 def test_invalid(self):
  for v in [[[2,1]],[[float('nan'),1]],[[2,2],[1,1]]]:
   with self.subTest(v=v):d=self.data();d['audio']=v;self.assertRaises(ValueError,analyze,d)
if __name__=='__main__':unittest.main()
