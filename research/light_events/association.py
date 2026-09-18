"""Recorded light/audio association diagnostics, never an offset correction."""
from pathlib import Path
import argparse,json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=False)
    here=Path(__file__).parent;root=Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights')
    catalog=json.loads((here.parent/'wide_lights/sources.json').read_text());review=json.loads((here.parent/'wide_lights/review.json').read_text())
    lags=np.arange(-30,31);report={};fig,axes=plt.subplots(5,1,figsize=(11,14),sharex=True)
    rng=np.random.default_rng(1916)
    for ax,(show,cfg) in zip(axes,catalog['sources'].items()):
        for start in cfg['starts']:
            key=f'{show}_{start:04d}'
            if review['clips'][key]['status']!='admit_weak_appearance':continue
            audio=np.loadtxt(root/'audio_v1'/(key+'.csv'),delimiter=',',skiprows=1);n=len(audio)//5
            onset=audio[:n*5,17:25].reshape(n,5,8).max(1).mean(1)
            data=np.load(root/'dataset_v1'/show/f'{start:04d}.npz');energy=data['target'][:,8:12].mean(1)
            delta=np.r_[0,np.maximum(0,np.diff(energy))]
            valid=data['weight'][:,0]>0;ix=np.arange(50,n-50);ix=ix[valid[ix]&valid[ix-1]]
            def curve(signal):return np.array([np.corrcoef(signal[ix+lag],delta[ix])[0,1] for lag in lags])
            observed=curve(onset)
            # Repetition is preserved; report a max-over-offset null, not an
            # uncorrected p-value selected from 61 inspected offsets.
            null=np.array([curve(np.roll(onset,int(shift))).max() for shift in rng.integers(170,n-170,100)])
            best=int(np.argmax(observed));report[key]={'split':cfg['split'],'lags_seconds':(lags/10).tolist(),'correlation':observed.tolist(),
                'zero_lag':float(observed[30]),'best_audio_lag_seconds':float(lags[best]/10),'best_correlation':float(observed[best]),
                'wrong_time_max_correlation_q95':float(np.quantile(null,.95)),'max_scan_null_exceedance_fraction':float((1+(null>=observed[best]).sum())/101),
                'positive_lag_meaning':'Audio onset later than observed light change; not a verified physical delay'}
            ax.plot(lags/10,observed,label=f'{start//60}:00 clip',linewidth=1.2)
        ax.axvline(0,color='black',linewidth=.7);ax.axhline(0,color='black',linewidth=.4)
        ax.set_title(show.replace('_',' ')+' / '+cfg['split'],loc='left');ax.set_ylabel('Correlation');ax.legend(loc='upper right',fontsize=8);ax.grid(alpha=.2)
    axes[-1].set_xlabel('Audio time minus light-change time (seconds)')
    fig.suptitle('Timing diagnostic: positive band novelty vs observed energy rises\nOffsets are not applied to labels or model input',fontsize=13)
    fig.tight_layout(rect=(0,0,1,.96))
    with (args.out/'association.png').open('xb') as f:fig.savefig(f,format='png',dpi=140)
    with (args.out/'association.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
