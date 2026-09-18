"""Independent reload, unchanged-label and alternate-recording evaluation."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
import torch
from train_forecast import Model,features,infer,columns

def save(p,x):
    with p.open('x') as f:json.dump(x,f,indent=2,allow_nan=False)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--run',type=Path,required=True);a=ap.parse_args();root=a.run.parent
    cfg=json.loads((a.run/'model.json').read_text());ev=json.loads((a.run/'evaluation.json').read_text());base=json.loads((a.run/'baselines.json').read_text());torch.set_num_threads(4)
    model=Model(np.ones(4,np.float32)*.5);model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in cfg['state'].items()});model.eval();mean=np.array(cfg['mean'],np.float32);std=np.array(cfg['std'],np.float32)
    state=torch.load(a.run/'checkpoint.pt',map_location='cpu',weights_only=True);assert all(torch.equal(v,model.state_dict()[k]) for k,v in state.items())
    score_error=0.;reload_error=0.;clips=[];alt=[]
    for file in sorted(a.run.glob('*.npz')):
        z=np.load(file);old=np.load(root/'forecast_gain_v1'/file.name);assert all(np.array_equal(z[k],old[k]) for k in ['time','target','mask'])
        raw=np.loadtxt(root.parent/'wide_lights/audio_v1'/(file.stem+'.csv'),delimiter=',',skiprows=1);x,t=features(raw);p=infer(model,x,mean,std,'cpu');reload_error=max(reload_error,float(abs(p-z['learned']).max()))
        for name,values in ev['clips'][file.stem]['methods'].items():
            y=z['target'][254:].astype(float);m=z['mask'][254:].astype(float);q=z[name][254:].astype(float);calc=((y-q)**2*m).sum(0)/m.sum(0);expected=np.array([h['brier'] for h in values.values()]);score_error=max(score_error,float(abs(calc-expected).max()))
        clips.append(file.stem)
        if file.stem.startswith('forest_'):
            raw=np.loadtxt(root/'alternate_recording_v1'/(file.stem+'.csv'),delimiter=',',skiprows=1);x,_=features(raw);p=infer(model,x,mean,std,'cpu');pred={'learned':p}
            for name,w in base.items():
                logits=columns((x-mean)/std,name)@np.array(w['weight'],np.float32).T+np.array(w['bias'],np.float32);pred[name]=1/(1+np.exp(-logits))
            with (a.run/(file.stem+'_alternate.npz')).open('xb') as f:np.savez_compressed(f,time=z['time'],target=z['target'],mask=z['mask'],**pred)
            ids=np.arange(424,len(p));y=z['target'][ids].astype(float);m=z['mask'][ids].astype(float)
            conditions={}
            for rec,bank in [('wide',z),('alternate',pred)]:
                for method in ['learned','amplitude_only','instant_context','tempo_phase','delayed17s']:
                    q=bank['learned'][ids-170] if method=='delayed17s' else bank[method][ids]
                    conditions[rec+'_'+method]=(((y-q.astype(float))**2*m).sum(0),m.sum(0))
            alt.append(conditions)
    assert reload_error<1e-6 and score_error<1e-7
    pooled={key:float(np.mean(sum(v[key][0] for v in alt)/sum(v[key][1] for v in alt))) for key in alt[0]}
    save(a.run/'verification.json',dict(verified_clips=clips,checkpoint_json_equal=True,unchanged_original_times_targets_masks=True,cpu_reload_max_error=reload_error,independent_brier_max_error=score_error,alternate_paired_common_support_brier=pooled,alternate_alignment='Previously fixed audio-only local alignment; no new fit or offset choice.',physical_latency_measured=False,human_quality_approved=False))
    print(json.dumps(pooled,indent=2));print('reload',reload_error,'score',score_error)
if __name__=='__main__':main()
