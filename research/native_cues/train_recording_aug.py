"""Training-only causal waveform recording augmentation; unchanged native-cue outputs."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, time
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
from forecast_targets import NAMES, future_targets

HERE = Path(__file__).parent
ROOT = Path('/Volumes/ExtremePro/Code/lightflow/research')
WARM = 254


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


context_features = module('relative_audio_features', HERE.parent/'light_events/targets.py').context_features
rhythm_features = module('causal_rhythm_features', HERE.parent/'editorial/rhythm.py').rhythm_features


def save(path, value):
    with path.open('x') as f: json.dump(value, f, indent=2, allow_nan=False)


def features(raw):
    n = len(raw)//5; blocks = raw[:n*5,1:].reshape(n,5,24)
    x = np.concatenate([blocks.mean(1), blocks.max(1)], 1).astype(np.float32)
    return np.concatenate([x, context_features(x), rhythm_features(raw[:n*5,7], block=5)],1).astype(np.float32), raw[4:n*5:5,0]


def dataset(path, review):
    data = []
    catalog = json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    for key, decision in review['clips'].items():
        if decision['status']!='admit_weak_light_field': continue
        show, _ = key.rsplit('_',1)
        raw = np.loadtxt(ROOT/'wide_lights/audio_v1'/(key+'.csv'), delimiter=',', skiprows=1)
        x, t = features(raw)
        labels = np.load(path/(key+'.npz'))
        assert labels['type_available'][0]
        y, mask = future_targets(t, labels['time'], labels['light_edge'], labels['light_edge_mask'], labels['light_pair_valid'])
        for left, right in decision.get('exclude_intervals',[]):
            # Each target window must avoid the excluded source interval.
            for h, (lo, hi) in enumerate([(.1,.3),(.3,1)]):
                mask[(t+hi>=left)&(t+lo<=right), h*2:h*2+2] = 0
        assert x.shape==(len(t),81) and np.isfinite(x).all()
        data.append(dict(key=key,show=show,split=catalog[show]['split'],x=x,t=t,y=y,mask=mask))
    assert {d['split'] for d in data}=={'train','validation','test'}
    raw = np.loadtxt(ROOT/'wide_lights/audio_v1'/(data[0]['key']+'.csv'), delimiter=',', skiprows=1)
    altered = raw.copy(); altered[3500:,1:] = altered[3500:,1:][::-1]
    a,_ = features(raw); b,_ = features(altered)
    assert np.array_equal(a[:700], b[:700]), 'Audio context has future dependence'
    return data


def average_precision(y, p):
    order = np.argsort(-p,kind='stable'); y=y[order]; p=p[order]
    ends = np.r_[np.flatnonzero(np.diff(p)),len(p)-1]; tp=np.cumsum(y)[ends]
    recall = tp/max(1,float(y.sum()))
    return float(np.sum(np.diff(np.r_[0,recall])*tp/(ends+1)))


def metrics(y,p,m):
    result={}
    for i,name in enumerate(NAMES):
        keep=m[:,i]>0; truth=y[keep,i]; pred=p[keep,i]
        result[name]={'ap':average_precision(truth,pred) if len(truth) else None,
            'brier':float(np.mean((truth-pred)**2)) if len(truth) else None,
            'prevalence':float(truth.mean()) if len(truth) else None,
            'prediction_mean':float(pred.mean()) if len(truth) else None,
            'prediction_std':float(pred.std()) if len(truth) else None,'valid_frames':int(keep.sum())}
    return result


def score(y,p,m):
    keep=m.sum(0)>0
    assert keep.any()
    return float((((y-p)**2*m).sum(0)/np.maximum(1,m.sum(0)))[keep].mean())


class Model(nn.Module):
    def __init__(self,prior):
        super().__init__()
        self.layers=nn.ModuleList([nn.Conv1d(81 if i==0 else 24,24,3,dilation=2**i) for i in range(7)])
        self.head=nn.Conv1d(24,4,1)
        with torch.no_grad(): self.head.bias.copy_(torch.from_numpy(np.log(np.clip(prior,.001,.999)/np.clip(1-prior,.001,.999))))
    def forward(self,x):
        for i,layer in enumerate(self.layers):
            nxt=F.silu(layer(F.pad(x,(2*2**i,0)))); x=nxt if i==0 else (x+nxt)/1.41421356
        return self.head(x)


def infer(model,x,mean,std,device,chunk=1024):
    result=[]
    with torch.no_grad():
        for start in range(0,len(x),chunk):
            first=max(0,start-WARM)
            a=torch.from_numpy(((x[first:start+chunk]-mean)/std).T[None].copy()).to(device)
            p=model(a).sigmoid()[0].T.cpu().numpy(); result.append(p[start-first:])
    return np.concatenate(result)


def columns(x,kind):
    if kind=='amplitude_only': return x[:,[0]]
    if kind=='tempo_phase': return x[:,-6:]
    return x


def fit_logistic(data,kind,mean,std,prior,device):
    train=[d for d in data if d['split']=='train']; val=[d for d in data if d['split']=='validation']
    x=np.concatenate([columns((d['x']-mean)/std,kind)[WARM:] for d in train])
    y=np.concatenate([d['y'][WARM:] for d in train]); mask=np.concatenate([d['mask'][WARM:] for d in train])
    model=nn.Linear(x.shape[1],4).to(device)
    with torch.no_grad():
        model.weight.zero_(); model.bias.copy_(torch.from_numpy(np.log(np.clip(prior,.001,.999)/np.clip(1-prior,.001,.999))).to(device))
    optimizer=torch.optim.AdamW(model.parameters(),lr=.015,weight_decay=.01)
    tx=torch.from_numpy(x.copy()).to(device); ty=torch.from_numpy(y.copy()).to(device); tm=torch.from_numpy(mask.copy()).to(device)
    best=float('inf')
    for epoch in range(200):
        losses=F.binary_cross_entropy_with_logits(model(tx),ty,reduction='none')
        loss=((losses*tm).sum(0)/tm.sum(0).clamp_min(1)).mean()
        optimizer.zero_grad(); loss.backward(); optimizer.step()
        with torch.no_grad():
            scores=[score(d['y'][WARM:],model(torch.from_numpy(columns((d['x']-mean)/std,kind).copy()).to(device)).sigmoid().cpu().numpy()[WARM:],d['mask'][WARM:]) for d in val]
        value=float(np.mean(scores))
        if value<best:
            best=value; selected=epoch+1; state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    model.load_state_dict(state); model.eval()
    return model, {'selected_step':selected,'validation_brier':best}


def bootstrap(clips,baseline):
    sums=[]; counts=[]
    for d in clips:
        y=d['y'][WARM:]; m=d['mask'][WARM:]; p=d['pred']['learned'][WARM:]; b=d['pred'][baseline][WARM:]
        for start in range(0,len(y),600):
            sl=slice(start,start+600)
            sums.append((((y[sl]-p[sl])**2-(y[sl]-b[sl])**2)*m[sl]).sum(0)); counts.append(m[sl].sum(0))
    sums=np.array(sums); counts=np.array(counts); rng=np.random.default_rng(92619)
    ids=rng.integers(len(sums),size=(2000,len(sums))); values=sums[ids].sum(1)/np.maximum(1,counts[ids].sum(1))
    return {name:{'learned_minus_baseline':float(sums[:,i].sum()/max(1,counts[:,i].sum())),
                  'ci95':np.quantile(values[:,i],[.025,.975]).tolist()} for i,name in enumerate(NAMES)}


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--dataset',type=Path,required=True); ap.add_argument('--review',type=Path,required=True)
    ap.add_argument('--augmentation',type=Path,required=True)
    ap.add_argument('--device',default='mps'); args=ap.parse_args()
    augmentation=json.loads((args.augmentation/'COMPLETE.json').read_text()); assert augmentation['training_only']
    review=json.loads(args.review.read_text()); assert review['admission']=='weak_native_light_field_forecast_pilot'
    assert (args.dataset/'COMPLETE.json').exists()
    torch.set_num_threads(4); torch.manual_seed(192619); np.random.seed(192619)
    data=dataset(args.dataset,review); args.out.mkdir(parents=True,exist_ok=False)
    train=[d for d in data if d['split']=='train']; val=[d for d in data if d['split']=='validation']; test=[d for d in data if d['split']=='test']
    # Original clips alone remain in evaluation. Augmented copies enter fitting only.
    original_train=list(train)
    for d in original_train:
        for profile in ['dark_quiet','thin_loud','room_short','room_long']:
            path=args.augmentation/(d['key']+'__'+profile+'.csv')
            row=next(r for r in augmentation['rows'] if r['file']==path.name)
            assert hashlib.sha256(path.read_bytes()).hexdigest()==row['sha256']
            raw=np.loadtxt(path,delimiter=',',skiprows=1)
            ax,at=features(raw); assert np.array_equal(at,d['t'])
            train.append({**d,'key':d['key']+'_'+profile,'x':ax})
    x=np.concatenate([d['x'][WARM:] for d in train]); mean=x.mean(0); std=np.maximum(x.std(0),.025)
    y=np.concatenate([d['y'][WARM:] for d in train]); m=np.concatenate([d['mask'][WARM:] for d in train]); prior=(y*m).sum(0)/np.maximum(1,m.sum(0))
    for d in val: assert (d['mask'][WARM:].sum(0)>0).all(), d['key']
    model=Model(prior).to(args.device); optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.01)
    batches=[]
    for d in train:
        for start in sorted(set(list(range(0,len(d['x'])-511,258))+[len(d['x'])-512])):
            sl=slice(start,start+512)
            if d['mask'][start+WARM:start+512].mean()<.1:continue
            batches.append((((d['x'][sl]-mean)/std).T,d['y'][sl].T,d['mask'][sl].T))
    bx,by,bm=[torch.from_numpy(np.stack([b[i] for b in batches]).copy()).to(args.device) for i in range(3)]
    best=float('inf'); history=[]; began=time.monotonic()
    for epoch in range(1,51):
        model.train(); losses=[]
        for ids in torch.randperm(len(bx)).split(8):
            logits=model(bx[ids])[:,:,WARM:]; mask=bm[ids,:,WARM:]
            loss=((F.binary_cross_entropy_with_logits(logits,by[ids,:,WARM:],reduction='none')*mask).sum((0,2))/mask.sum((0,2)).clamp_min(1)).mean()
            optimizer.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(),1); optimizer.step(); losses.append(float(loss.detach().cpu()))
        model.eval()
        value=float(np.mean([score(d['y'][WARM:],infer(model,d['x'],mean,std,args.device)[WARM:],d['mask'][WARM:]) for d in val]))
        history.append({'epoch':epoch,'train_loss':float(np.mean(losses)),'validation_brier':value})
        if value<best:
            best=value; selected=epoch; state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        print('EPOCH',epoch,'validation_brier',round(value,6),flush=True)
    model.load_state_dict(state); model.eval(); linear={}; selections={}
    for kind in ['amplitude_only','instant_context','tempo_phase']:
        linear[kind],selections[kind]=fit_logistic(train+val+test,kind,mean,std,prior,args.device)
    report={'outputs':NAMES,'selected_epoch':selected,'validation_brier':best,'prior':prior.tolist(),'clips':{},'pooled':{},
            'bootstrap':{},'baseline_selection':selections,'forest_role':'development transfer, not untouched test',
            'policy':'probability diagnostic only; no learned cues enabled','training_seconds':time.monotonic()-began,'waveform_augmentation':str(args.augmentation),'training_sequences':len(train),'training_batches':len(batches)}
    for d in data:
        d['pred']={'learned':infer(model,d['x'],mean,std,args.device),
                   'train_prior':np.broadcast_to(prior,d['y'].shape).copy(),
                   'wrong_history':infer(model,np.roll(d['x'],170,axis=0),mean,std,args.device)}
        with torch.no_grad():
            for name,baseline in linear.items():
                d['pred'][name]=baseline(torch.from_numpy(columns((d['x']-mean)/std,name).copy()).to(args.device)).sigmoid().cpu().numpy()
        assert all(np.isfinite(p).all() and ((p>=0)&(p<=1)).all() for p in d['pred'].values())
        report['clips'][d['key']]={'split':d['split'],'methods':{name:metrics(d['y'][WARM:],p[WARM:],d['mask'][WARM:]) for name,p in d['pred'].items()}}
        with (args.out/(d['key']+'.npz')).open('xb') as f:
            np.savez_compressed(f,time=d['t'],target=d['y'],mask=d['mask'],**d['pred'])
    for split in ['train','validation','test']:
        clips=[d for d in data if d['split']==split]
        report['pooled'][split]={name:metrics(np.concatenate([d['y'][WARM:] for d in clips]),np.concatenate([d['pred'][name][WARM:] for d in clips]),np.concatenate([d['mask'][WARM:] for d in clips])) for name in data[0]['pred']}
    for name in ['train_prior','amplitude_only','instant_context','tempo_phase','wrong_history']:
        report['bootstrap'][name]=bootstrap(test,name)
    original=val[0]['x'][:1200].copy(); changed=original.copy(); changed[700:]=changed[700:][::-1]
    a=infer(model,original,mean,std,args.device); b=infer(model,changed,mean,std,args.device)
    report['prefix_max_error']=float(np.max(abs(a[:700]-b[:700])))
    report['chunk_whole_max_error']=float(np.max(abs(a-infer(model,original,mean,std,args.device,chunk=10000))))
    assert report['prefix_max_error']<1e-6 and report['chunk_whole_max_error']<1e-5
    save(args.out/'evaluation.json',report); save(args.out/'history.json',history)
    save(args.out/'model.json',{'version':'native-light-edge-forecast-v1','fps':10,'input_features':81,'mean':mean.tolist(),'std':std.tolist(),
         'state':{k:v.tolist() for k,v in state.items()},'outputs':NAMES})
    with (args.out/'checkpoint.pt').open('xb') as f: torch.save(state,f)
    save(args.out/'baselines.json',{name:{k:v.detach().cpu().tolist() for k,v in baseline.state_dict().items()} for name,baseline in linear.items()})
    save(args.out/'manifest.json',{'dataset':str(args.dataset),'review':review,'seed':192619,'device':args.device,'fresh_weights':True,
         'initialization':'Fresh random TCN; output bias from training-only prior. Logistic zero weights/prior bias.',
         'no_rpmc':True,'source_av_offset':'unknown','physical_latency':'unmeasured',
         'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'forecast_targets.py',HERE/'DATASET_EXPERIMENT.md',HERE/'RECORDING_EXPERIMENT.md',HERE/'recording-dsp.mjs',HERE/'extract_recording.mjs',args.augmentation/'COMPLETE.json',
             args.review,HERE.parent/'light_events/targets.py',HERE.parent/'editorial/rhythm.py']}})
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__': main()
