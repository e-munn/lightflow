"""Causal forecast of weak stage-energy events; no renderer promotion implied."""
from pathlib import Path
import argparse,hashlib,importlib.util,json,sys
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
from targets import NAMES as CANDIDATE_NAMES,context_features

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/light_events')
WARM=254
NAMES=CANDIDATE_NAMES[:2]
sys.path.insert(0,str(HERE.parent/'editorial'))
from rhythm import rhythm_features
spec=importlib.util.spec_from_file_location('appearance_data',HERE.parent/'wide_lights/train.py')
appearance=importlib.util.module_from_spec(spec);spec.loader.exec_module(appearance)

def save(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2,allow_nan=False)

def ap(y,p):
    order=np.argsort(-p,kind='stable');y=y[order];p=p[order]
    ends=np.r_[np.flatnonzero(np.diff(p)),len(p)-1];tp=np.cumsum(y)[ends]
    recall=tp/max(1,float(y.sum()))
    return float(np.sum(np.diff(np.r_[0,recall])*tp/(ends+1)))

def metrics(y,p,m):
    result={}
    for i,name in enumerate(NAMES):
        keep=m[:,i]>0;truth=y[keep,i];pred=p[keep,i]
        result[name]={'ap':ap(truth,pred) if len(truth) else None,'brier':float(np.mean((truth-pred)**2)) if len(truth) else None,
            'prevalence':float(truth.mean()) if len(truth) else None,'prediction_mean':float(pred.mean()) if len(truth) else None,
            'prediction_std':float(pred.std()) if len(truth) else None,'valid_frames':int(keep.sum())}
    return result

def score(y,p,m):
    return float(np.mean([((y[:,i]-p[:,i])**2*m[:,i]).sum()/max(1,m[:,i].sum()) for i in range(len(NAMES))]))

def dataset():
    review=json.loads((HERE/'review.json').read_text());assert review['admission']=='weak_events_for_offline_pilot'
    data=appearance.load_data()
    for d in data:
        raw=np.loadtxt(appearance.ROOT/'audio_v1'/(d['key']+'.csv'),delimiter=',',skiprows=1)
        rhythm=rhythm_features(raw[:,7],block=5)
        d['rhythm']=rhythm[:len(d['x'])]
        d['x']=np.concatenate([d['x'],context_features(d['x']),d['rhythm']],1).astype(np.float32)
        labels=np.load(ROOT/'labels_v2'/(d['key']+'.npz'))
        ix=np.searchsorted(labels['time'],d['t']-1e-5)
        assert np.max(abs(labels['time'][ix]-d['t']))<1e-4
        d['y']=labels['target'][ix,:2].copy();d['mask']=labels['mask'][ix,:2].copy()
        d['events']=[labels['time'][labels[k]] for k in ['rise','release']]
        for left,right in review.get('exclude_intervals',{}).get(d['key'],[]):
            d['mask'][(d['t']>=left)&(d['t']<right)]=0
    return data

class Model(nn.Module):
    def __init__(self,inputs):
        super().__init__();self.layers=nn.ModuleList([nn.Conv1d(inputs if i==0 else 24,24,3,dilation=2**i) for i in range(7)]);self.head=nn.Conv1d(24,len(NAMES),1)
    def forward(self,x):
        for i,layer in enumerate(self.layers):
            nxt=F.silu(layer(F.pad(x,(2*2**i,0))));x=nxt if i==0 else (x+nxt)/1.41421356
        return self.head(x)

def infer(model,x,mean,std,device,chunk=1024):
    result=[]
    with torch.no_grad():
        for start in range(0,len(x),chunk):
            first=max(0,start-WARM);a=torch.from_numpy(((x[first:start+chunk]-mean)/std).T[None].copy()).to(device)
            p=model(a).sigmoid()[0].T.cpu().numpy();result.append(p[start-first:])
    return np.concatenate(result)

def columns(x,kind):
    if kind=='amplitude_only':return x[:,[0]]
    if kind=='tempo_phase':return x[:,-6:]
    return x

def fit_logistic(data,kind,mean,std,device):
    train=[d for d in data if d['split']=='train'];val=[d for d in data if d['split']=='validation']
    x=np.concatenate([columns((d['x']-mean)/std,kind)[WARM:] for d in train]);y=np.concatenate([d['y'][WARM:] for d in train]);mask=np.concatenate([d['mask'][WARM:] for d in train])
    model=nn.Linear(x.shape[1],len(NAMES)).to(device);optimizer=torch.optim.AdamW(model.parameters(),lr=.015,weight_decay=.01)
    tx=torch.from_numpy(x.copy()).to(device);ty=torch.from_numpy(y.copy()).to(device);tm=torch.from_numpy(mask.copy()).to(device)
    best=float('inf')
    for epoch in range(200):
        logits=model(tx);losses=F.binary_cross_entropy_with_logits(logits,ty,reduction='none');loss=((losses*tm).sum(0)/tm.sum(0).clamp_min(1)).mean()
        optimizer.zero_grad();loss.backward();optimizer.step()
        with torch.no_grad():
            scores=[score(d['y'][WARM:],model(torch.from_numpy(columns((d['x']-mean)/std,kind).copy()).to(device)).sigmoid().cpu().numpy()[WARM:],d['mask'][WARM:]) for d in val]
        value=float(np.mean(scores))
        if value<best:best=value;state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
    model.load_state_dict(state);model.eval();return model

