"""Propose same-performance audio alignment from spectral landmarks.

This matches recording content, not physical stage-light/audio synchronization.
Audience acoustic delay and editorial A/V offsets still require separate review.
"""
from pathlib import Path
import argparse, json, subprocess
import numpy as np


def features(source):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(source), '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', 'pipe:1'])
    audio = np.frombuffer(raw, '<f4')
    hop, size = 800, 512
    frames = np.lib.stride_tricks.sliding_window_view(audio, size)[::hop]
    edges = np.geomspace(35, 3800, 25)
    freq = np.fft.rfftfreq(size, 1/8000)
    bands = [(freq >= lo) & (freq < hi) for lo, hi in zip(edges[:-1], edges[1:])]
    # Narrow low-frequency bands can fall between FFT bins. Use the nearest
    # center bin rather than emitting a NaN column from an empty mean.
    for band,lo,hi in zip(bands,edges[:-1],edges[1:]):
        if not band.any():band[np.argmin(abs(freq-np.sqrt(lo*hi)))]=True
    result = []
    for start in range(0, len(frames), 4000):
        power = abs(np.fft.rfft(frames[start:start+4000]*np.hanning(size), axis=1))**2
        result.append(np.stack([np.log1p(power[:, b].mean(1)*1000) for b in bands], axis=1))
    x = np.concatenate(result).astype(np.float32)
    # Changes reduce recording EQ/gain and slowly varying crowd-noise effects.
    change = np.diff(x, axis=0, prepend=x[:1])
    change = np.clip(change/np.maximum(change.std(0), .05), -5, 5)
    assert np.isfinite(change).all()
    return change, {'duration':len(audio)/8000, 'feature_fps':10, 'window_seconds':size/8000,
                    'rms':float(np.sqrt(np.mean(audio.astype(np.float64)**2))),
                    'sample_peak':float(np.max(abs(audio))), 'near_full_scale_fraction':float(np.mean(abs(audio)>=.999))}


def match(reference, query):
    """Normalized correlation at every valid reference start; no circular overlap."""
    n, m = len(reference), len(query)
    if m > n:raise ValueError('Query longer than reference')
    size = 1 << (n+m-1).bit_length()
    corr = np.fft.irfft(np.sum(np.fft.rfft(reference,size,axis=0)*np.conj(np.fft.rfft(query,size,axis=0)), axis=1), size)[:n-m+1]
    energy = np.r_[0, np.cumsum((reference**2).sum(1), dtype=np.float64)]
    denom = np.sqrt(np.maximum((energy[m:]-energy[:-m])*float(np.sum(query**2)),1e-12))
    return corr/denom


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--reference',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--reuse-features',type=Path)
    args=parser.parse_args();args.out.mkdir(parents=True,exist_ok=False)
    if args.reuse_features:
        cached=np.load(args.reuse_features/'features.npz');previous=json.loads((args.reuse_features/'alignment.json').read_text())
        assert previous['reference']==str(args.reference) and previous['candidate']==str(args.candidate)
        reference,candidate=cached['reference'],cached['candidate']
        valid=np.isfinite(reference).all(0)&np.isfinite(candidate).all(0)
        reference,candidate=reference[:,valid],candidate[:,valid]
        assert valid.sum()>=16
        rstats,cstats=previous['reference_stats'],previous['candidate_stats']
        print('REUSED finite spectral bands',int(valid.sum()),flush=True)
    else:
        print('REFERENCE',flush=True);reference,rstats=features(args.reference)
        print('CANDIDATE',flush=True);candidate,cstats=features(args.candidate)
    anchors=[];width=600
    for fraction in np.linspace(.08,.9,10):
        start=int((len(candidate)-width)*fraction)
        scores=match(reference,candidate[start:start+width]);best=int(np.argmax(scores))
        other=scores.copy();other[max(0,best-200):best+201]=-np.inf
        anchors.append({'candidate_seconds':start/10,'reference_seconds':best/10,
                        'offset_seconds':(best-start)/10,'correlation':float(scores[best]),
                        'runner_up_outside_20s':float(other.max())})
        print(anchors[-1],flush=True)
    confident=[a for a in anchors if a['correlation']>.2 and a['correlation']>a['runner_up_outside_20s']*1.8]
    fit=None
    if len(confident)>=3:
        x=np.array([a['candidate_seconds'] for a in confident]);y=np.array([a['reference_seconds'] for a in confident])
        slope,intercept=np.polyfit(x,y,1);errors=y-(slope*x+intercept)
        fit={'reference_time_equals_candidate_time_times':float(slope),'plus_seconds':float(intercept),
             'max_anchor_residual_seconds':float(max(abs(errors))),'anchors':len(confident)}
    report={'reference':str(args.reference),'candidate':str(args.candidate),'reference_stats':rstats,'candidate_stats':cstats,
            'anchors':anchors,'proposed_content_alignment':fit,'feature_reuse':str(args.reuse_features) if args.reuse_features else None,
            'limitation':'Coarse 100 ms recording-content match only. Does not remove audience acoustic delay or prove correct light-to-audio timing; no replacement media or labels created.'}
    with (args.out/'alignment.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    with (args.out/'features.npz').open('xb') as f:np.savez_compressed(f,reference=reference,candidate=candidate)
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__':main()
