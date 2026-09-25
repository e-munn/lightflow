import unittest
import numpy as np
from audio_features import extract, fit_ridge, predict, brightness, HOP
from train_audio import sample_targets, metric


class AudioTests(unittest.TestCase):
    def test_future_audio_cannot_change_prefix(self):
        rng=np.random.default_rng(42);a=rng.normal(0,.1,16000*3);b=a.copy();b[16000:]=rng.normal(0,.6,len(b)-16000)
        x,t,_=extract(a);z,_,_=extract(b)
        np.testing.assert_array_equal(x[t<=1],z[t<=1])
        self.assertGreater(abs(x[t>1]-z[t>1]).max(),.1)

    def test_silence_and_short_audio_are_finite(self):
        x,t,rms=extract(np.zeros(HOP*80))
        self.assertEqual(x.shape,(80,96));self.assertTrue(np.isfinite(x).all());self.assertEqual(float(abs(x).max()),0)
        self.assertEqual(float(rms.max()),0);self.assertEqual(t[-1],1.6)
        self.assertEqual(extract(np.zeros(100))[0].shape,(0,96))

    def test_missing_teacher_is_not_darkness(self):
        frames=[dict(t=i*.02,speed=1,armSpeed=1,legSpeed=2,travel=0,extension=.5,deceleration=2,holding=False) for i in range(6)]
        frames[2]['speed']=None;frames[2]['armSpeed']=None
        y=sample_targets(frames,np.arange(6)*.02)
        self.assertTrue(np.isnan(y[2]).all());self.assertTrue(np.isfinite(y[3]).all())

    def test_regression_handles_constant_features_and_bounds(self):
        x=np.c_[np.linspace(-1,1,100),np.ones(100)];y=((x[:,0]+1)/2)[:,None]
        m=fit_ridge(x,y,.01);p=predict(m,x)
        self.assertLess(metric(y[:,0],p[:,0])['mae'],.01)
        self.assertTrue(np.isfinite(predict(m,x*100)).all())
        self.assertTrue(((p>=0)&(p<=1)).all())

    def test_held_extension_retains_light(self):
        y=np.array([0,0,0,.8,0,1])
        self.assertAlmostEqual(float(brightness(y)),.46)


if __name__=='__main__':unittest.main()
