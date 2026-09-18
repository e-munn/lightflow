import unittest
import numpy as np
from targets import descriptors


class NativeTargetTests(unittest.TestCase):
    def make(self,mean,time=None,valid=None):
        time=np.arange(len(mean))/30 if time is None else time
        valid=np.ones(len(mean),bool) if valid is None else valid
        return descriptors(time,np.repeat(np.asarray(mean)[:,None],4,1),valid)

    def test_single_frame_flash(self):
        e=np.full(90,.1);e[30]=.8;r=self.make(e)
        self.assertEqual(np.flatnonzero(r['edge'][:,0]).tolist(),[30])
        self.assertEqual(np.flatnonzero(r['edge'][:,1]).tolist(),[31])

    def test_long_step(self):
        e=np.full(90,.1);e[30:60]=.8;r=self.make(e)
        self.assertEqual(np.flatnonzero(r['edge'][:,0]).tolist(),[30])
        self.assertEqual(np.flatnonzero(r['edge'][:,1]).tolist(),[60])

    def test_ramp_is_slow_change_not_flash(self):
        e=np.r_[np.full(30,.1),np.linspace(.1,.8,31),np.full(29,.8)];r=self.make(e)
        self.assertEqual(int(r['edge'].sum()),0)
        self.assertTrue(r['contrast_1s_valid'][60])
        self.assertAlmostEqual(float(r['contrast_1s'][60]),.7,places=5)

    def test_repetitive_strobes_are_not_merged(self):
        e=np.full(90,.1);e[np.arange(12,60,3)]=.8;r=self.make(e)
        self.assertEqual(int(r['edge'][:,0].sum()),16)
        self.assertEqual(int(r['edge'][:,1].sum()),16)

    def test_gap_and_unknown_geometry_do_not_create_edges(self):
        e=np.full(90,.1);e[30:]=.8;t=np.arange(90)/30;t[30:]+=.1
        r=self.make(e,time=t);self.assertFalse(r['pair_valid'][30]);self.assertEqual(int(r['edge'].sum()),0)
        valid=np.ones(90,bool);valid[29]=False;r=self.make(e,valid=valid)
        self.assertFalse(r['pair_valid'][30]);self.assertEqual(int(r['edge'].sum()),0)

    def test_prefix_and_ambiguous_edge(self):
        e=np.full(90,.1);e[30:]=.28;r=self.make(e)
        self.assertEqual(r['edge_mask'][30,0],0)
        e[60:]=.9;b=self.make(e)
        for key in r:np.testing.assert_array_equal(r[key][:60],b[key][:60])


if __name__=='__main__':unittest.main()