def triggers(p,threshold):
    if threshold is None:return np.array([],dtype=int)
    result=[];armed=True;last=-999
    for i,value in enumerate(p):
        if value<threshold*.75:armed=True
        if armed and i-last>=5 and value>=threshold:result.append(i);last=i;armed=False
    return np.array(result,dtype=int)

def event_score(clips,method,head,threshold):
    hits=0;total_pred=0;total_truth=0;seconds=0.;errors=[]
    for d in clips:
        t=d['t'];mask=d['mask'][:,head]>0
        ids=triggers(d['pred'][method][:,head],threshold)
        ids=ids[(ids>=WARM)&(ids<len(t)-20)];ids=ids[mask[ids]]
        truth=d['events'][head]
        truth=truth[(truth>=t[WARM]+.2)&(truth<=t[-21]+1)]
        # Score only target events reachable from a known forecast window.
        truth=np.array([v for v in truth if np.any(mask&(t>=v-1.-1e-6)&(t<=v-.2+1e-6)&(np.arange(len(t))>=WARM))])
        used=set()
        for i in ids:
            candidates=np.flatnonzero((truth>=t[i]+.2-1e-6)&(truth<=t[i]+1.+1e-6))
            match=next((int(j) for j in candidates if int(j) not in used),None)
            if match is not None:used.add(match);hits+=1;errors.append(abs(float(truth[match]-(t[i]+.6))))
        total_pred+=len(ids);total_truth+=len(truth);seconds+=mask[WARM:-20].sum()/10
    precision=hits/max(1,total_pred);recall=hits/max(1,total_truth)
    return {'precision':precision,'recall':recall,'f1':2*precision*recall/max(1e-12,precision+recall),
        'triggers':total_pred,'events':total_truth,'matched':hits,'false_triggers_per_scorable_minute':(total_pred-hits)/max(1e-9,seconds/60),
        'scorable_seconds':seconds,'median_error_from_window_center_seconds':float(np.median(errors)) if errors else None,
        'matching':'one-to-one within forecast window +0.2 to +1.0 seconds; not precise physical timing'}

