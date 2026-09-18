"""Fresh causal audio forecast. Artifacts exclusively on the external drive."""
from pathlib import Path
import argparse, json, subprocess, hashlib, time
import numpy as np
import torch
from torch import nn
ROOT=Path(__file__).resolve().parents[2]
AUDIO=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26')
LAGS=[0,1,2,4,8,16,25,50,100]; TARGETS=[0,1,2,6]; HORIZONS=[5,13]
SOURCES={
 'ultra':AUDIO/'of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a',
 'forest':AUDIO/'of_the_trees_electric_forest_-eVk7dh8dO4.m4a',
 'calabria':ROOT/'public/songs/calabria_-_austin_marc.mp3',
 'damn_right':ROOT/'public/songs/damn_right_-_audrey_nuna.mp3',
 'mcdonalds':ROOT/'public/songs/mcdonalds.mp3'}

def save(path,data):
 with path.open('x') as f:json.dump(data,f,indent=2,allow_nan=False)

def dataset(a,start=0,end=None,stride=1):
 end=len(a) if end is None else end
 ids=np.arange(max(start+100,100),end-13,stride)
 x=np.concatenate([a[ids-lag] for lag in LAGS],axis=1)
 y=np.concatenate([a[ids+h][:,TARGETS] for h in HORIZONS],axis=1)
 baseline=np.tile(a[ids][:,TARGETS],(1,2))
 return x,y,baseline

def metrics(y,p):
 mse=np.mean((y-p)**2,axis=0)
 attacks=[]
 for idx in [3,7]:
  yes=y[:,idx]>=.2;pred=p[:,idx]>=.2
  attacks.append({'horizon_frames':HORIZONS[idx//4], 'threshold':.2,
   'precision':float(np.sum(yes&pred)/max(1,pred.sum())),
   'recall':float(np.sum(yes&pred)/max(1,yes.sum())),
   'predicted_fraction':float(pred.mean()),'actual_fraction':float(yes.mean())})
 return {'mse_per_channel':mse.tolist(),'mean_mse':float(mse.mean()),'attack':attacks,
         'std_per_channel':p.std(0).tolist()}

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args()
 out=args.out;out.mkdir(parents=True,exist_ok=False)
 torch.set_num_threads(4);torch.manual_seed(160926);np.random.seed(160926)
 manifest={'experiment':'scope-causal-v1','started_at':time.time(),'seed':160926,'sources':{},
   'target_provenance':'Computed future audio descriptors; not human-authored light cues',
   'exclusion':'No RPMC-L2 data, labels or checkpoints',
   'rights':'User-provided local research references; no publication permission inferred',
   'split':'Ultra first 70% train, 10 s purge, remaining Ultra validation. Other sources test only.',
   'track_overlap':'Track identity across shows unknown; not proven track-disjoint.'}
 arrays={}
 for name,path in SOURCES.items():
  print('EXTRACT',name,flush=True)
  dest=out/(name+'.csv')
  subprocess.run(['node',str(ROOT/'research/scope_foundation/extract.mjs'),str(path),str(dest)],check=True)
  arrays[name]=np.loadtxt(dest,delimiter=',',skiprows=1,dtype=np.float32)[:,1:]
  manifest['sources'][name]={'path':str(path),'sha256':hashlib.file_digest(path.open('rb'),'sha256').hexdigest(),'frames':len(arrays[name])}
 save(out/'manifest.json',manifest)
 a=arrays['ultra'];split=int(len(a)*.7)
 tx,ty,tb=dataset(a,end=split,stride=2);vx,vy,vb=dataset(a,start=split+500)
 mean=tx.mean(0);std=np.maximum(tx.std(0),.025)
 x=torch.from_numpy((tx-mean)/std);y=torch.from_numpy(ty)
 v=torch.from_numpy((vx-mean)/std)
 model=nn.Sequential(nn.Linear(72,64),nn.ReLU(),nn.Linear(64,32),nn.ReLU(),nn.Linear(32,8),nn.Sigmoid())
 opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
 # Scale channels using TRAIN target variance, capped to avoid unstable weights.
 scale=torch.from_numpy(np.maximum(ty.var(0),.01))
 baseline_loss=float(np.mean((vy-vb)**2/scale.numpy()))
 best=float('inf');best_state=None;history=[]
 for epoch in range(1,21):
  model.train();losses=[]
  for ids in torch.randperm(len(x)).split(1024):
   pred=model(x[ids]);loss=((pred-y[ids])**2/scale).mean()
   opt.zero_grad();loss.backward();opt.step();losses.append(float(loss.detach()))
  model.eval()
  with torch.no_grad():vp=model(v).numpy()
  loss=float(np.mean((vp-vy)**2/scale.numpy()))
  history.append({'epoch':epoch,'train_loss':float(np.mean(losses)),'validation_scaled_mse':loss})
  if loss<best:best=loss;best_state={k:v.detach().clone() for k,v in model.state_dict().items()};best_epoch=epoch
  print('EPOCH',epoch,'validation',round(loss,4),'persistence',round(baseline_loss,4),flush=True)
 model.load_state_dict(best_state);model.eval()
 with torch.no_grad():vp=model(v).numpy()
 accepted=(np.mean((vp-vy)**2,0)<np.mean((vb-vy)**2,0)*.95).tolist()
 layers=[{'weight':layer.weight.detach().tolist(),'bias':layer.bias.detach().tolist()} for layer in model if isinstance(layer,nn.Linear)]
 export={'version':'scope-causal-v1','fps':50,'lags':LAGS,'horizons':HORIZONS,
   'target_names':[f'{name}_{h*20}ms' for h in HORIZONS for name in ['amplitude','spread','texture','attack']],
   'mean':mean.tolist(),'std':std.tolist(),'layers':layers,'accepted_channels':accepted,
   'selected_epoch':best_epoch,'target_provenance':manifest['target_provenance']}
 save(out/'model.json',export)
 with (out/'checkpoint.pt').open('xb') as f:torch.save(model.state_dict(),f)
 report={'selected_epoch':best_epoch,'validation':{'learned':metrics(vy,vp),'persistence':metrics(vy,vb)},
   'accepted_channels_validation':accepted,'train_frames':len(tx),'validation_frames':len(vx),'held_out':{}}
 mean_target=ty.mean(0)
 for name,a in arrays.items():
  if name=='ultra':continue
  ex,ey,eb=dataset(a,stride=2)
  with torch.no_grad():ep=model(torch.from_numpy((ex-mean)/std)).numpy()
  # Shift predicted trajectories by 17 seconds: destroys synchronized conditioning.
  wrong=np.roll(ep,425,axis=0)
  report['held_out'][name]={'frames':len(ex),'learned':metrics(ey,ep),'persistence':metrics(ey,eb),
   'train_mean':metrics(ey,np.broadcast_to(mean_target,ey.shape)), 'wrong_history':metrics(ey,wrong)}
  if name=='forest':save(out/'parity_cases.json',{'inputs':ex[:30].tolist(),'expected':ep[:30].tolist()})
 save(out/'evaluation.json',report);save(out/'history.json',history)
 (out/'SOURCES.md').write_text('# Causal scope foundation\n\nSee manifest.json for source hashes and split. Audio descriptors only, not choreography labels. No RPMC-L2 used. Original media remains untouched.\n')
 print('COMPLETE',out,flush=True)
 print(json.dumps({'accepted':accepted,'selected_epoch':best_epoch,'held_out':{k:{m:round(v[m]['mean_mse'],5) for m in ['learned','persistence','train_mean','wrong_history']} for k,v in report['held_out'].items()}}),flush=True)
if __name__=='__main__':main()
