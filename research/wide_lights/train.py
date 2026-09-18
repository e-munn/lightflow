"""Fresh causal stage-appearance baseline; video pixels are weak observations."""
from pathlib import Path
import argparse, hashlib, json
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F

ROOT = Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights')
HERE = Path(__file__).parent
WARM = 254
GROUPS = {'peak': slice(0,4), 'coverage': slice(4,8), 'energy': slice(8,12), 'chroma': slice(12,15)}

def save(path, value):
    with path.open('x') as f: json.dump(value, f, indent=2, allow_nan=False)

def load_data():
    catalog=json.loads((HERE/'sources.json').read_text())
    review=json.loads((HERE/'review.json').read_text())
    data=[]
    for show,cfg in catalog['sources'].items():
        for start in cfg['starts']:
            key=f'{show}_{start:04d}'
            if review['clips'][key]['status']!='admit_weak_appearance': continue
            audio=np.loadtxt(ROOT/'audio_v1'/f'{key}.csv',delimiter=',',skiprows=1)
            labels=np.load(ROOT/'dataset_v1'/show/f'{start:04d}.npz')
            n=len(audio)//5
            blocks=audio[:n*5,1:].reshape(n,5,24)
            x=np.concatenate([blocks.mean(1),blocks.max(1)],axis=1).astype(np.float32)
            t=audio[4:n*5:5,0]
            indices=np.searchsorted(labels['time'],t-1e-5)
            valid=indices<len(labels['time']);x,t,indices=x[valid],t[valid],indices[valid]
            assert np.max(np.abs(labels['time'][indices]-t))<1e-4
            y=labels['target'][indices].copy();mask=labels['weight'][indices].copy()
            for left,right in review['clips'][key].get('exclude_intervals',[]):
                mask[(t>=left)&(t<right)]=0
            assert np.isfinite(x).all() and np.isfinite(y).all()
            assert np.all((y>=0)&(y<=1.00001))
            data.append(dict(key=key,show=show,split=cfg['split'],x=x,y=y,t=t,mask=mask))
    assert {d['split'] for d in data}=={'train','validation','test'}
    return data

class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.layers=nn.ModuleList([nn.Conv1d(48 if i==0 else 32,32,3,dilation=2**i) for i in range(7)])
        self.head=nn.Conv1d(32,15,1)
    def forward(self,x):
        for i,layer in enumerate(self.layers):
            next_x=F.silu(layer(F.pad(x,(2*2**i,0))))
            x=next_x if i==0 else (next_x+x)/1.41421356
        logits=self.head(x)
        return torch.cat([logits[:,:12].sigmoid(),logits[:,12:].softmax(dim=1)],dim=1)

def loss_tensor(y,p,mask):
    terms=[]
    for s in GROUPS.values():
        w=mask[:,s];err=(y[:,s]-p[:,s])**2
        base=(w*err).sum()/w.sum().clamp_min(1)
        dw=w[:,:,1:]*w[:,:,:-1]
        delta=(torch.diff(y[:,s],dim=2)-torch.diff(p[:,s],dim=2))**2
        terms.append(base+.2*(dw*delta).sum()/dw.sum().clamp_min(1))
    return torch.stack(terms).mean()

def group_error(y,p,m):
    values=[]
    for s in GROUPS.values():
        w=m[:,s];v=((y[:,s]-p[:,s])**2*w).sum()/max(1,w.sum())
        dw=w[1:]*w[:-1]
        v+=.2*((np.diff(y[:,s],axis=0)-np.diff(p[:,s],axis=0))**2*dw).sum()/max(1,dw.sum())
        values.append(v)
    return float(np.mean(values))

def infer(model,x,mean,std,device,chunk=1024):
    outputs=[]
    with torch.no_grad():
        for start in range(0,len(x),chunk):
            first=max(0,start-WARM)
            a=torch.from_numpy(((x[first:start+chunk]-mean)/std).T[None].copy()).to(device)
            p=model(a)[0].T.cpu().numpy();outputs.append(p[start-first:])
    return np.concatenate(outputs)

def metrics(y,p,m):
    result={'score':group_error(y,p,m)}
    for name,s in GROUPS.items():
        w=m[:,s];n=max(1,float(w.sum()));truth=y[:,s];pred=p[:,s]
        tm=(truth*w).sum()/n;pm=(pred*w).sum()/n
        # Center each channel over time: fixed left/right differences are not
        # temporal correlation or responsiveness. Constant-channel variance
        # is exactly zero, avoiding float32 summation drift on long sequences.
        tw=truth.astype(np.float64);pw=pred.astype(np.float64);ww=w.astype(np.float64)
        count=np.maximum(1,ww.sum(0));tc=(tw*ww).sum(0)/count;pc=(pw*ww).sum(0)/count
        tv=((tw-tc)**2*ww).sum()/n;pv=((pw-pc)**2*ww).sum()/n
        corr=((tw-tc)*(pw-pc)*ww).sum()/n/np.sqrt(max(1e-12,tv*pv))
        pair=w[1:]*w[:-1];den=max(1,float(pair.sum()))
        td=(np.abs(np.diff(truth,axis=0))*pair).sum()/den
        pd=(np.abs(np.diff(pred,axis=0))*pair).sum()/den
        result[name]={'mse':float(((truth-pred)**2*w).sum()/n),'correlation':float(corr),
            'target_mean':float(tm),'prediction_mean':float(pm),'target_std':float(np.sqrt(tv)),
            'prediction_std':float(np.sqrt(pv)),'variation_ratio':float(np.sqrt(pv/max(1e-12,tv))),
            'mean_abs_target_change':float(td),'mean_abs_prediction_change':float(pd),
            'change_ratio':float(pd/max(1e-12,td)),'valid_fraction':float(w.mean())}
    return result

