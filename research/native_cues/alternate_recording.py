"""Fixed trained model and labels; alternate audio from the same performance."""
from pathlib import Path
import argparse,hashlib,json,subprocess
import numpy as np
import torch
from train_forecast import Model,features,infer,metrics,columns
from timing_specificity import moments

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,x):
    with p.open('x') as f:json.dump(x,f,indent=2,allow_nan=False)
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--alignment',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    modeldir=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues/forecast_gain_v1');cfg=json.loads((modeldir/'model.json').read_text());align=json.loads(a.alignment.read_text());base=json.loads((modeldir/'baselines.json').read_text())
    torch.set_num_threads(4);model=Model(np.ones(4,np.float32)*.5);model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in cfg['state'].items()},strict=True);model.eval();mean=np.array(cfg['mean'],np.float32);std=np.array(cfg['std'],np.float32)
    reports={};hashes={}
    for key,c in align['clips'].items():
        assert c['anchor_offset_range_seconds']<.02
        assert all(x['correlation']>.4 and x['correlation']-x['runner_up_outside_100ms']>.2 for x in c['anchors'])
        refstart=c['start']+c['constant_reference_offset'];csv=a.out/(key+'.csv')
        subprocess.run(['node','research/wide_lights/extract_audio.mjs',align['reference'],str(csv),str(refstart),'240'],check=True)
        raw=np.loadtxt(csv,delimiter=',',skiprows=1);x,t=features(raw);original=np.load(modeldir/(key+'.npz'));assert len(t)==len(original['time'])==2400
        video_time=t-c['constant_reference_offset'];assert np.max(abs(video_time-original['time']))<1e-5
        p=infer(model,x,mean,std,'cpu');pred={'learned':p}
        normalized=(x-mean)/std
        for kind,weights in base.items():
            logits=columns(normalized,kind)@np.array(weights['weight'],np.float32).T+np.array(weights['bias'],np.float32)
            pred[kind]=1/(1+np.exp(-logits))
        ids=np.arange(424,len(t));y=original['target'][ids];m=original['mask'][ids]
        conditions={}
        for recording in ['wide','alternate']:
            bank=original if recording=='wide' else pred
            for method in ['learned','amplitude_only','instant_context','tempo_phase']:
                q=bank[method][ids];conditions[recording+'_'+method]={'metrics':metrics(y,q,m),'decomposition':[moments(y[m[:,h]>0,h],q[m[:,h]>0,h]) for h in range(4)]}
            q=bank['learned'][ids-170];conditions[recording+'_learned_delayed17s']={'metrics':metrics(y,q,m),'decomposition':[moments(y[m[:,h]>0,h],q[m[:,h]>0,h]) for h in range(4)]}
        hashes[key]=sha(modeldir/(key+'.npz'))
        with (a.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,time=original['time'],target=original['target'],mask=original['mask'],**pred)
        reports[key]=dict(reference_start=refstart,feature_clock_max_error=float(np.max(abs(video_time-original['time']))),conditions=conditions)
        print(key,{k:round(np.mean([h['brier'] for h in v['metrics'].values()]),5) for k,v in conditions.items()},flush=True)
    pooled={}
    for condition in next(iter(reports.values()))['conditions']:
        pooled[condition]={}
        for head in cfg['outputs']:
            values=[v['conditions'][condition]['metrics'][head] for v in reports.values()];n=sum(v['valid_frames'] for v in values)
            pooled[condition][head]={field:sum(v[field]*v['valid_frames'] for v in values)/n for field in ['brier','prevalence','prediction_mean']}
        pooled[condition]['mean_brier']=float(np.mean([pooled[condition][h]['brier'] for h in cfg['outputs']]))
    save(a.out/'report.json',dict(clips=reports,pooled=pooled,source=align['reference'],alignment=str(a.alignment),alignment_sha256=sha(a.alignment),model_sha256=sha(modeldir/'model.json'),original_prediction_sha256=hashes,script_sha256=sha(Path(__file__)),fit_performed=False,scope='Same-performance recording substitution, fixed labels/masks/model; common rows start at 42.5s so the 17s delayed predictor also has warm context. Coarse content synchronization only, physical AV unknown. No independent new-show evidence.'))
    print('POOLED', {k:round(v['mean_brier'],6) for k,v in pooled.items()},flush=True)
if __name__=='__main__':main()
