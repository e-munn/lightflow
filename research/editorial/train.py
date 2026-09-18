"""Audio-only editorial pacing hypothesis. Does not learn fixture commands."""
from pathlib import Path
import argparse,json,time,hashlib
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
from rhythm import rhythm_features
from targets import editorial_targets
AUDIO=Path('/Volumes/ExtremePro/Code/lightflow/research/editorial/audio_features_v1')
CUTS=Path('/Volumes/ExtremePro/Code/lightflow/research/concert_cues')
SCANS={'levity':'transnet_levity_full_gpu_v1','whethan':'transnet_whethan_full_gpu_v1','rezz':'transnet_rezz_full_gpu_v1','skrillex_chile':'transnet_skrillex_chile_full_gpu_v1'}
NAMES=['cut_0.2_to_1.0s','cut_1_to_3s','hold_next_5s']
REVIEW=Path(__file__).with_name('label_review.json')

def save(path,obj):
 with path.open('x') as f:json.dump(obj,f,indent=2,allow_nan=False)

def ap(y,p):
 order=np.argsort(-p,kind='stable');y=y[order];p=p[order];ends=np.r_[np.flatnonzero(np.diff(p)),len(p)-1]
 tp=np.cumsum(y)[ends];recall=tp/max(float(y.sum()),1)
 return float(np.sum(np.diff(np.r_[0,recall])*tp/(ends+1)))

class TCN(nn.Module):
 def __init__(self):
  super().__init__();self.layers=nn.ModuleList([nn.Conv1d(16,16,3,dilation=2**i) for i in range(6)]);self.head=nn.Conv1d(16,3,1)
 def forward(self,x):
  for i,layer in enumerate(self.layers):x=F.relu(layer(F.pad(x,(2*2**i,0))))
  return self.head(x)