def design(x,kind,mean,std):
    if kind=='amplitude_only':
        a=x[:,0:1];return np.concatenate([np.ones_like(a),a,a*a,a*a*a],1)
    return np.concatenate([np.ones((len(x),1)),(x-mean)/std],1)

def ridge_predict(x,beta):
    p=np.clip(x@beta,0,1).astype(np.float32)
    p[:,12:]=np.maximum(p[:,12:],1e-6);p[:,12:]/=p[:,12:].sum(1,keepdims=True)
    return p

def fit_ridge(data,kind,mean,std):
    train=[d for d in data if d['split']=='train'];val=[d for d in data if d['split']=='validation']
    x=np.concatenate([design(d['x'],kind,mean,std)[WARM:] for d in train])
    y=np.concatenate([d['y'][WARM:] for d in train]);mask=np.concatenate([d['mask'][WARM:] for d in train])
    best=float('inf')
    for regularization in [.01,1.,100.]:
        beta=np.zeros((x.shape[1],15));penalty=np.eye(x.shape[1])*regularization;penalty[0,0]=0
        for i in range(15):
            w=mask[:,i];beta[:,i]=np.linalg.solve(x.T@(x*w[:,None])+penalty,x.T@(y[:,i]*w))
        score=np.mean([group_error(d['y'][WARM:],ridge_predict(design(d['x'],kind,mean,std),beta)[WARM:],d['mask'][WARM:]) for d in val])
        if score<best:best=score;chosen=beta.copy();reg=regularization
    return chosen,reg

def direct(x):
    # Same scope signal as browser, adapted to this experiment's 15-channel display.
    amplitude,spread,texture,balance,bass,air,attack=[x[:,i] for i in range(7)]
    intensity=np.clip(amplitude+.12*attack,0,1)
    positions=(np.arange(4)+.5)/4
    env=np.exp(-((positions[None,:]-(.5+.36*balance[:,None]))/(.1+.55*spread[:,None]))**2)
    level=intensity[:,None]*(.18+.82*env)
    # Fixed illustrative palette, not learned or inferred fixture color.
    rgb=np.stack([.25+.75*air,.25+.5*texture,.25+.75*bass],1);rgb/=rgb.sum(1,keepdims=True)
    return np.concatenate([np.repeat(intensity[:,None],4,1),np.repeat(spread[:,None],4,1),level,rgb],1).astype(np.float32)

