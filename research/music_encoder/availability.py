"""Timestamped, past-only delivery of frozen contextual audio features."""
import numpy as np

def ready_times(endpoints,costs,minimum_delay=.1):
    endpoints=np.asarray(endpoints,np.float64);costs=np.asarray(costs,np.float64)
    assert len(endpoints)==len(costs) and np.all(np.diff(endpoints)>0)
    assert np.isfinite(costs).all() and np.all(costs>=0) and minimum_delay>=0
    result=np.empty_like(endpoints);previous=-np.inf
    for i,(end,cost) in enumerate(zip(endpoints,costs)):
        previous=max(float(end),previous)+max(float(cost),minimum_delay);result[i]=previous
    return result

def deliver(times,endpoints,features,costs,minimum_delay=.1):
    ready=ready_times(endpoints,costs,minimum_delay)
    ix=np.searchsorted(ready,np.asarray(times)+1e-8,side='right')-1
    valid=ix>=0;output=np.zeros((len(times),features.shape[1]),np.float32)
    output[valid]=features[ix[valid]]
    assert np.all(ready[ix[valid]]<=np.asarray(times)[valid]+1e-8)
    return output,valid,ix,ready
