"""Candidate observed edges and a separately named slow contrast descriptor."""
import numpy as np


def descriptors(time,energy,geometry_valid):
    time=np.asarray(time,np.float64);energy=np.asarray(energy,np.float64)
    valid=np.asarray(geometry_valid,bool)
    assert energy.shape==(len(time),4) and valid.shape==(len(time),)
    assert np.all(np.diff(time)>0) and np.isfinite(energy).all()
    mean=energy.mean(1)
    pair=np.zeros(len(time),bool)
    pair[1:]=valid[1:]&valid[:-1]&(np.diff(time)<=.0500001)
    delta=np.r_[0,np.diff(mean)]
    edge=np.zeros((len(time),2),np.float32)
    mask=np.repeat(pair[:,None],2,1).astype(np.float32)
    for h,sign in enumerate([1,-1]):
        strength=sign*delta
        edge[:,h]=pair&(strength>=.25)
        mask[(strength>=.12)&(strength<.25),h]=0
    trend=np.zeros(len(time),np.float32);trend_valid=np.zeros(len(time),bool)
    # One-second contrast, explicitly NOT an instantaneous edge/hold label.
    for i,now in enumerate(time):
        j=np.searchsorted(time,now-1,side='right')-1
        if j<0 or now-time[j]>1.05:continue
        if valid[j:i+1].all() and pair[j+1:i+1].all():
            trend[i]=mean[i]-mean[j];trend_valid[i]=True
    return {'mean_energy':mean.astype(np.float32),'adjacent_delta':delta.astype(np.float32),
            'edge':edge,'edge_mask':mask,'pair_valid':pair,'contrast_1s':trend,'contrast_1s_valid':trend_valid}
