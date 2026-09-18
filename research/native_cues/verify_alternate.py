from pathlib import Path
import json,hashlib
import numpy as np

root=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues');run=root/'alternate_recording_v1';report=json.loads((run/'report.json').read_text());sums=[];counts=[];maxerror=0.;checks=[]
for key,c in report['clips'].items():
    z=np.load(run/(key+'.npz'));old=np.load(root/'forecast_gain_v1'/(key+'.npz'))
    assert all(np.array_equal(z[k],old[k]) for k in ['time','target','mask'])
    assert hashlib.sha256((root/'forecast_gain_v1'/(key+'.npz')).read_bytes()).hexdigest()==report['original_prediction_sha256'][key]
    for rec,bank in [('wide',old),('alternate',z)]:
        for method in ['learned','amplitude_only','instant_context','tempo_phase','learned_delayed17s']:
            ids=np.arange(424,len(z['time']));p=bank['learned'][ids-170] if method.endswith('delayed17s') else bank[method][ids]
            y=z['target'][ids].astype(float);m=z['mask'][ids].astype(float);p=p.astype(float)
            b=((y-p)**2*m).sum(0)/m.sum(0)
            saved=np.array([r['brier'] for r in c['conditions'][rec+'_'+method]['metrics'].values()]);maxerror=max(maxerror,float(max(abs(b-saved))))
    y=z['target'].astype(float);m=z['mask'].astype(float);p=z['learned'].astype(float)
    # Paired error differences: alternate vs wide, versus same-recording context,
    # and versus its own 17-second-delayed predictions. 60s blocks within clips.
    for start in range(424,len(y),600):
        ids=np.arange(start,min(start+600,len(y)));errors=[]
        for b in [old['learned'][ids],z['instant_context'][ids],z['learned'][ids-170]]:
            errors.append((((y[ids]-p[ids])**2-(y[ids]-b.astype(float))**2)*m[ids]).sum(0))
        sums.append(errors);counts.append(m[ids].sum(0))
    checks.append(key)
sums=np.array(sums);counts=np.array(counts);rng=np.random.default_rng(16092026);ids=rng.integers(len(sums),size=(4000,len(sums)))
vals=(sums[ids].sum(1)/counts[ids].sum(1)[:,None,:]).mean(2)
point=(sums.sum(0)/counts.sum(0)[None,:]).mean(1)
assert maxerror<1e-6
result=dict(unchanged_time_target_mask=checks,score_recompute_max_error=maxerror,comparisons={k:dict(mean_difference=float(point[i]),block_ci95=np.quantile(vals[:,i],[.025,.975]).tolist()) for i,k in enumerate(['alternate_minus_wide','alternate_minus_context','alternate_minus_delayed17s'])},limitation='Within-performance 60s block bootstrap, 12 blocks including partial tails; not independent-show confidence. No physical timing or musical-quality evidence.')
with (run/'verification.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result,indent=2))
