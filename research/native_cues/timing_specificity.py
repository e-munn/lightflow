"""Diagnostic only: saved forecast timing, prevalence and Brier decomposition.

No fitting, no selected deployment lag, no claim of physical AV alignment.
All lags use the same interior target rows; no wrap or crossing clip boundaries.
"""
from pathlib import Path
import argparse, hashlib, json
import numpy as np

LAGS = [-200,-170,-100,-50,-20,-10,-5,-2,0,2,5,10,20,50,100,170,200]
METHODS = ['learned','amplitude_only','instant_context','tempo_phase']
NAMES = ['brighten_100_300ms','dim_100_300ms','brighten_300_1000ms','dim_300_1000ms']

def moments(y,p):
    y=np.asarray(y,np.float64); p=np.asarray(p,np.float64)
    if len(y)<2: return None
    bias=float((p.mean()-y.mean())**2)
    variance=float(p.var()); cov=float(np.mean((p-p.mean())*(y-y.mean())))
    uncertainty=float(y.var()); brier=float(np.mean((y-p)**2))
    assert abs(brier-(uncertainty+bias+variance-2*cov))<1e-12
    return dict(n=len(y),prevalence=float(y.mean()),prediction_mean=float(p.mean()),
        brier=brier,oracle_constant_brier=uncertainty,squared_mean_bias=bias,
        prediction_variance=variance,twice_covariance=2*cov,
        centered_gain=2*cov-variance,
        correlation=cov/np.sqrt(variance*uncertainty) if variance*uncertainty>0 else None)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--model',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    a.out.mkdir(parents=True,exist_ok=False)
    clips={}; groups={}; hashes={}
    for f in sorted(a.model.glob('*.npz')):
        z=np.load(f); t=z['time']; assert np.max(np.abs(np.diff(t)-.1))<1e-5
        # Both prediction endpoints and targets have full warm context at every lag.
        ids=np.arange(254+max(LAGS),len(t)-max(LAGS))
        show=f.stem.rsplit('_',1)[0]; groups.setdefault(show,[]).append(f.stem)
        hashes[f.name]=hashlib.sha256(f.read_bytes()).hexdigest()
        clip={}
        for method in METHODS:
            heads=[]
            for h in range(4):
                keep=z['mask'][ids,h]>0; target=z['target'][ids,h][keep]
                heads.append({str(lag/10):moments(target,z[method][ids-lag,h][keep]) for lag in LAGS})
            clip[method]=heads
        clips[f.stem]=clip
    # Equal-clip averages; intentionally do not pool between-clip covariance.
    aggregate={}
    for show,keys in groups.items():
        aggregate[show]={}
        for method in METHODS:
            aggregate[show][method]=[]
            for h in range(4):
                curve={}
                for lag in LAGS:
                    rows=[clips[k][method][h][str(lag/10)] for k in keys]
                    rows=[r for r in rows if r is not None]
                    curve[str(lag/10)]={k:float(np.mean([r[k] for r in rows if r[k] is not None])) for k in rows[0]}
                aggregate[show][method].append(curve)
    report=dict(model=str(a.model),head_names=NAMES,
        positive_lag='Use prediction made lag seconds BEFORE the target query; negative lag is future diagnostic only, never deployment.',
        common_support='Query indices [454, N-200); target geometry mask unchanged at all lags; no circular wrapping.',
        oracle_warning='Per-clip observed prevalence is diagnostic hindsight, not an available live predictor. Centered gain removes mean bias only; positive gain is not a human-quality score.',
        source_sha256=hashes,script_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),clips=clips,equal_clip_by_show=aggregate)
    with (a.out/'report.json').open('x') as f: json.dump(report,f,indent=2,allow_nan=False)
    for show,methods in aggregate.items():
        values=methods['learned']; center=[x['0.0'] for x in values]
        print(show,'bias',round(np.mean([x['squared_mean_bias'] for x in center]),5),'centered_gain',round(np.mean([x['centered_gain'] for x in center]),5), 'zero_cov',round(np.mean([x['twice_covariance'] for x in center]),5),'17s_cov',round(np.mean([x['17.0']['twice_covariance'] for x in values]),5))

if __name__=='__main__': main()
