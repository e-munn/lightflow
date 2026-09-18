"""Audit timestamped audio/light events with explicit calibration provenance.

Input JSON contains audio and light event intervals, each [earliest_s,latest_s].
No sensor recording or hardware output is performed. A unique temporal pairing
is required in both directions; ambiguous events are excluded, never cherry-picked.
"""
import argparse,json,math
from pathlib import Path
import numpy as np

def intervals(values,name):
    a=np.asarray(values,dtype=float)
    if a.size==0:return np.empty((0,2))
    if a.ndim!=2 or a.shape[1]!=2 or not np.isfinite(a).all() or (a[:,1]<a[:,0]).any():raise ValueError('Invalid '+name+' intervals')
    if (np.diff(a[:,0])<=0).any():raise ValueError(name+' events must be strictly ordered')
    return a

def analyze(data):
    a=intervals(data['audio'],'audio');b=intervals(data['light'],'light')
    window=data.get('pairing_window_s',[-.5,.75]);lo,hi=map(float,window)
    if not all(map(math.isfinite,[lo,hi])) or lo>=hi:raise ValueError('Invalid matching window')
    # Raw delta intervals include uncertainty at both edges.
    lower=b[None,:,0]-a[:,None,1];upper=b[None,:,1]-a[:,None,0]
    calibration=data.get('calibration',{});offset=calibration.get('light_minus_audio_clock_offset_s');uncertainty=calibration.get('offset_uncertainty_s')
    calibrated=type(offset) in [int,float] and type(uncertainty) in [int,float] and math.isfinite(offset) and math.isfinite(uncertainty) and uncertainty>=0 and bool(calibration.get('method'))
    candidates=((upper-offset+uncertainty>=lo)&(lower-offset-uncertainty<=hi)) if calibrated else ((upper>=lo)&(lower<=hi))
    pairs=[(i,int(np.flatnonzero(candidates[i])[0])) for i in range(len(a)) if candidates[i].sum()==1]
    pairs=[(i,j) for i,j in pairs if candidates[:,j].sum()==1]
    if any(pairs[i][1]>=pairs[i+1][1] for i in range(len(pairs)-1)):raise ValueError('Non-monotonic event pairing')
    rows=[]
    for i,j in pairs:
        raw=[float(lower[i,j]),float(upper[i,j])]
        corrected=[raw[0]-offset-uncertainty,raw[1]-offset+uncertainty] if calibrated else None
        rows.append(dict(audio_event=i,light_event=j,raw_delay_interval_s=raw,calibrated_delay_interval_s=corrected))
    def summary(key):
        if not rows or rows[0][key] is None:return None
        v=np.array([r[key] for r in rows]);mid=v.mean(1)
        return dict(matched_events=len(v),median_midpoint_ms=float(np.median(mid)*1000),p95_midpoint_ms=float(np.quantile(mid,.95)*1000),minimum_lower_bound_ms=float(v[:,0].min()*1000),maximum_upper_bound_ms=float(v[:,1].max()*1000),median_interval_width_ms=float(np.median(v[:,1]-v[:,0])*1000))
    measurement_claim=(data.get('provenance')=='physical_recording' and calibrated and bool(data.get('capture_file_sha256')) and bool(data.get('event_extraction_method')))
    return dict(provenance=data.get('provenance','unknown'),physical_measurement_declared=measurement_claim,independently_verified=False,calibration_applied=calibrated,pairs=rows,
        unpaired_audio=[i for i in range(len(a)) if i not in {i for i,j in pairs}],unpaired_light=[j for j in range(len(b)) if j not in {j for i,j in pairs}],
        ambiguous_audio=np.flatnonzero(candidates.sum(1)>1).tolist(),ambiguous_light=np.flatnonzero(candidates.sum(0)>1).tolist(),
        raw=summary('raw_delay_interval_s'),calibrated=summary('calibrated_delay_interval_s'),
        caveats=['Declared physical provenance is not independent verification of the recording or extraction.','Quantiles describe matched events only; misses and ambiguities must be reported alongside them.','Timestamp, exposure, sensor threshold and acoustic-path uncertainty must be included in supplied event intervals/calibration.','Unknown clock offset prevents a physical latency conclusion. Negative estimates are retained, not silently clamped.'])

def main():
    ap=argparse.ArgumentParser();ap.add_argument('input',type=Path);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();result=analyze(json.loads(a.input.read_text()))
    with a.out.open('x') as f:json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
