"""Causal, fixed-policy light traces; recorded labels never enter rendering."""
from pathlib import Path
import argparse,hashlib,json,subprocess
import numpy as np
import torch
from train_forecast import Model,features,infer
from modulation import OUTPUT_NAMES,render_trace

HERE=Path(__file__).parent;ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
METHODS=['direct','learned','instant_context','delayed_model']


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False);torch.set_num_threads(4)
    run=ROOT/'native_cues/forecast_gain_v1';cfg=json.loads((run/'model.json').read_text())
    evaluation=json.loads((run/'evaluation.json').read_text());prior=np.array(evaluation['prior'],np.float32)
    mean=np.array(cfg['mean'],np.float32);std=np.array(cfg['std'],np.float32)
    model=Model(prior);model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in cfg['state'].items()},strict=True);model.eval()
    baseline=json.loads((run/'baselines.json').read_text())['instant_context']
    weight=np.array(baseline['weight'],np.float32);bias=np.array(baseline['bias'],np.float32)
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    cases={
      'forest':{'source':catalog['forest']['source'],'audio_csv':str(ROOT/'wide_lights/audio_v1/forest_1800.csv'),'start':1800,'display':[1860,1920],'label':'Of The Trees / Forest','role':'Development performance'},
      'jack_white':{'source':'/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26-193630/concerts/jack_white_at_pine_knob_july_25_2026_4qWhG3JPdNU.mp4',
         'audio_csv':str(args.out/'jack_white_audio.csv'),'start':2040,'display':[2100,2160],'label':'Jack White / Pine Knob','role':'Exploratory rock recording; outside fitting'}}
    report={}
    for key,case in cases.items():
        if key=='jack_white':
            subprocess.run(['node',str(HERE.parent/'wide_lights/extract_audio.mjs'),case['source'],case['audio_csv'],str(case['start']),'120'],check=True)
        raw=np.loadtxt(case['audio_csv'],delimiter=',',skiprows=1);x,pt=features(raw)
        delayed=np.concatenate([np.repeat(x[:1],170,axis=0),x[:-170]],axis=0)
        logits=((x-mean)/std)@weight.T+bias
        pred={'direct':np.broadcast_to(prior,(len(pt),4)).copy(),'learned':infer(model,x,mean,std,'cpu'),
              'instant_context':1/(1+np.exp(-np.clip(logits,-80,80))),
              'delayed_model':infer(model,delayed,mean,std,'cpu')}
        if key=='forest':
            with np.load(run/'forest_1800.npz') as saved:
                for name in ['learned','instant_context']:assert np.max(abs(pred[name]-saved[name]))<1e-6
        outputs=[];used=[]
        for name in METHODS:
            ready=case['start']+(42.5 if name=='delayed_model' else 25.5)
            trace,indices=render_trace(raw[:,0],raw[:,1:9],pt,pred[name],prior,ready,.02)
            outputs.append(trace);used.append(indices)
        outputs=np.stack(outputs,1);used=np.stack(used,1)
        assert np.isfinite(outputs).all()
        assert ((outputs[:,:,:4]>=0)&(outputs[:,:,:4]<=1)).all()
        assert ((outputs[:,:,4]>=-1)&(outputs[:,:,4]<=1)).all()
        assert ((outputs[:,:,6]>=.75)&(outputs[:,:,6]<=1.25)).all()
        assert ((outputs[:,:,7]>=.8)&(outputs[:,:,7]<=1.2)).all()
        # Changing future predictions cannot change any earlier policy output.
        altered=pred['learned'].copy();cut=len(pt)//2;altered[cut:]=1-altered[cut:]
        other,_=render_trace(raw[:,0],raw[:,1:9],pt,altered,prior,case['start']+25.5,.02)
        prefix=raw[:,0]<pt[cut]+.02-1e-8
        assert np.array_equal(outputs[prefix,1],other[prefix])
        keep=(raw[:,0]>=case['display'][0])&(raw[:,0]<case['display'][1])
        assert (used[keep]>=0).all()
        base=outputs[keep,0,0].astype(float);bdelta=np.diff(base)
        metrics={}
        for k,name in enumerate(METHODS):
            current=outputs[keep,k,0].astype(float);gain=outputs[keep,k,6];delta=np.diff(current)
            metrics[name]={'intensity_mean':float(current.mean()),'gain_min_median_max':np.quantile(gain,[0,.5,1]).tolist(),
              'intensity_mean_abs_change_from_direct':float(np.mean(abs(current-base))),
              'intensity_max_abs_change_from_direct':float(np.max(abs(current-base))),
              'intensity_first_difference_correlation_with_direct':float(np.corrcoef(bdelta,delta)[0,1]),
              'new_saturated_frames':int(((current>=1)&(base<1)).sum()),'display_audio_frames':int(keep.sum())}
        with (args.out/(key+'.npz')).open('xb') as f:
            np.savez_compressed(f,time=raw[:,0],scope=raw[:,1:9],output=outputs,prediction_time=pt,prediction=np.stack([pred[n] for n in METHODS],1),prediction_index=used)
        report[key]={**case,'metrics':metrics,'policy_prefix_max_error':0,'no_future_prediction_consumed':True}
        print('COMPLETE',key,metrics['learned'],flush=True)
    with (args.out/'manifest.json').open('x') as f:json.dump({'cases':report,'methods':METHODS,'output_names':OUTPUT_NAMES,'run':str(run),
        'modeled_processing_allowance_ms':20,'human_quality_approval':False,'physical_latency_measured':False,'live_promotion':False,
        'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'modulation.py',HERE/'MODULATION_EXPERIMENT.md']}},f,indent=2)


if __name__=='__main__':main()
