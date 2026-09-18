"""Weak relative stage-energy events with explicit unobservability masks."""
import numpy as np

NAMES=['rise_0.2_to_1s','release_0.2_to_1s','energy_hold_2s']

def suppress(indices,strength,radius=3):
    chosen=[]
    for i in indices[np.argsort(-strength[indices],kind='stable')]:
        if all(abs(int(i)-j)>radius for j in chosen):chosen.append(int(i))
    return np.array(sorted(chosen),dtype=int)

def targets(observations,weights,transform,quality=None):
    n=len(observations);energy=observations[:,8:12];mean=energy.mean(1)
    valid=weights[:,0]>0
    corners=np.array([[0,0,1],[640,0,1],[0,360,1],[640,360,1]])
    jumps=np.linalg.norm((transform[1:]-transform[:-1])@corners.T,axis=1).max(1)
    for i in np.flatnonzero(jumps>2)+1:valid[max(0,i-3):min(n,i+4)]=False
    support=np.zeros(n,bool);support[3:]=np.logical_and.reduce([valid[j:n-3+j] for j in range(4)])
    delta=np.zeros(n);delta[3:]=mean[3:]-mean[:-3]
    events=[];uncertain=[]
    for sign in [1,-1]:
        strength=sign*delta
        strong=suppress(np.flatnonzero(support&(strength>=.25)),strength)
        ambiguous=np.flatnonzero(support&(strength>=.12)&(strength<.25))
        # Neighbors of the same strong transition are not separate ambiguous events.
        if len(strong):ambiguous=ambiguous[np.min(abs(ambiguous[:,None]-strong[None,:]),axis=1)>3]
        events.append(strong);uncertain.append(ambiguous)
    hold_valid=valid.copy()
    if quality is not None:hold_valid&=(quality[:,:,0].max(1)<.05)
    hold_valid&=(energy.max(1)<.95)
    y=np.zeros((n,3),np.float32);mask=np.zeros_like(y)
    for i in range(n):
        if i+20>=n:continue
        for channel,(strong,ambiguous) in enumerate(zip(events,uncertain)):
            known=np.any((strong>=i+2)&(strong<=i+10))
            possible=np.any((ambiguous>=i+2)&(ambiguous<=i+10))
            all_valid=valid[max(0,i-1):i+11].all() and i>=1
            y[i,channel]=known;mask[i,channel]=all_valid and (known or not possible)
        if hold_valid[i:i+21].all():
            width=float(np.ptp(energy[i:i+21],axis=0).max())
            y[i,2]=width<.12;mask[i,2]=width<.12 or width>=.22
    return y,mask,{'rise':events[0],'release':events[1],'geometry_valid':valid,'energy':mean,'delta':delta,'registration_jumps':np.flatnonzero(jumps>2)+1}

def context_features(x):
    """Causal relative band/level features, initialized per clip; no future gain."""
    values=np.concatenate([x[:,8:16],x[:,0:1]],1).astype(np.float64)
    output=[]
    for seconds in [.5,2,8]:
        state=values[0].copy();a=1-np.exp(-.1/seconds);relative=[]
        for row in values:
            state+=a*(row-state);relative.append(row-state)
        output.append(np.array(relative))
    return np.concatenate(output,1).astype(np.float32)
