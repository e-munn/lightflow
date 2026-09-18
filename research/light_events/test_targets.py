"""Meaningful invariants for uncertain event supervision and causal controls."""
import numpy as np
from targets import targets,context_features

def main():
    n=100;y=np.zeros((n,15),np.float32);y[40:,8:12]=.6
    weights=np.ones_like(y);matrix=np.tile([[1.,0,0],[0,1.,0]],(n,1,1));quality=np.zeros((n,4,3))
    label,mask,meta=targets(y,weights,matrix,quality)
    assert meta['rise'].tolist()==[40]
    assert label[35,0]==1 and mask[35,0]==1
    assert label[10,2]==1 and mask[10,2]==1
    weights[42]=0
    _,mask,_=targets(y,weights,matrix,quality)
    assert mask[35,0]==0, 'A known positive cannot bypass missing-window requirements'
    quality[:,:,0]=.2
    _,mask,_=targets(y,np.ones_like(y),matrix,quality)
    assert mask[:,2].sum()==0, 'Clipped pixels cannot establish a hold'
    matrix[40:,0,2]=5
    _,_,meta=targets(y,np.ones_like(y),matrix)
    assert not len(meta['rise']), 'Registration correction is not a light rise'
    x=np.random.default_rng(7).normal(size=(200,48)).astype('float32');a=context_features(x)
    x[100:]*=10
    assert np.array_equal(a[:100],context_features(x)[:100]), 'Relative context cannot read future audio'
    from train import triggers,event_score
    assert triggers(np.array([.1,.8,.9,.9,.9,.9,.1,.9]),.7).tolist()==[1,7]
    t=np.arange(300)/10;p=np.zeros((300,2));p[260,0]=.9
    clip={'t':t,'mask':np.ones((300,2)),'events':[np.array([26.5,26.7]),np.array([])],'pred':{'model':p}}
    result=event_score([clip],'model',0,.5)
    assert result['matched']==1 and result['events']==2 and result['recall']==.5
    assert event_score([clip],'model',0,None)['triggers']==0
    print('PASS: labels, missingness, clipping, registration, causal context, trigger rearming, one-to-one matching, abstention')

if __name__=='__main__':main()
