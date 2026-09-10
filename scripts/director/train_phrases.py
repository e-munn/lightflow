"""Experimental audio-conditioned lighting phrase vocabulary.
Learn prototypes from TRAIN clips only. Predict a two-second phrase from
12 seconds of past audio. Compare against train-prior predictions on VAL.
Held-out test is not used for model selection.
"""
from train_concert import OUT,Windows
import numpy as np,torch,json,time
from torch import nn
from torch.utils.data import DataLoader,Dataset
from sklearn.cluster import MiniBatchKMeans
from pathlib import Path

class PhraseDirector(nn.Module):
 def __init__(self):
  super().__init__();self.net=nn.Sequential(nn.Conv1d(128,64,5,stride=2),nn.GELU(),nn.Conv1d(64,64,5,stride=2),nn.GELU(),nn.Conv1d(64,64,5,stride=2),nn.GELU());self.head=nn.Sequential(nn.Linear(128,96),nn.GELU(),nn.Dropout(.3),nn.Linear(96,24))
 def forward(self,x):
  h=self.net(x);return self.head(torch.cat([h[:,:,-1],h.mean(-1)],-1))

class Phrases(Dataset):
 def __init__(self,data,split):
  self.x=data['x'];self.y=data['y'];self.index=[];offset=0
  import hashlib
  for n,k in zip(data['lengths'],data['ids']):
   bucket=int(hashlib.sha256(str(k).encode()).hexdigest()[:8],16)%10;part='test' if bucket==0 else 'val' if bucket==1 else 'train'
   if part==split:self.index.extend(range(offset+95,offset+int(n)-16,8))
   offset+=int(n)
  # Four half-second keyframes keep time structure rather than a single mean.
  self.phrases=np.stack([self.y[k:k+16].reshape(4,4,7).mean(1).reshape(-1) for k in self.index]);self.labels=None
 def __len__(self):return len(self.index)
 def __getitem__(self,i):
  k=self.index[i];return torch.from_numpy(self.x[:,k-95:k+1].copy()),int(self.labels[i])

def main():
 torch.set_num_threads(4);torch.manual_seed(43);np.random.seed(43)
 data=np.load(OUT/'concert.npz');train=Phrases(data,'train');val=Phrases(data,'val');test=Phrases(data,'test')
 scale=np.tile([2,1,.7,1,1,.7,.7],4).astype('float32')
 km=MiniBatchKMeans(n_clusters=24,random_state=43,n_init=5,batch_size=2048);train.labels=km.fit_predict(train.phrases*scale);val.labels=km.predict(val.phrases*scale);test.labels=km.predict(test.phrases*scale)
 prototypes=(km.cluster_centers_/scale).reshape(24,4,7)
 np.savez_compressed(OUT/'phrases.npz',prototypes=prototypes,train_labels=train.labels,val_labels=val.labels)
 prior=np.bincount(train.labels,minlength=24).astype(float);prior/=prior.sum();base_ce=float(-np.log(prior[val.labels]).mean());base_acc=float(np.mean(val.labels==prior.argmax()))
 model=PhraseDirector();opt=torch.optim.AdamW(model.parameters(),lr=.0003,weight_decay=.03);best=float('inf');history=[]
 tl=DataLoader(train,batch_size=128,shuffle=True);vl=DataLoader(val,batch_size=256)
 for epoch in range(16):
  t=time.time();model.train();losses=[]
  for x,y in tl:
   # Level augmentation discourages memorizing recording gain.
   x=x+torch.randn(x.shape[0],1,1)*.06;p=model(x);loss=nn.functional.cross_entropy(p,y,label_smoothing=.08);opt.zero_grad();loss.backward();opt.step();losses.append(loss.item())
  model.eval();ps=[];ys=[]
  with torch.no_grad():
   for x,y in vl:ps.append(model(x));ys.append(y)
  p=torch.cat(ps);y=torch.cat(ys);ce=float(nn.functional.cross_entropy(p,y));acc=float((p.argmax(-1)==y).float().mean());entry={'epoch':epoch+1,'train_ce':float(np.mean(losses)),'val_ce':ce,'val_accuracy':acc,'prior_ce':base_ce,'majority_accuracy':base_acc,'seconds':time.time()-t};history.append(entry);print(json.dumps(entry),flush=True)
  (OUT/'phrase-history.json').write_text(json.dumps(history,indent=2))
  if ce<best:best=ce;torch.save({'model':model.state_dict(),'epoch':epoch+1,'metrics':entry},OUT/'phrase.pt')
 model.load_state_dict(torch.load(OUT/'phrase.pt',weights_only=True)['model']);model.eval()
 with torch.no_grad():
  ps=[];ys=[]
  for x,y in DataLoader(test,batch_size=256):ps.append(model(x));ys.append(y)
  p=torch.cat(ps);y=torch.cat(ys);report={'test_ce':float(nn.functional.cross_entropy(p,y)),'prior_ce':float(-np.log(prior[test.labels]).mean()),'accuracy':float((p.argmax(-1)==y).float().mean()),'majority_accuracy':float(np.mean(test.labels==prior.argmax()))}
 (OUT/'phrase-evaluation.json').write_text(json.dumps(report,indent=2));print('TEST',report,flush=True)
 torch.onnx.export(model,torch.zeros(1,128,96),'public/models/phrases.onnx',input_names=['mel'],output_names=['logits'],opset_version=17,dynamo=False)
 Path('public/models/phrases.json').write_text(json.dumps({'prototypes':prototypes.tolist(),'prior':prior.tolist(),'duration':2,'source':'RPMC-L2, CC-BY-4.0','evaluation':report},indent=2))
if __name__=='__main__':main()
