"""Causal current-scope restoration, with a direct residual path and change loss."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np
import torch
from torch import nn
LAGS=[0,1,2,4,8,16,32,64,100]

def save(p,x):
 with p.open('x') as f:json.dump(x,f,indent=2,allow_nan=False)

def examples(root,case,file):
 a=np.loadtxt(root/file,delimiter=',',skiprows=1,dtype=np.float32);ids=np.where(a[:,0]>=case['start'])[0];ids=ids[ids>=100]
 x=np.concatenate([a[ids-l,1:10] for l in LAGS],axis=1);amp=np.stack([a[ids-l,1] for l in LAGS],axis=1)
 return x,amp,a[ids,10:11],a[ids,9:10]

class Residual(nn.Module):
 def __init__(self,n):
  super().__init__();self.layers=nn.Sequential(nn.Linear(n,96),nn.ReLU(),nn.Linear(96,48),nn.ReLU(),nn.Linear(48,1))
  nn.init.zeros_(self.layers[-1].weight);nn.init.zeros_(self.layers[-1].bias)
 def forward(self,x,d):return torch.clamp(d+.5*torch.tanh(self.layers(x)),0,1)
class Amplitude(nn.Module):
 def __init__(self,n):super().__init__();self.layers=nn.Sequential(nn.Linear(n,96),nn.ReLU(),nn.Linear(96,48),nn.ReLU(),nn.Linear(48,1),nn.Sigmoid())
 def forward(self,x,d):return self.layers(x)

def fit(sets,amplitude=False):
 k=1 if amplitude else 0;train=[a for c,condition,a in sets if c['split']=='train'];val=[a for c,condition,a in sets if c['split']=='validation']
 tx=np.concatenate([a[k] for a in train]);ty=np.concatenate([a[2] for a in train]);td=np.concatenate([a[3] for a in train]);mean=tx.mean(0);std=np.maximum(tx.std(0),.025)
 x=torch.from_numpy((tx-mean)/std);y=torch.from_numpy(ty);d=torch.from_numpy(td)
 vx=torch.from_numpy((np.concatenate([a[k] for a in val])-mean)/std);vy=torch.from_numpy(np.concatenate([a[2] for a in val]));vd=torch.from_numpy(np.concatenate([a[3] for a in val]))
 valid=np.ones(len(x),dtype=np.float32);offset=0
 for a in train:valid[offset]=0;offset+=len(a[0])
 mask=torch.from_numpy(valid).reshape(-1,1)
 torch.manual_seed(170926);model=(Amplitude if amplitude else Residual)(x.shape[1]);opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.001)
 best=float('inf');state=None;history=[]
 for epoch in range(1,26):
  model.train()
  for ids in torch.randperm(len(x)).split(1024):
   past=(ids-1).clamp(min=0);p=model(x[ids],d[ids]);pp=model(x[past],d[past]);loss=((p-y[ids])**2).mean()+.25*((((p-pp)-(y[ids]-y[past]))**2)*mask[ids]).mean()
   opt.zero_grad();loss.backward();opt.step()
  model.eval()
  with torch.no_grad():v=model(vx,vd);error=float(((v-vy)**2).mean())
  history.append(error)
  if error<best:best=error;state={k:t.detach().clone() for k,t in model.state_dict().items()};best_epoch=epoch
  if epoch%5==0:print('EPOCH',amplitude,epoch,error,flush=True)
 model.load_state_dict(state);return model,mean,std,history,best_epoch

def prediction(fitted,x,d):
 model,mean,std,_,_=fitted
 with torch.no_grad():return model(torch.from_numpy((x-mean)/std),torch.from_numpy(d)).numpy()

def metric(y,p):
 y=y[:,0];p=p[:,0];dy=np.diff(y);dp=np.diff(p);corr=float(np.corrcoef(dy,dp)[0,1]) if dy.std()>1e-8 and dp.std()>1e-8 else 0.
 events={}
 for label,truth,pred in [('rise',dy>.05,dp>.05),('fall',dy<-.05,dp<-.05)]:events[label]={'precision':float((truth&pred).sum()/max(pred.sum(),1)),'recall':float((truth&pred).sum()/max(truth.sum(),1))}
 return {'mse':float(np.mean((y-p)**2)),'mae':float(np.mean(np.abs(y-p))),'bias':float((p-y).mean()),'std_ratio':float(p.std()/max(y.std(),1e-8)),'delta_std_ratio':float(dp.std()/max(dy.std(),1e-8)),'delta_correlation':corr,**events}

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();args.out.mkdir(exist_ok=False);torch.set_num_threads(4)
 manifest=json.loads((args.data/'manifest.json').read_text());sets=[]
 for c in manifest['cases']:
  for condition,file in zip(manifest['conditions'],c['files']):sets.append((c,condition['name'],examples(args.data,c,file)))
 full=fit(sets);amp=fit(sets,True);mean,std=full[1:3]
 train=[a for c,condition,a in sets if c['split']=='train'];tx=np.concatenate([a[0] for a in train]);ty=np.concatenate([a[2] for a in train]);td=np.concatenate([a[3] for a in train]);aug=np.column_stack([np.ones(len(tx)),(tx-mean)/std]);penalty=np.eye(aug.shape[1])*len(tx)*.01;penalty[0,0]=0;ridge=np.linalg.solve(aug.T@aug+penalty,aug.T@ty)
 report={'cases':{},'history':full[3],'selected_epoch':full[4],'target':'original-recording current scope coverage, soft curve','trained_expression_proven':False,'physical_latency_measured':False,'live_promoted':False}
 for c,condition,(x,a,y,d) in sets:
  p=prediction(full,x,d);preds={'learned':p,'direct':d,'persistence':np.vstack([d[:1],d[:-1]]),'amplitude_only':prediction(amp,a,d),'linear_context':np.clip(np.column_stack([np.ones(len(x)),(x-mean)/std])@ridge,0,1),'wrong_history':prediction(full,np.roll(x,850,axis=0),np.roll(d,850,axis=0))}
  key=f'{c["name"]}_{c["start"]}_{condition}';report['cases'][key]={'split':c['split'],'condition':condition,'metrics':{name:metric(y,v) for name,v in preds.items()}}
  with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,target=y,**preds)
  if c['split']!='train':print('EVAL',key,report['cases'][key]['metrics']['learned'],'direct',report['cases'][key]['metrics']['direct']['mse'],flush=True)
 evaluation=[v for v in report['cases'].values() if v['split'] in ('validation','test','probe')];degraded=[v for v in evaluation if v['condition']!='original'];original=[v for v in evaluation if v['condition']=='original']
 report['gates']={
 'degraded_mse_each':all(v['metrics']['learned']['mse']<.85*v['metrics']['direct']['mse'] for v in degraded),
 'strong_control_average':np.mean([v['metrics']['learned']['mse'] for v in degraded])<=1.1*np.mean([min(v['metrics'][k]['mse'] for k in ['linear_context','amplitude_only']) for v in degraded]),
 'variance_each':all(v['metrics']['learned']['std_ratio']>=.8 for v in degraded),
 'changes_each':all(v['metrics']['learned']['delta_std_ratio']>=.7 and v['metrics']['learned']['delta_correlation']>=.7 for v in degraded),
 'original_path_mae_each':all(v['metrics']['learned']['mae']<=.05 for v in original)}
 zero=np.zeros((1,len(mean)),dtype=np.float32);silence=float(prediction(full,zero,np.zeros((1,1),dtype=np.float32))[0,0]);report['silence_raw_model_output']=silence;report['gates']['silence']=silence<=.001;report['gates']={k:bool(v) for k,v in report['gates'].items()};report['eligible_for_listening_experiment']=all(report['gates'].values())
 layers=[{'weight':l.weight.detach().tolist(),'bias':l.bias.detach().tolist()} for l in full[0].layers if isinstance(l,nn.Linear)]
 save(args.out/'model.json',{'version':'scope-restoration-v1','lags':LAGS,'input_names':['amplitude','spread','texture','balance','bass','air','attack','correlation','observed_brightness'],'mean':mean.tolist(),'std':std.tolist(),'layers':layers,'output':'clamp(observed_brightness + .5*tanh(last_linear),0,1)','live_promoted':False,'selected_epoch':full[4]})
 with (args.out/'checkpoint.pt').open('xb') as f:torch.save(full[0].state_dict(),f)
 save(args.out/'evaluation.json',report);save(args.out/'provenance.json',{'data':str(args.data),'manifest_sha256':hashlib.sha256((args.data/'manifest.json').read_bytes()).hexdigest(),'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'seed':170926,'loss':'MSE + .25 first-difference MSE within each training clip-condition; validation selection MSE'})
 print('GATES',report['gates'],flush=True)
if __name__=='__main__':main()
