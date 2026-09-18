"""Conditional scope forecast research. Never promotes a model from MSE alone."""
from pathlib import Path
import argparse,json,hashlib,time
import numpy as np
import torch
from torch import nn
LAGS=[0,1,2,4,8,16,32,64,100]
HORIZONS=[2,5,13]

def save(path,obj):
 with path.open('x') as f:json.dump(obj,f,indent=2,allow_nan=False)

def examples(case,root):
 a=np.loadtxt(root/case['filename'],delimiter=',',skiprows=1,dtype=np.float32)
 idx=np.where((a[:,0]>=case['start'])&(a[:,0]<=case['start']+case['duration']-.28))[0]
 idx=idx[idx>=max(LAGS)]
 # Feature columns 1:9 = eight scope descriptors; column 9 = scalar coverage brightness.
 x=np.concatenate([a[idx-l,1:10] for l in LAGS],axis=1)
 amp=np.stack([a[idx-l,1] for l in LAGS],axis=1)
 y=np.stack([a[idx+h,9] for h in HORIZONS],axis=1)
 direct=np.repeat(a[idx,9:10],3,axis=1)
 return x,amp,y,direct

def metrics(y,p,direct):
 mse=((y-p)**2).mean(0);truth_delta=np.diff(y,axis=0);pred_delta=np.diff(p,axis=0)
 # Event forecasts: a >= .10 brightness change from the currently available scope value.
 truth=(y-direct)>=.10;pred=(p-direct)>=.10
 return {'mse':mse.tolist(),'mae':np.abs(y-p).mean(0).tolist(),'std_ratio':(p.std(0)/np.maximum(y.std(0),1e-6)).tolist(),'delta_std_ratio':(pred_delta.std(0)/np.maximum(truth_delta.std(0),1e-6)).tolist(),'rise_precision':((truth&pred).sum(0)/np.maximum(pred.sum(0),1)).tolist(),'rise_recall':((truth&pred).sum(0)/np.maximum(truth.sum(0),1)).tolist(),'true_rise_fraction':truth.mean(0).tolist(),'predicted_rise_fraction':pred.mean(0).tolist()}

def fit(tx,ty,vx,vy,seed):
 torch.manual_seed(seed);mean=tx.mean(0);std=np.maximum(tx.std(0),.025)
 x=torch.from_numpy((tx-mean)/std);y=torch.from_numpy(ty);v=torch.from_numpy((vx-mean)/std)
 model=nn.Sequential(nn.Linear(tx.shape[1],96),nn.ReLU(),nn.Linear(96,48),nn.ReLU(),nn.Linear(48,3),nn.Sigmoid())
 opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.001)
 best=float('inf');saved=None;history=[]
 for epoch in range(1,26):
  model.train()
  for ids in torch.randperm(len(x)).split(512):
   p=model(x[ids]);loss=((p-y[ids])**2).mean();opt.zero_grad();loss.backward();opt.step()
  model.eval()
  with torch.no_grad():loss=float(((model(v)-torch.from_numpy(vy))**2).mean())
  history.append(loss)
  if loss<best:best=loss;saved={k:t.detach().clone() for k,t in model.state_dict().items()};best_epoch=epoch
  if epoch%5==0:print('EPOCH',tx.shape[1],epoch,loss,flush=True)
 model.load_state_dict(saved);return model,mean,std,history,best_epoch

def predict(fitted,x):
 model,mean,std,_,_=fitted
 with torch.no_grad():return model(torch.from_numpy((x-mean)/std)).numpy()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
 args.out.mkdir(exist_ok=False);torch.set_num_threads(4)
 manifest=json.loads((args.data/'manifest.json').read_text());sets=[(c,examples(c,args.data)) for c in manifest['cases']]
 tx,ta,ty,tb=[np.concatenate([a[k] for c,a in sets if c['split']=='train']) for k in range(4)]
 vx,va,vy,vb=[np.concatenate([a[k] for c,a in sets if c['split']=='validation']) for k in range(4)]
 fitted=fit(tx,ty,vx,vy,170926);amplitude=fit(ta,ty,va,vy,170926)
 mean,std=fitted[1:3];aug=np.column_stack([np.ones(len(tx)),(tx-mean)/std]);penalty=np.eye(aug.shape[1])*len(tx)*.01;penalty[0,0]=0
 ridge=np.linalg.solve(aug.T@aug+penalty,aug.T@ty)
 report={'cases':{},'training_frames':len(tx),'validation_frames':len(vx),'selected_epoch':fitted[4],'history':fitted[3],'target_approval':False,'live_promoted':False,'physical_latency_measured':False,'learned_musical_judgment_proven':False}
 for c,(x,a,y,d) in sets:
  p=predict(fitted,x);preds={'learned':p,'persistence':d,'training_mean':np.broadcast_to(ty.mean(0),y.shape),'linear_history':np.clip(np.column_stack([np.ones(len(x)),(x-mean)/std])@ridge,0,1),'amplitude_only':predict(amplitude,a),'wrong_history':predict(fitted,np.roll(x,850,axis=0))}
  key=c['filename'].removesuffix('.csv');report['cases'][key]={'split':c['split'],'metrics':{k:metrics(y,v,d) for k,v in preds.items()}}
  # Block resampling of per-frame squared-error benefit. Diagnostic only; two minute clips are short.
  gain=(y-d)**2-(y-p)**2;blocks=np.array([gain[i:i+250].mean(0) for i in range(0,len(gain)-249,250)])
  rng=np.random.default_rng(20260917);boot=blocks[rng.integers(0,len(blocks),(2000,len(blocks)))].mean(1)
  report['cases'][key]['mse_benefit_vs_persistence_5s_block_ci95']=np.quantile(boot,[.025,.975],axis=0).tolist()
  with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,target=y,**preds)
  print('EVAL',key,'learned',np.mean((y-p)**2,0),'direct',np.mean((y-d)**2,0),flush=True)
 # Every transfer clip must preserve variation and improve prediction, including vs simple history.
 evaluation=[v for v in report['cases'].values() if v['split'] in ('validation','test')]
 gates=[]
 for h in range(3):
  gates.append(all(v['metrics']['learned']['mse'][h]<.95*min(v['metrics'][b]['mse'][h] for b in ('persistence','linear_history','wrong_history','amplitude_only')) and .8<=v['metrics']['learned']['std_ratio'][h]<=1.2 and v['metrics']['learned']['delta_std_ratio'][h]>=.7 for v in evaluation))
 report['forecast_diagnostic_gate']=gates
 report['interpretation']='Passing a diagnostic gate is not musical approval. No model is promoted automatically.'
 layers=[{'weight':l.weight.detach().tolist(),'bias':l.bias.detach().tolist()} for l in fitted[0] if isinstance(l,nn.Linear)]
 save(args.out/'model.json',{'version':'scope-brightness-forecast-v1','input_names':['amplitude','spread','texture','balance','bass','air','attack','correlation','brightness'],'lags':LAGS,'horizons_ms':[40,100,260],'mean':mean.tolist(),'std':std.tolist(),'layers':layers,'live_promoted':False})
 with (args.out/'checkpoint.pt').open('xb') as f:torch.save(fitted[0].state_dict(),f)
 save(args.out/'evaluation.json',report);save(args.out/'provenance.json',{'data':str(args.data),'manifest_sha256':hashlib.sha256((args.data/'manifest.json').read_bytes()).hexdigest(),'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'seed':170926,'completed':time.time(),'target':'future direct scope coverage; not human musical direction'})
 print('DIAGNOSTIC GATES',gates,flush=True)
if __name__=='__main__':main()
