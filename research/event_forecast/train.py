from pathlib import Path
import argparse,json,time
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F
BASE=Path('/Volumes/ExtremePro/Code/lightflow/research/scope_foundation/run_2026-09-16_1858')
RECEPTIVE=255;HORIZON=5

def save(path,obj):
 with path.open('x') as f:json.dump(obj,f,indent=2,allow_nan=False)

def average_precision_score(y,p):
 order=np.argsort(-p,kind='stable');y=y[order];p=p[order]
 ends=np.r_[np.flatnonzero(np.diff(p)),len(p)-1]
 tp=np.cumsum(y)[ends];recall=tp/max(float(y.sum()),1)
 return float(np.sum(np.diff(np.r_[0,recall])*tp/(ends+1)))

class TCN(nn.Module):
 def __init__(self):
  super().__init__();self.layers=nn.ModuleList([nn.Conv1d(8 if i==0 else 16,16,3,dilation=2**i) for i in range(7)]);self.head=nn.Conv1d(16,1,1)
 def forward(self,x):
  for i,layer in enumerate(self.layers):x=F.relu(layer(F.pad(x,(2*2**i,0))))
  return self.head(x).squeeze(1)

def labels(a):
 # Acoustic rise peaks relative to the preceding 80 ms trough. NumPy-only to
 # avoid this host's conflicting torch/SciPy OpenMP runtimes.
 attack=a[:,6];candidates=np.flatnonzero((attack[1:-1]>=attack[:-2])&(attack[1:-1]>attack[2:]))+1
 candidates=[i for i in candidates if i>=4 and attack[i]>=.2 and attack[i]-attack[i-4:i].min()>=.08]
 selected=[];occupied=np.zeros(len(a),bool)
 for i in sorted(candidates,key=lambda i:float(attack[i]),reverse=True):
  if not occupied[i]:selected.append(i);occupied[max(0,i-3):i+4]=True
 events=np.array(sorted(selected),int)
 y=np.zeros(len(a),np.float32)
 for event in events:
  for j in range(event-HORIZON-1,event-HORIZON+2):
   if j>=0:y[j]=1
 return events,y

def infer(model,a,mean,std):
 out=[]
 with torch.no_grad():
  for start in range(0,len(a),4096):
   first=max(0,start-254);x=torch.from_numpy(((a[first:start+4096]-mean)/std).T[None].copy())
   p=torch.sigmoid(model(x))[0].numpy();out.append(p[start-first:])
 return np.concatenate(out)

def schedule(p,threshold):
 # Causal rising-edge trigger, with re-arm when score drops below the threshold.
 result=[];armed=True;last=-100
 for i,v in enumerate(p):
  if v<threshold:armed=True
  elif armed and i-last>=5:result.append(i+HORIZON);armed=False;last=i
 return np.array(result,int)

def event_metrics(events,p,threshold,valid_start=254,valid_end=None):
 end=len(p)-6 if valid_end is None else valid_end
 true=events[(events>=valid_start+HORIZON)&(events<end+HORIZON)]
 pred=schedule(p,threshold);pred=pred[(pred>=valid_start+HORIZON)&(pred<end+HORIZON)]
 # Interval tolerance with ordered one-to-one matching; no same event counted twice.
 ti=pi=0;errors=[]
 while ti<len(true) and pi<len(pred):
  delta=pred[pi]-true[ti]
  if abs(delta)<=2:errors.append(delta*20);ti+=1;pi+=1
  elif delta<0:pi+=1
  else:ti+=1
 tp=len(errors);precision=tp/max(len(pred),1);recall=tp/max(len(true),1)
 return {'precision':precision,'recall':recall,'f1':2*precision*recall/max(precision+recall,1e-9),
  'true_events':len(true),'scheduled_events':len(pred),'matched':tp,'false_per_minute':(len(pred)-tp)/max((end-valid_start)/50/60,1e-9),
  'median_abs_error_ms':float(np.median(np.abs(errors))) if errors else None,'mean_signed_error_ms':float(np.mean(errors)) if errors else None}

def repeat_baseline(a):
 # Infer a repeat period using ONLY the preceding 4 s; copy the corresponding
 # earlier event into the 100 ms forecast. Update lag every 0.5 s.
 attack=a[:,6];p=np.zeros(len(a));period=25
 for i in range(200,len(a)):
  if i%25==0:
   w=attack[i-199:i+1];scores=[]
   for lag in range(15,51):
    x=w[lag:];y=w[:-lag];scores.append(np.dot(x,y)/(np.linalg.norm(x)*np.linalg.norm(y)+1e-9))
   period=15+int(np.argmax(scores))
  p[i]=np.max(attack[i+HORIZON-period-1:i+HORIZON-period+2])
 return p

