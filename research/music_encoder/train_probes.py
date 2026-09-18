"""Fair frozen music-feature comparison with explicit processing availability."""
from pathlib import Path
import argparse,hashlib,json,sys
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
from availability import deliver

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/music_encoder')
sys.path.insert(0,str(HERE.parent/'light_events'))
import train as events
WARM=events.WARM

def save(path,value):
    with path.open('x') as f:json.dump(value,f,indent=2,allow_nan=False)

def prepare():
    manifest=json.loads((ROOT/'features_v1/manifest.json').read_text());assert manifest['status']=='complete'
    data=events.dataset()
    for d in data:
        a=np.load(ROOT/'features_v1'/(d['key']+'.npz'))
        assert a['features'].shape==(470,3072) and np.isfinite(a['features']).all()
        d['music']=a['features'].copy();d['music_time']=a['time'].copy();d['music_cost']=a['processing_seconds'].copy()
    training=np.concatenate([d['music'][d['music_time']>=d['t'][WARM]] for d in data if d['split']=='train'])
    mu=training.mean(0);sd=np.maximum(training.std(0),.025)
    standardized=torch.from_numpy(((training-mu)/sd).copy())
    _,singular,v=torch.pca_lowrank(standardized,q=64,center=False,niter=2)
    projection=v.numpy().copy();variance=float((singular**2).sum()/standardized.square().sum())
    train_pc=((training-mu)/sd)@projection;pc_mu=train_pc.mean(0);pc_sd=np.maximum(train_pc.std(0),.025)
    train_signal=np.concatenate([d['x'][WARM:] for d in data if d['split']=='train'])
    signal_mu=train_signal.mean(0);signal_sd=np.maximum(train_signal.std(0),.025)
    for d in data:
        pc=(((d['music']-mu)/sd)@projection-pc_mu)/pc_sd
        now,valid,ix,ready=deliver(d['t'],d['music_time'],pc,d['music_cost'])
        delayed,delayed_valid,_,_=deliver(d['t'],d['music_time'],pc,d['music_cost'],.25)
        signal=(d['x']-signal_mu)/signal_sd
        d['inputs']={'signal':signal.astype(np.float32),'music':now,'hybrid':np.concatenate([signal,now],1).astype(np.float32)}
        d['slow_hybrid']=np.concatenate([signal,delayed],1).astype(np.float32)
        d['mask'][~valid|~delayed_valid]=0
        d['ready']=ready;d['feature_index']=ix
    transform={'music_mean':mu,'music_std':sd,'projection':projection,'pca_mean':pc_mu,'pca_std':pc_sd,'signal_mean':signal_mu,'signal_std':signal_sd}
    return data,transform,variance

def fit(data,kind,prior,device):
    training=[d for d in data if d['split']=='train'];validation=[d for d in data if d['split']=='validation']
    x=np.concatenate([d['inputs'][kind][WARM:] for d in training]);y=np.concatenate([d['y'][WARM:] for d in training]);mask=np.concatenate([d['mask'][WARM:] for d in training])
    tx,ty,tm=[torch.from_numpy(a.copy()).to(device) for a in [x,y,mask]]
    vx=[torch.from_numpy(d['inputs'][kind][WARM:].copy()).to(device) for d in validation]
    best=float('inf');history=[]
    for penalty in [.0001,.01,1.]:
        model=nn.Linear(x.shape[1],2).to(device)
        with torch.no_grad():model.weight.zero_();model.bias.copy_(torch.from_numpy(np.log(prior/(1-prior))).to(device))
        opt=torch.optim.Adam(model.parameters(),lr=.02)
        for epoch in range(1,201):
            losses=F.binary_cross_entropy_with_logits(model(tx),ty,reduction='none')
            loss=((losses*tm).sum(0)/tm.sum(0).clamp_min(1)).mean()+penalty*model.weight.square().sum()/2
            opt.zero_grad();loss.backward();opt.step()
            with torch.no_grad():predictions=[model(a).sigmoid().cpu().numpy() for a in vx]
            score=float(np.mean([events.score(d['y'][WARM:],p,d['mask'][WARM:]) for d,p in zip(validation,predictions)]))
            history.append({'penalty':penalty,'epoch':epoch,'validation_brier':score})
            if score<best:best=score;chosen={'penalty':penalty,'epoch':epoch,'validation_brier':score};state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        print('FIT',kind,'penalty',penalty,'best',round(best,5),flush=True)
    model.load_state_dict(state);model.eval();return model,state,chosen,history

def predict(model,x,device):
    with torch.no_grad():return model(torch.from_numpy(x.copy()).to(device)).sigmoid().cpu().numpy()

