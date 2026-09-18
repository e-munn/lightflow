"""Audio-only local content alignment; no lighting labels accessed."""
from pathlib import Path
import argparse,json,subprocess,hashlib
import numpy as np

SR=8000; HOP=80; SIZE=512

def feat(source,start,duration):
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-i',source,'-t',str(duration),'-vn','-ac','1','-ar',str(SR),'-f','f32le','pipe:1'])
    audio=np.frombuffer(raw,'<f4')
    frames=np.lib.stride_tricks.sliding_window_view(audio,SIZE)[::HOP]
    power=abs(np.fft.rfft(frames*np.hanning(SIZE),axis=1))**2
    freq=np.fft.rfftfreq(SIZE,1/SR); edges=np.geomspace(50,3800,17)
    bands=[]
    for lo,hi in zip(edges[:-1],edges[1:]):
        b=(freq>=lo)&(freq<hi)
        if not b.any():b[np.argmin(abs(freq-np.sqrt(lo*hi)))]=True
        bands.append(np.log1p(power[:,b].mean(1)*1000))
    x=np.stack(bands,1);x=np.diff(x,axis=0)
    return np.clip(x/np.maximum(x.std(0),.05),-5,5)

def match(a,b):
    return float((a*b).sum()/np.sqrt(max(1e-12,(a*a).sum()*(b*b).sum())))

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    prior=Path('/Volumes/ExtremePro/Code/lightflow/research/concert_cues/forest_recording_alignment_v2/alignment.json');d=json.loads(prior.read_text());fit=d['proposed_content_alignment'];slope=fit['reference_time_equals_candidate_time_times'];intercept=fit['plus_seconds'];clips={}
    for start in [600,1800,3000]:
        anchors=[]
        for offset in [30,110,190]:
            t=start+offset; expected=slope*t+intercept
            q=feat(d['candidate'],t,20);r=feat(d['reference'],expected-.5,21)
            scores=np.array([match(q,r[i:i+len(q)]) for i in range(101)])
            best=int(scores.argmax());other=scores.copy();other[max(0,best-10):best+11]=-2
            anchors.append(dict(wide_seconds=t,reference_seconds=expected-.5+best*.01,residual_seconds=-.5+best*.01,correlation=float(scores[best]),runner_up_outside_100ms=float(other.max()),scores=scores.tolist()))
        offsets=[x['reference_seconds']-x['wide_seconds'] for x in anchors]
        clips[f'forest_{start:04d}']=dict(start=start,constant_reference_offset=float(np.median(offsets)),anchor_offset_range_seconds=float(np.ptp(offsets)),anchors=anchors)
        print(start,[(round(x['residual_seconds'],3),round(x['correlation'],3),round(x['runner_up_outside_100ms'],3)) for x in anchors], 'offset range',np.ptp(offsets),flush=True)
    report=dict(reference=d['reference'],candidate=d['candidate'],coarse_alignment_sha256=hashlib.sha256(prior.read_bytes()).hexdigest(),script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),clips=clips,limitation='Audio-only content alignment, 10ms grid and 64ms spectral windows. Not a physical AV delay measurement. Constant offset per 240s clip; global measured drift predicts <10ms change within clip. No label-selected offset.')
    with (a.out/'alignment.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
if __name__=='__main__':main()
