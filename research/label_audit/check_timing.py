"""Falsify an instantaneous-edge interpretation of 300 ms contrast targets."""
from pathlib import Path
import argparse,json
import numpy as np
from sampling import detect


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    rows=[]
    for fps in [10,30]:
        time=np.arange(2*fps)/fps;valid=np.ones(len(time),bool)
        energy=np.full(len(time),.1);on=fps//2;energy[on]=.8
        events=detect(time,energy,valid,fps,0,2)
        true_off=time[on+1]
        assert len(events['rise'])==len(events['release'])==1
        assert abs(events['rise'][0]-time[on])<1e-7
        assert abs(events['release'][0]-(time[on]+.3))<1e-7
        adjacent=np.r_[0,np.diff(energy)]
        adjacent_off=time[np.flatnonzero(adjacent<=-.25)]
        assert np.allclose(adjacent_off,[true_off])
        # Both methods preserve the transition for a long, clean step.
        step=np.full(len(time),.1);step[on:on+fps]=.8
        step_events=detect(time,step,valid,fps,0,2)
        assert np.allclose(step_events['rise'],[time[on]])
        assert np.allclose(step_events['release'],[time[on+fps]])
        rows.append({'fps':fps,'flash_on_seconds':float(time[on]),'actual_first_off_sample_seconds':float(true_off),
            'contrast_release_seconds':float(events['release'][0]),'contrast_release_lateness_seconds':float(events['release'][0]-true_off),
            'adjacent_difference_release_seconds':float(adjacent_off[0]),'long_step_edges':'correct in this simple case'})
    with args.out.open('x') as f:json.dump({'cases':rows,'conclusion':'300 ms contrast describes change relative to a past frame, not an instantaneous flash release. Adjacent differences fix these synthetic flashes but are not yet validated concert labels.'},f,indent=2)
    print(json.dumps(rows,indent=2))


if __name__=='__main__':main()