def choose_threshold(events,p):
 results=[(t,event_metrics(events,p,t)) for t in np.arange(.1,.901,.025)]
 return max(results,key=lambda pair:pair[1]['f1'])

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();out=args.out;out.mkdir(parents=True,exist_ok=False)
 torch.set_num_threads(4);torch.manual_seed(171);np.random.seed(171)
 arrays={name:np.loadtxt(BASE/(name+'.csv'),delimiter=',',skiprows=1,dtype=np.float32)[:,1:] for name in ['ultra','forest','calabria','damn_right','mcdonalds']}
 full=arrays['ultra'];split=int(.7*len(full));train=full[:split];val=full[split+500:];mean=train.mean(0);std=np.maximum(train.std(0),.025)
 te,ty=labels(train);ve,vy=labels(val);model=TCN();opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.001)
 tx=torch.from_numpy(((train-mean)/std).T.copy());target=torch.from_numpy(ty)
 starts=np.arange(0,len(train)-1024-6,768);best=-1;history=[]
 for epoch in range(1,19):
  model.train();losses=[]
  for block in np.array_split(np.random.permutation(starts),max(1,len(starts)//12)):
   x=torch.stack([tx[:,s:s+1024] for s in block]);y=torch.stack([target[s:s+1024] for s in block])
   logits=model(x)[:,254:];loss=F.binary_cross_entropy_with_logits(logits,y[:,254:]);opt.zero_grad();loss.backward();torch.nn.utils.clip_grad_norm_(model.parameters(),1);opt.step();losses.append(float(loss.detach()))
  model.eval();vp=infer(model,val,mean,std);ap=average_precision_score(vy[254:-6],vp[254:-6])
  row={'epoch':epoch,'loss':float(np.mean(losses)),'validation_average_precision':float(ap)};history.append(row)
  if ap>best:best=ap;best_epoch=epoch;state={k:v.detach().clone() for k,v in model.state_dict().items()}
  print('EPOCH',epoch,'AP',round(ap,4),flush=True)
 model.load_state_dict(state);model.eval();vp=infer(model,val,mean,std);threshold,vm=choose_threshold(ve,vp)
 bp=repeat_baseline(val);bt,bm=choose_threshold(ve,bp)
 report={'selected_epoch':best_epoch,'threshold':float(threshold),'repeat_threshold':float(bt),'validation':{'learned':vm,'repeat':bm,'average_precision':best,'positive_fraction':float(vy[254:-6].mean())},'held_out':{}}
 for name,a in arrays.items():
  if name=='ultra':continue
  events,y=labels(a);pred=infer(model,a,mean,std);baseline=repeat_baseline(a);wrong=np.roll(pred,850)
  report['held_out'][name]={'learned':event_metrics(events,pred,threshold),'repeat':event_metrics(events,baseline,bt),'wrong_history':event_metrics(events,wrong,threshold),'average_precision':float(average_precision_score(y[254:-6],pred[254:-6])),'positive_fraction':float(y[254:-6].mean())}
  with (out/(name+'_predictions.npz')).open('xb') as f:np.savez_compressed(f,prediction=pred,repeat=baseline,event_frames=events)
 # Prefix invariance on a fresh copy, including the full finite convolution context.
 prefix=arrays['forest'][:700].copy();changed=prefix.copy();changed[500:]=np.flip(changed[500:],axis=0)*.4
 pp=infer(model,prefix,mean,std);cp=infer(model,changed,mean,std);error=float(np.max(np.abs(pp[:500]-cp[:500])));assert error<1e-7
 report['prefix_invariance_max_error']=error
 export={'version':'event-tcn-v1','fps':50,'receptive_frames':255,'horizon_frames':5,'threshold':float(threshold),'mean':mean.tolist(),'std':std.tolist(),
  'layers':[{'dilation':2**i,'weight':layer.weight.detach().tolist(),'bias':layer.bias.detach().tolist()} for i,layer in enumerate(model.layers)],'head':{'weight':model.head.weight.detach().tolist(),'bias':model.head.bias.detach().tolist()},'target_provenance':'heuristic audio attack events, NOT authored light cues'}
 save(out/'model.json',export);save(out/'evaluation.json',report);save(out/'history.json',history)
 with (out/'checkpoint.pt').open('xb') as f:torch.save(model.state_dict(),f)
 save(out/'manifest.json',{'source_features':str(BASE),'split':'Ultra first70% train;10s purge;remaining validate;others heldout','no_rpmc':True,'started_at':time.time(),'model':'seven left-padded dilated Conv1d layers,16 channels','target':'attack peaks≥.2 with rise≥.08 over preceding80ms trough, separated80ms; predict80–120ms ahead','selected_epoch':best_epoch})
 save(out/'parity_cases.json',{'input':prefix[:350].tolist(),'expected':pp[:350].tolist()})
 print('COMPLETE',out,json.dumps(report),flush=True)
if __name__=='__main__':main()