def dataset(name):
 csv=np.loadtxt(AUDIO/(name+'.csv'),delimiter=',',skiprows=1,dtype=np.float32)
 scan=json.loads((CUTS/SCANS[name]/'boundaries.json').read_text())
 uncertain=json.loads(REVIEW.read_text())['uncertain_boundary_indices'][name]
 for index in uncertain:scan['boundaries'][index]['editorial_status']='uncertain'
 n=min(len(csv)//10,int(scan['duration']*5))
 blocks=csv[:n*10,1:].reshape(n,10,8);x=np.concatenate([blocks.mean(1),blocks.max(1)],1)
 t=csv[9:n*10:10,0].astype(np.float64)
 assert scan['source_start']==0, 'Nonzero source offsets must be explicitly aligned'
 y,mask=editorial_targets(t,scan['boundaries'])
 rhythm=rhythm_features(csv[:n*10,7])
 return x[:-25],y[:-25],t[:-25],scan,rhythm[:-25],mask[:-25]

def infer(model,x,mean,std,device):
 output=[]
 with torch.no_grad():
  for start in range(0,len(x),2048):
   first=max(0,start-126);a=torch.from_numpy(((x[first:start+2048]-mean)/std).T[None].copy()).to(device)
   p=torch.sigmoid(model(a))[0].T.cpu().numpy();output.append(p[start-first:])
 return np.concatenate(output)

def metrics(y,p,mask):
 result={}
 for i,name in enumerate(NAMES):
  valid=mask[:,i]>0;truth=y[valid,i];pred=p[valid,i]
  result[name]={'ap':ap(truth,pred),'prevalence':float(truth.mean()),'brier':float(np.mean((truth-pred)**2)),
   'prediction_mean':float(pred.mean()),'prediction_std':float(pred.std()),'valid_frames':int(valid.sum()),'coverage':float(valid.mean())}
 return result

def brier_score(y,p,mask):return float(np.sum((y-p)**2*mask)/max(1,mask.sum()))

def paired_block_brier(y,p,baseline,mask):
 # Resample 60-second blocks, not individual correlated video frames.
 rng=np.random.default_rng(9172026);delta=((y-p)**2-(y-baseline)**2)*mask
 blocks=[(delta[i:i+300].sum(0),mask[i:i+300].sum(0)) for i in range(0,len(y),300)]
 sums=np.array([b[0] for b in blocks]);counts=np.array([b[1] for b in blocks])
 samples=rng.integers(0,len(blocks),(2000,len(blocks)))
 boot=sums[samples].sum(1)/np.maximum(1,counts[samples].sum(1))
 return {name:{'learned_minus_baseline':float(delta[:,i].sum()/max(1,mask[:,i].sum())),
               'ci95':np.quantile(boot[:,i],[.025,.975]).tolist(),'block_seconds':60,'bootstrap_samples':2000}
         for i,name in enumerate(NAMES)}

def fit_logistic(x,y,mask,vx,vy,vmask,device):
 model=nn.Linear(x.shape[1],3).to(device);optimizer=torch.optim.Adam(model.parameters(),lr=.025)
 tx=torch.from_numpy(x.copy()).to(device);ty=torch.from_numpy(y.copy()).to(device)
 tm=torch.from_numpy(mask.copy()).to(device)
 validation=torch.from_numpy(vx.copy()).to(device);best=float('inf')
 for epoch in range(300):
  loss=(F.binary_cross_entropy_with_logits(model(tx),ty,reduction='none')*tm).sum()/tm.sum();optimizer.zero_grad();loss.backward();optimizer.step()
  with torch.no_grad():p=torch.sigmoid(model(validation)).cpu().numpy()
  brier=brier_score(vy[126:],p[126:],vmask[126:])
  if brier<best:best=brier;state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
 model.load_state_dict(state);return model

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);parser.add_argument('--device',default='mps');args=parser.parse_args()
 # Check that all source artifacts exist before claiming a run directory.
 data={name:dataset(name) for name in SCANS};out=args.out;out.mkdir(parents=True,exist_ok=False)
 torch.manual_seed(190916);np.random.seed(190916);torch.set_num_threads(4);device=args.device
 train=np.concatenate([data[n][0] for n in ['levity','whethan']]);mean=train.mean(0);std=np.maximum(train.std(0),.025)
 ys=np.concatenate([data[n][1] for n in ['levity','whethan']]);masks=np.concatenate([data[n][5] for n in ['levity','whethan']]);prior=(ys*masks).sum(0)/masks.sum(0)
 model=TCN().to(device);opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.01)
 batches=[]
 for name in ['levity','whethan']:
  x,y,_,_,_,mask=data[name]
  for start in range(0,len(x)-512,386):
   batches.append((torch.from_numpy(((x[start:start+512]-mean)/std).T.copy()),torch.from_numpy(y[start:start+512].T.copy()),torch.from_numpy(mask[start:start+512].T.copy())))
 bx=torch.stack([b[0] for b in batches]).to(device);by=torch.stack([b[1] for b in batches]).to(device);bm=torch.stack([b[2] for b in batches]).to(device)
 vx,vy,_,_,vrhythm,vmask=data['rezz'];history=[];best=float('inf')
 for epoch in range(1,31):
  model.train();losses=[]
  for ids in torch.randperm(len(bx)).split(8):
   logits=model(bx[ids]);mask=bm[ids,:,126:];loss=(F.binary_cross_entropy_with_logits(logits[:,:,126:],by[ids,:,126:],reduction='none')*mask).sum()/mask.sum();opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step();losses.append(float(loss.detach().cpu()))
  model.eval();p=infer(model,vx,mean,std,device);brier=brier_score(vy[126:],p[126:],vmask[126:])
  history.append({'epoch':epoch,'train_loss':float(np.mean(losses)),'validation_brier':brier})
  if brier<best:best=brier;best_epoch=epoch;state={k:v.detach().cpu().clone() for k,v in model.state_dict().items()}
  print('EPOCH',epoch,'validation Brier',round(brier,5),flush=True)
 model.load_state_dict(state);model.eval()
 # Comparator checkpoints are also selected by validation Brier, never the test show.
 energy=fit_logistic(train[:,0:1],ys,masks,vx[:,0:1],vy,vmask,device)
 trainrhythm=np.concatenate([data[n][4] for n in ['levity','whethan']])
 tempo=fit_logistic(trainrhythm,ys,masks,vrhythm,vy,vmask,device)
 report={'selected_epoch':best_epoch,'targets':NAMES,'splits':{'train':['levity','whethan'],'validation':['rezz'],'test':['skrillex_chile']},'sources':{}}
 for name,(x,y,t,scan,rhythm,mask) in data.items():
  p=infer(model,x,mean,std,device)
  with torch.no_grad():
   e=torch.sigmoid(energy(torch.from_numpy(x[:,0:1]).to(device))).cpu().numpy()
   beat=torch.sigmoid(tempo(torch.from_numpy(rhythm).to(device))).cpu().numpy()
  report['sources'][name]={'cut_candidates':len(scan['boundaries']),'strong_candidates':sum(b['probability']>=.9 and b.get('editorial_status')!='uncertain' for b in scan['boundaries']),'frames':len(x)-126,'learned':metrics(y[126:],p[126:],mask[126:]),'train_prior':metrics(y[126:],np.broadcast_to(prior,p.shape)[126:],mask[126:]),'amplitude_only':metrics(y[126:],e[126:],mask[126:]),'tempo_phase':metrics(y[126:],beat[126:],mask[126:]),'wrong_history':metrics(y[126:],np.roll(p,85,axis=0)[126:],mask[126:])}
  if name=='skrillex_chile':
   report['sources'][name]['paired_block_brier']={key:paired_block_brier(y[126:],p[126:],base[126:],mask[126:]) for key,base in {'train_prior':np.broadcast_to(prior,p.shape),'amplitude_only':e,'tempo_phase':beat,'wrong_history':np.roll(p,85,axis=0)}.items()}
  with (out/(name+'_predictions.npz')).open('xb') as f:np.savez_compressed(f,time=t,learned=p,target=y,mask=mask,amplitude_only=e,tempo_phase=beat)
 x=data['rezz'][0][:500];changed=x.copy();changed[300:]=np.flip(changed[300:],axis=0)
 a=infer(model,x,mean,std,device);b=infer(model,changed,mean,std,device);report['prefix_max_error']=float(np.max(np.abs(a[:300]-b[:300])));assert report['prefix_max_error']<1e-6
 export={'version':'editorial-tcn-v1','fps':5,'receptive_frames':127,'heads':NAMES,'mean':mean.tolist(),'std':std.tolist(),
  'layers':[{'dilation':2**i,'weight':l.weight.detach().cpu().tolist(),'bias':l.bias.detach().cpu().tolist()} for i,l in enumerate(model.layers)],'head':{'weight':model.head.weight.detach().cpu().tolist(),'bias':model.head.bias.detach().cpu().tolist()},'target_provenance':'inferred editorial cuts and holds, NOT lighting commands'}
 save(out/'model.json',export);save(out/'evaluation.json',report);save(out/'history.json',history)
 save(out/'baselines.json',{'prior':prior.tolist(),'amplitude_only':{k:v.detach().cpu().tolist() for k,v in energy.state_dict().items()},'tempo_phase':{k:v.detach().cpu().tolist() for k,v in tempo.state_dict().items()},'tempo_definition':'Past 16 s onset autocorrelation,60–200 BPM,periodicity and two phase harmonics; simple comparator,not robust beat tracking'})
 with (out/'checkpoint.pt').open('xb') as f:torch.save(state,f)
 save(out/'parity_cases.json',{'input':x[:300].tolist(),'expected':a[:300].tolist()})
 save(out/'label_review.json',json.loads(REVIEW.read_text()))
 save(out/'manifest.json',{'audio_features':str(AUDIO),'cut_sources':{n:str(CUTS/p) for n,p in SCANS.items()},'target_provenance':'weak inferred camera editing from TransNet V2; not ground truth','target_rule':'p>=.9 strong unless reviewed uncertain; .5<=p<.9 uncertain and masks negative/hold claims; undetected cuts remain possible','review_sha256':hashlib.sha256(REVIEW.read_bytes()).hexdigest(),'code_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),Path(__file__).with_name('targets.py'),Path(__file__).with_name('rhythm.py')]},'model':'causal TCN,25.4s context,5Hz,3 probability heads','seed':190916,'device':device,'no_rpmc':True,'split':report['splits'],'track_overlap':'unknown; show/artist separated only'})
 print('COMPLETE',out,flush=True)
if __name__=='__main__':main()
