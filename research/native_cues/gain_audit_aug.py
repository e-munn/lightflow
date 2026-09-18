"""Counterfactual recording-gain sensitivity, with labels and weights fixed."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
import torch
from train_forecast import Model, features, dataset, infer, metrics, WARM

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')


def change_gain(raw,gain):
    assert gain>0 and np.isfinite(gain)
    result=raw.copy()
    if gain==1:return result
    rms=-np.log1p(-np.minimum(raw[:,1],1-1e-7))/6
    amplitude=-np.expm1(-6*gain*rms)
    result[:,1]=amplitude
    result[:,7]=np.clip(4*np.diff(np.r_[0,amplitude]),0,1)
    result[:,9:17]=np.log1p(gain*gain*np.expm1(raw[:,9:17]))
    result[:,17:25]=np.clip(np.diff(np.vstack([np.zeros((1,8)),result[:,9:17]]),axis=0),0,4)
    inactive=gain*rms<=.0001
    for column in [2,3,4,5,6,8]:result[inactive,column]=0
    return result


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    review=json.loads((HERE/'dataset_review.json').read_text())
    run=ROOT/'native_cues/forecast_gain_v1'; config=json.loads((run/'model.json').read_text())
    torch.set_num_threads(4);model=Model(np.ones(4,np.float32)*.5)
    model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in config['state'].items()},strict=True);model.eval()
    mean=np.array(config['mean'],np.float32);std=np.array(config['std'],np.float32)
    protocol={'gains':[.25,.5,1,2,4],'weights':'fixed forecast_gain_v1','labels':'fixed native dataset_v1',
      'intent':'Sensitivity diagnostic, not select a Forest gain or optimize test scores',
      'transform':'Constant linear amplitude gain, analytic RMS/band-power transform; recompute attack and novelty, then causal context/rhythm',
      'limits':'No waveform clipping or quantization modeled. Original silence-gated shape ratios cannot be recovered by gain. Seven-decimal CSV rounding remains.',
      'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    with (args.out/'protocol.json').open('x') as f:json.dump(protocol,f,indent=2)
    clips=dataset(ROOT/'native_cues/dataset_v1',review);report={};pooled={}
    for d in clips:
        raw=np.loadtxt(ROOT/'wide_lights/audio_v1'/(d['key']+'.csv'),delimiter=',',skiprows=1)
        rms=-np.log1p(-np.minimum(raw[:,1],1-1e-7))/6
        record={'split':d['split'],'rms_quantiles':np.quantile(rms,[.1,.5,.9]).tolist(),'gains':{}}
        for gain in protocol['gains']:
            x,t=features(change_gain(raw,gain));p=infer(model,x,mean,std,'cpu')
            assert np.array_equal(t,d['t']) and np.isfinite(p).all()
            if gain==1:
                original=np.load(run/(d['key']+'.npz'))['learned']
                error=float(np.max(abs(original-p)));assert error<1e-6
                record['identity_reload_max_error']=error
            record['gains'][str(gain)]={'metrics':metrics(d['y'][WARM:],p[WARM:],d['mask'][WARM:]),
                'shape_silence_threshold_crossings':int(((rms>.0001)!=(gain*rms>.0001)).sum())}
            pooled.setdefault((d['split'],str(gain)),[]).append((d['y'][WARM:],p[WARM:],d['mask'][WARM:]))
        report[d['key']]=record
        print('COMPLETE',d['key'],flush=True)
    summary={}
    for (split,gain),values in pooled.items():
        y,p,m=[np.concatenate([v[i] for v in values]) for i in range(3)]
        summary.setdefault(split,{})[gain]=metrics(y,p,m)
    with (args.out/'results.json').open('x') as f:json.dump({'clips':report,'pooled':summary,'deployment_change':False},f,indent=2)
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__':main()
