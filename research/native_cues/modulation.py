"""Explicit offline policy over learned probabilities and immediate scope data."""
import numpy as np

OUTPUT_NAMES=['intensity','hue','spread','texture','balance','accent','gain','spread_gain']


class Modulation:
    def __init__(self,prior):
        self.prior=np.asarray(prior,dtype=float).copy()
        assert self.prior.shape==(4,) and np.isfinite(self.prior).all()
        self.state=self.prior.copy();self.previous_time=None

    def step(self,now,scope,probability=None):
        f=np.asarray(scope,dtype=float)
        p=self.prior if probability is None else np.asarray(probability,dtype=float)
        assert f.shape==(8,) and p.shape==(4,) and np.isfinite(f).all() and np.isfinite(p).all()
        assert ((p>=0)&(p<=1)).all()
        dt=.02 if self.previous_time is None else now-self.previous_time
        assert dt>0
        self.previous_time=now
        alpha=-np.expm1(-dt/np.array([.15,.15,.6,.6]))
        self.state+=alpha*(p-self.state)
        near=self.state[0]-self.state[1]-(self.prior[0]-self.prior[1])
        far=self.state[2]-self.state[3]-(self.prior[2]-self.prior[3])
        gain=float(np.clip(1+.6*near+.4*far,.75,1.25))
        spread_gain=float(np.clip(1+.5*(self.state[2:].mean()-self.prior[2:].mean()),.8,1.2))
        amplitude,spread,texture,balance,bass,air,attack,_=f
        base=np.clip(amplitude+.12*attack,0,1)
        return np.array([np.clip(base*gain,0,1),np.clip(.62-.4*bass+.15*air,0,1),
            np.clip(spread*spread_gain,0,1),texture,balance,attack,gain,spread_gain],np.float32)


def render_trace(audio_time,scope,prediction_time,probability,prior,ready_after,delay=.02):
    t=np.asarray(audio_time);pt=np.asarray(prediction_time)
    assert np.all(np.diff(t)>0) and np.all(np.diff(pt)>0)
    indices=np.searchsorted(pt+delay,t+1e-9,side='right')-1
    output=[];used=np.full(len(t),-1,np.int32);policy=Modulation(prior)
    for i,now in enumerate(t):
        k=indices[i]
        p=None
        if k>=0 and pt[k]>=ready_after-1e-9:
            assert pt[k]+delay<=now+1e-8
            p=probability[k];used[i]=k
        output.append(policy.step(float(now),scope[i],p))
    return np.array(output),used