def bootstrap(clips,baseline):
    sums=[];counts=[]
    for d in clips:
        y=d['y'][WARM:];m=d['mask'][WARM:];p=d['pred']['learned'][WARM:];b=d['pred'][baseline][WARM:]
        for start in range(0,len(y),600):
            sl=slice(start,start+600);sums.append((((y[sl]-p[sl])**2-(y[sl]-b[sl])**2)*m[sl]).sum(0));counts.append(m[sl].sum(0))
    sums=np.array(sums);counts=np.array(counts);rng=np.random.default_rng(926);ids=rng.integers(len(sums),size=(2000,len(sums)))
    values=sums[ids].sum(1)/np.maximum(1,counts[ids].sum(1))
    return {name:{'learned_minus_baseline':float(sums[:,i].sum()/max(1,counts[:,i].sum())),'ci95':np.quantile(values[:,i],[.025,.975]).tolist()} for i,name in enumerate(NAMES)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='mps');args=ap.parse_args()
    data=dataset();args.out.mkdir(parents=True,exist_ok=False);torch.set_num_threads(4);torch.manual_seed(192609);np.random.seed(192609)
    train=[d for d in data if d['split']=='train'];val=[d for d in data if d['split']=='validation'];test=[d for d in data if d['split']=='test']
    x=np.concatenate([d['x'][WARM:] for d in train]);mean=x.mean(0);std=np.maximum(x.std(0),.025)
    y=np.concatenate([d['y'][WARM:] for d in train]);m=np.concatenate([d['mask'][WARM:] for d in train]);prior=(y*m).sum(0)/np.maximum(1,m.sum(0))
    model=Model(x.shape[1]).to(args.device);optimizer=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.01)
    batches=[]
    for d in train:
        for start in sorted(set(list(range(0,len(d['x'])-511,258))+[len(d['x'])-512])):
            sl=slice(start,start+512)
            if d['mask'][start+WARM:start+512].mean()<.1:continue
            batches.append((((d['x'][sl]-mean)/std).T,d['y'][sl].T,d['mask'][sl].T))
    bx,by,bm=[torch.from_numpy(np.stack([b[i] for b in batches]).copy()).to(args.device) for i in range(3)]
    best=float('inf');history=[]
    for epoch in range(1,51):
        model.train();losses=[]
        for ids in torch.randperm(len(bx)).split(8):
            logits=model(bx[ids])[:,:,WARM:];mask=bm[ids,:,WARM:]
            loss=((F.binary_cross_entropy_with_logits(logits,by[ids,:,WARM:],reduction='none')*mask).sum((0,2))/mask.sum((0,2)).clamp_min(1)).mean()
            optimizer.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);optimizer.step();losses.append(float(loss.detach().cpu()))
        model.eval();value=float(np.mean([score(d['y'][WARM:],infer(model,d['x'],mean,std,args.device)[WARM:],d['mask'][WARM:]) for d in val]))
        history.append({'epoch':epoch,'train_loss':float(np.mean(losses)),'validation_brier':value})
        if value<best:best=value;selected=epoch;state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        print('EPOCH',epoch,'val',round(value,5),flush=True)
    model.load_state_dict(state);model.eval()
    linear={kind:fit_logistic(data,kind,mean,std,args.device) for kind in ['amplitude_only','instant_context','tempo_phase']}
    report={'selected_epoch':selected,'prior':prior.tolist(),'clips':{},'pooled':{},'event_thresholds':{},'events':{},'bootstrap':{}}
    for d in data:
        x=d['x'];d['pred']={'learned':infer(model,x,mean,std,args.device),'train_prior':np.broadcast_to(prior,d['y'].shape).copy(),
            'wrong_history':infer(model,np.roll(x,170,axis=0),mean,std,args.device)}
        with torch.no_grad():
            for name,baseline in linear.items():d['pred'][name]=baseline(torch.from_numpy(columns((x-mean)/std,name).copy()).to(args.device)).sigmoid().cpu().numpy()
        report['clips'][d['key']]={'split':d['split'],'methods':{name:metrics(d['y'][WARM:],p[WARM:],d['mask'][WARM:]) for name,p in d['pred'].items()}}
        with (args.out/(d['key']+'.npz')).open('xb') as f:np.savez_compressed(f,time=d['t'],target=d['y'],mask=d['mask'],**d['pred'])
    for split in ['train','validation','test']:
        clips=[d for d in data if d['split']==split]
        report['pooled'][split]={name:metrics(np.concatenate([d['y'][WARM:] for d in clips]),np.concatenate([d['pred'][name][WARM:] for d in clips]),np.concatenate([d['mask'][WARM:] for d in clips])) for name in data[0]['pred']}
    for head in range(2):
        report['event_thresholds'][NAMES[head]]={};report['events'][NAMES[head]]={}
        for method in ['learned','amplitude_only','instant_context','tempo_phase']:
            candidates=[]
            for threshold in np.arange(.15,.876,.025):
                result=event_score(val,method,head,float(threshold))
                if result['precision']>=.65 and result['triggers']>=10:candidates.append((result['recall'],float(threshold),result))
            chosen=max(candidates,key=lambda v:v[0]) if candidates else None;threshold=chosen[1] if chosen else None
            report['event_thresholds'][NAMES[head]][method]={'threshold':threshold,'validation':chosen[2] if chosen else None}
            report['events'][NAMES[head]][method]=event_score(test,method,head,threshold)
            if method=='learned':report['events'][NAMES[head]]['wrong_history']=event_score(test,'wrong_history',head,threshold)
    for name in ['train_prior','amplitude_only','instant_context','tempo_phase','wrong_history']:report['bootstrap'][name]=bootstrap(test,name)
    original=val[0]['x'][:1200].copy();changed=original.copy();changed[700:]=changed[700:][::-1]
    a=infer(model,original,mean,std,args.device);b=infer(model,changed,mean,std,args.device)
    report['prefix_max_error']=float(np.max(abs(a[:700]-b[:700])));report['chunk_whole_max_error']=float(np.max(abs(a-infer(model,original,mean,std,args.device,chunk=10000))))
    assert report['prefix_max_error']<1e-6 and report['chunk_whole_max_error']<1e-5
    save(args.out/'evaluation.json',report);save(args.out/'history.json',history)
    save(args.out/'model.json',{'version':'relative-light-events-v1','fps':10,'input_features':81,'mean':mean.tolist(),'std':std.tolist(),'state':{k:v.tolist() for k,v in state.items()},'outputs':NAMES})
    with (args.out/'checkpoint.pt').open('xb') as f:torch.save(state,f)
    save(args.out/'baselines.json',{name:{k:v.detach().cpu().tolist() for k,v in baseline.state_dict().items()} for name,baseline in linear.items()})
    save(args.out/'manifest.json',{'labels':str(ROOT/'labels_v2'),'fresh_weights':True,'no_rpmc':True,'review':json.loads((HERE/'review.json').read_text()),
        'seed':192609,'device':args.device,'timing':'Recorded appearance horizons only; source A/V offset and acoustic delay unknown',
        'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'targets.py',HERE/'EXPERIMENT.md',HERE/'review.json',HERE.parent/'wide_lights/train.py',HERE.parent/'editorial/rhythm.py']}})
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
