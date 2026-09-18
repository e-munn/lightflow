"""Saved-model parity, independent scoring, and software-only inference timing."""
from pathlib import Path
import argparse, json, time
import numpy as np
import torch
from train_forecast import Model, features, infer

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--run',type=Path,required=True); args=ap.parse_args()
    config=json.loads((args.run/'model.json').read_text()); evaluation=json.loads((args.run/'evaluation.json').read_text())
    checks={}; max_error=0
    for path in sorted(args.run.glob('*.npz')):
        data=np.load(path); y=data['target'][254:].astype(float); m=data['mask'][254:].astype(float)
        for method in evaluation['clips'][path.stem]['methods']:
            p=data[method][254:].astype(float); count=m.sum(0)
            calculated=((y-p)**2*m).sum(0)/np.maximum(1,count)
            expected=np.array([v['brier'] for v in evaluation['clips'][path.stem]['methods'][method].values()])
            error=float(np.max(abs(calculated-expected))); assert error<1e-7
            max_error=max(max_error,error)
    checks['independent_float64_brier_max_error']=max_error
    checks['scoring_precision_note']='A float32 column-sum check differed by up to 3.3e-6 on repeated prior values; independent float64 calculation passes <1e-7.'
    original=np.load(args.run/'forest_1800.npz')
    reloaded=np.loadtxt(ROOT/'inference_forest_v1/forecast.csv',delimiter=',',skiprows=1)
    assert np.max(abs(original['time'][:len(reloaded)]-reloaded[:,0]))<1e-8
    error=float(np.max(abs(original['learned'][:len(reloaded)]-reloaded[:,2:])))
    assert error<1e-6
    checks['fresh_audio_extraction_CPU_reload_vs_training_MPS_max_error']=error
    checks['reload_rows']=len(reloaded)
    jack=np.loadtxt(ROOT/'inference_jack_white_v1/forecast.csv',delimiter=',',skiprows=1)
    assert jack.shape==(600,6) and np.isfinite(jack).all() and ((jack[:,2:]>=0)&(jack[:,2:]<=1)).all()
    checks['jack_white_file_inference']={'rows':len(jack),'context_ready_rows':int(jack[:,1].sum()),'musical_quality_evaluated':False}
    torch.set_num_threads(4)
    model=Model(np.ones(4,np.float32)*.5)
    model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in config['state'].items()},strict=True); model.eval()
    raw=np.loadtxt(ROOT/'inference_forest_v1/audio_features.csv',delimiter=',',skiprows=1)
    x,_=features(raw); mean=np.array(config['mean'],np.float32); std=np.array(config['std'],np.float32)
    original_x=x.copy(); x[400:]=x[400:][::-1]
    a=infer(model,original_x,mean,std,'cpu'); b=infer(model,x,mean,std,'cpu')
    checks['cpu_prefix_max_error']=float(np.max(abs(a[:400]-b[:400]))); assert checks['cpu_prefix_max_error']<1e-6
    tx=torch.from_numpy(((original_x[-255:]-mean)/std).T[None].copy())
    costs=[]
    with torch.no_grad():
        for i in range(105):
            start=time.perf_counter(); model(tx).sigmoid()[0,:,-1].numpy(); elapsed=(time.perf_counter()-start)*1000
            if i>=5:costs.append(elapsed)
    checks['cpu_model_forward_255_frames']={'warm_calls':len(costs),'p50_ms':float(np.median(costs)),'p95_ms':float(np.quantile(costs,.95)),
        'max_ms':max(costs),'scope':'Model forward only, excludes audio features, capture, render, fixture and physical latency'}
    checks['physical_latency_measured']=False; checks['status']='passed'
    with (args.run/'verification.json').open('x') as f:json.dump(checks,f,indent=2)
    print(json.dumps(checks,indent=2))


if __name__=='__main__':main()