def event_details(clips,method,head,threshold):
    result=events.event_score(clips,method,head,threshold);all_count=0;unknown=0
    for d in clips:
        ids=events.triggers(d['pred'][method][:,head],threshold);ids=ids[(ids>=WARM)&(ids<len(d['t'])-20)]
        all_count+=len(ids);unknown+=int((d['mask'][ids,head]==0).sum())
    result.update({'all_triggers':all_count,'unscorable_triggers':unknown,'policy_status':'abstain_no_validated_threshold' if threshold is None else 'threshold_selected_on_validation'})
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='mps');args=ap.parse_args()
    torch.set_num_threads(4);torch.manual_seed(92726);np.random.seed(92726)
    data,transform,variance=prepare();args.out.mkdir(parents=True,exist_ok=False)
    training=[d for d in data if d['split']=='train'];validation=[d for d in data if d['split']=='validation'];test=[d for d in data if d['split']=='test']
    y=np.concatenate([d['y'][WARM:] for d in training]);m=np.concatenate([d['mask'][WARM:] for d in training]);prior=(y*m).sum(0)/m.sum(0)
    heads={};states={};report={'selection':{},'pca_variance_fraction':variance,'pooled':{},'clips':{},'thresholds':{},'events':{},'bootstrap':{}}
    for kind in ['signal','music','hybrid']:
        model,state,chosen,history=fit(data,kind,prior,args.device);heads[kind]=model;states[kind]=state;report['selection'][kind]=chosen
        save(args.out/(kind+'_history.json'),history)
    for d in data:
        d['pred']={kind:predict(model,d['inputs'][kind],args.device) for kind,model in heads.items()}
        d['pred']['prior']=np.broadcast_to(prior,d['y'].shape).copy()
        d['pred']['wrong_history']=predict(heads['hybrid'],np.roll(d['inputs']['hybrid'],170,axis=0),args.device)
        d['pred']['delayed_250ms']=predict(heads['hybrid'],d['slow_hybrid'],args.device)
        report['clips'][d['key']]={'split':d['split'],'methods':{name:events.metrics(d['y'][WARM:],p[WARM:],d['mask'][WARM:]) for name,p in d['pred'].items()}}
        with (args.out/(d['key']+'.npz')).open('xb') as f:np.savez_compressed(f,time=d['t'],target=d['y'],mask=d['mask'],feature_index=d['feature_index'],feature_ready_time=d['ready'],**d['pred'])
    for split in ['train','validation','test']:
        clips=[d for d in data if d['split']==split]
        report['pooled'][split]={name:events.metrics(np.concatenate([d['y'][WARM:] for d in clips]),np.concatenate([d['pred'][name][WARM:] for d in clips]),np.concatenate([d['mask'][WARM:] for d in clips])) for name in data[0]['pred']}
    for head,name in enumerate(events.NAMES):
        report['thresholds'][name]={};report['events'][name]={}
        for kind in heads:
            candidates=[]
            for threshold in np.arange(.15,.876,.025):
                r=event_details(validation,kind,head,float(threshold))
                if r['precision']>=.65 and r['triggers']>=10:candidates.append((r['recall'],float(threshold),r))
            chosen=max(candidates,key=lambda v:v[0]) if candidates else None;threshold=chosen[1] if chosen else None
            report['thresholds'][name][kind]={'threshold':threshold,'validation':chosen[2] if chosen else None}
            report['events'][name][kind]=event_details(test,kind,head,threshold)
            if kind=='hybrid':
                for control in ['wrong_history','delayed_250ms']:report['events'][name][control]=event_details(test,control,head,threshold)
    for d in test:d['pred']['learned']=d['pred']['hybrid']
    for control in ['signal','music','prior','wrong_history']:report['bootstrap'][control]=events.bootstrap(test,control)
    # Availability itself must be past-only even if later embeddings/costs change.
    d=validation[0];features=d['music'].copy();cost=d['music_cost'].copy();boundary=d['music_time'][100]
    a=deliver(d['t'],d['music_time'],features,cost)[0]
    features[101:]+=10;cost[101:]+=1
    b=deliver(d['t'],d['music_time'],features,cost)[0]
    report['availability_prefix_max_error']=float(np.max(abs(a[d['t']<=boundary]-b[d['t']<=boundary])));assert report['availability_prefix_max_error']==0
    with (args.out/'transforms.npz').open('xb') as f:np.savez_compressed(f,**transform)
    save(args.out/'models.json',{name:{k:v.tolist() for k,v in state.items()} for name,state in states.items()})
    save(args.out/'evaluation.json',report)
    save(args.out/'manifest.json',{'features':str(ROOT/'features_v1'),'labels':str(events.ROOT/'labels_v2'),'seed':92726,'device':args.device,'fresh_lighting_heads':True,
        'encoder_frozen':True,'no_rpmc_assets_loaded':True,'minimum_feature_availability_delay_seconds':.1,'physical_latency':'Unmeasured',
        'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'availability.py',HERE/'PROBE_EXPERIMENT.md',HERE.parent/'light_events/train.py',HERE.parent/'light_events/targets.py']}})
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