def bootstrap(clips,key):
    sums=[];counts=[]
    for d in clips:
        y=d['y'][WARM:];p=d['pred']['learned'][WARM:];b=d['pred'][key][WARM:];m=d['mask'][WARM:]
        for start in range(0,len(y),600):
            delta=((y[start:start+600]-p[start:start+600])**2-(y[start:start+600]-b[start:start+600])**2)*m[start:start+600]
            sums.append([float(delta[:,s].sum()) for s in GROUPS.values()]);counts.append([float(m[start:start+600,s].sum()) for s in GROUPS.values()])
    sums=np.array(sums);counts=np.array(counts);rng=np.random.default_rng(916)
    ids=rng.integers(len(sums),size=(2000,len(sums)))
    boot=sums[ids].sum(1)/np.maximum(1,counts[ids].sum(1))
    return {name:{'learned_minus_baseline_mse':float(sums[:,i].sum()/max(1,counts[:,i].sum())),
        'ci95':np.quantile(boot[:,i],[.025,.975]).tolist()} for i,name in enumerate(GROUPS)}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='mps');args=ap.parse_args()
    data=load_data();args.out.mkdir(parents=True,exist_ok=False)
    torch.manual_seed(91626);np.random.seed(91626);torch.set_num_threads(4)
    train=[d for d in data if d['split']=='train'];val=[d for d in data if d['split']=='validation']
    allx=np.concatenate([d['x'][WARM:] for d in train]);mean=allx.mean(0);std=np.maximum(allx.std(0),.025)
    ally=np.concatenate([d['y'][WARM:] for d in train]);allm=np.concatenate([d['mask'][WARM:] for d in train])
    prior=(ally*allm).sum(0)/np.maximum(1,allm.sum(0))
    batches=[]
    for d in train:
        starts=sorted(set(list(range(0,len(d['x'])-511,258))+[len(d['x'])-512]))
        for start in starts:
            sl=slice(start,start+512)
            if d['mask'][start+WARM:start+512,:12].mean()<.2:continue
            batches.append((((d['x'][sl]-mean)/std).T,d['y'][sl].T,d['mask'][sl].T))
    bx,by,bm=[torch.from_numpy(np.stack([b[i] for b in batches]).copy()).to(args.device) for i in range(3)]
    model=Model().to(args.device);opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.01)
    best=float('inf');history=[]
    for epoch in range(1,51):
        model.train();losses=[]
        for ids in torch.randperm(len(bx)).split(8):
            p=model(bx[ids]);loss=loss_tensor(by[ids,:,WARM:],p[:,:,WARM:],bm[ids,:,WARM:])
            opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step();losses.append(float(loss.detach().cpu()))
        model.eval();score=float(np.mean([group_error(d['y'][WARM:],infer(model,d['x'],mean,std,args.device)[WARM:],d['mask'][WARM:]) for d in val]))
        history.append({'epoch':epoch,'train_loss':float(np.mean(losses)),'validation_score':score})
        if score<best:best=score;selected=epoch;state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
        print('EPOCH',epoch,'val',round(score,5),flush=True)
    model.load_state_dict(state);model.eval()
    baselines={};regs={}
    for kind in ['amplitude_only','instant_audio']:baselines[kind],regs[kind]=fit_ridge(data,kind,mean,std)
    report={'selected_epoch':selected,'validation_score':best,'clips':{},'test_block_bootstrap':{},'delay_sensitivity':{}}
    for d in data:
        x=d['x'];p=infer(model,x,mean,std,args.device)
        predictions={'learned':p,'train_mean':np.broadcast_to(prior,p.shape).copy(),'direct_scope_adapter':direct(x),
            'wrong_history':infer(model,np.roll(x,170,axis=0),mean,std,args.device)}
        predictions.update({kind:ridge_predict(design(x,kind,mean,std),beta) for kind,beta in baselines.items()})
        d['pred']=predictions
        report['clips'][d['key']]={'split':d['split'],'frames':len(x)-WARM,
            'methods':{name:metrics(d['y'][WARM:],value[WARM:],d['mask'][WARM:]) for name,value in predictions.items()}}
        with (args.out/(d['key']+'.npz')).open('xb') as f:np.savez_compressed(f,time=d['t'],target=d['y'],mask=d['mask'],**predictions)
    test=[d for d in data if d['split']=='test']
    for key in ['train_mean','amplitude_only','instant_audio','wrong_history']:
        report['test_block_bootstrap'][key]=bootstrap(test,key)
    for shift in [-10,-5,-2,0,2,5,10]:
        entries=[]
        for d in test:
            indices=np.arange(WARM+10,len(d['y'])-10)
            entries.append(group_error(d['y'][indices],d['pred']['learned'][indices+shift],d['mask'][indices]))
        report['delay_sensitivity'][str(shift/10)]=float(np.mean(entries))
    x=val[0]['x'][:1200];changed=x.copy();changed[700:]=changed[700:][::-1]
    original=infer(model,x,mean,std,args.device);altered=infer(model,changed,mean,std,args.device)
    report['prefix_max_error']=float(np.max(np.abs(original[:700]-altered[:700])))
    whole=infer(model,x,mean,std,args.device,chunk=10000)
    report['chunk_whole_max_error']=float(np.max(np.abs(original-whole)))
    assert report['prefix_max_error']<1e-6 and report['chunk_whole_max_error']<1e-5
    save(args.out/'evaluation.json',report);save(args.out/'history.json',history)
    save(args.out/'baselines.json',{'prior':prior.tolist(),'weights':{k:v.tolist() for k,v in baselines.items()},'regularization':regs})
    save(args.out/'model.json',{'version':'wide-appearance-tcn-v1','fps':10,'warmup_frames':WARM,'mean':mean.tolist(),'std':std.tolist(),
        'state':{k:v.tolist() for k,v in state.items()},'provenance':'Observed stage appearance; no verified physical light timing or fixture recovery'})
    with (args.out/'checkpoint.pt').open('xb') as f:torch.save(state,f)
    save(args.out/'review.json',json.loads((HERE/'review.json').read_text()))
    save(args.out/'manifest.json',{'seed':91626,'device':args.device,'data':str(ROOT/'dataset_v1'),'audio':str(ROOT/'audio_v1'),
        'grouped_clips':{s:[d['key'] for d in data if d['split']==s] for s in ['train','validation','test']},
        'no_rpmc':True,'fresh_weights':True,'track_overlap':'Unknown across DJ sets; performance/artist grouped',
        'timing':'Audio window ending t paired with video t. Audience acoustic/source A/V delay unresolved.',
        'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'EXPERIMENT.md',HERE/'sources.json',HERE/'review.json',HERE/'extract_video.py',HERE/'pixels.py',HERE/'extract_audio.mjs',HERE.parent.parent/'public/music-features.mjs',HERE.parent.parent/'public/scope-core.mjs']}})
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
