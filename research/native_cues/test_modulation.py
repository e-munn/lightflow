import unittest
import numpy as np
from modulation import Modulation,render_trace

class ModulationTests(unittest.TestCase):
    prior=np.array([.12,.09,.27,.19])
    def test_prior_neutrality(self):
        p=Modulation(self.prior);f=np.array([.4,.3,.2,-.2,.7,.1,.1,.5])
        out=p.step(0,f,self.prior)
        np.testing.assert_allclose(out,[.412,.355,.3,.2,-.2,.1,1,1],atol=1e-7)
    def test_silence_and_mono(self):
        p=Modulation(self.prior)
        for i in range(100):out=p.step(i*.02,np.zeros(8),[1,0,1,0])
        self.assertEqual(out[0],0);self.assertEqual(out[2],0)
        self.assertEqual(out[6],1.25)
    def test_transient_is_immediate_and_bounded(self):
        p=Modulation(self.prior);f=np.zeros(8)
        p.step(0,f,[0,1,0,1]);f[0]=.8;f[6]=.2
        out=p.step(.02,f,[0,1,0,1])
        self.assertGreaterEqual(out[0],.75*(.8+.12*.2)-1e-7)
        self.assertLessEqual(out[0],1)
    def test_availability_and_warmup(self):
        t=np.arange(1,1.121,.02);scope=np.zeros((len(t),8));scope[:,0]=.5
        pt=np.array([1.,1.1]);pred=np.array([[1,0,1,0],[0,1,0,1]])
        out,ix=render_trace(t,scope,pt,pred,self.prior,1.,.02)
        self.assertEqual(ix[0],-1);self.assertEqual(ix[1],0)
        self.assertEqual(ix[-1],1)
        self.assertEqual(out[0,6],1)
    def test_prefix_independence(self):
        t=np.arange(100)*.02;f=np.zeros((100,8));f[:,0]=.5
        pt=np.arange(20)*.1;p=np.tile(self.prior,(20,1));other=p.copy();other[10:]=1-other[10:]
        a,_=render_trace(t,f,pt,p,self.prior,0)
        b,_=render_trace(t,f,pt,other,self.prior,0)
        np.testing.assert_array_equal(a[:51],b[:51])

if __name__=='__main__':unittest.main()
