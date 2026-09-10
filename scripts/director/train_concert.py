"""Causal concert lighting experiment. No raw audio is downloaded or exported.

RPMC-L2, Zhao et al., Automatic Stage Lighting Control, CC-BY-4.0.
Clip-disjoint split is exploratory: source-show identities are unavailable.
Targets are video histogram descriptors, NOT DMX or human scene labels.
"""
import os
os.environ.setdefault('KMP_DUPLICATE_LIB_OK','TRUE')
os.environ.setdefault('NUMBA_CACHE_DIR','/private/tmp/lightflow-numba')
import argparse, hashlib, json, time
from pathlib import Path
import h5py, librosa, numpy as np, torch
from torch import nn
from torch.utils.data import Dataset, DataLoader

OUT=Path('scripts/director/artifacts'); OUT.mkdir(exist_ok=True)
class Director(nn.Module):
 def __init__(self):
  super().__init__()
  self.net=nn.Sequential(nn.Conv1d(128,64,5,stride=2),nn.GELU(),nn.Conv1d(64,64,5,stride=2),nn.GELU(),nn.Conv1d(64,64,5,stride=2),nn.GELU())
  self.head=nn.Sequential(nn.Linear(128,64),nn.GELU(),nn.Linear(64,7),nn.Sigmoid())
 def forward(self,x):
  h=self.net(x); return self.head(torch.cat([h[:,:,-1],h.mean(-1)],-1))

def prepare():
 cache=OUT/'concert.npz'
 if cache.exists():return
 xs=[];ys=[];lengths=[];ids=[]
 with h5py.File('data/rpmc-l2/RPMC_L2.hdf5','r') as f:
  for i,k in enumerate(sorted(f)):
   g=f[k]; mel=np.asarray(g['music/mel_spectrogram']); n=mel.shape[1]; duration=(n-1)*512/22050
   ts=np.arange(0,duration,1/8); mi=np.minimum((ts*22050/512).astype(int),n-1)
   # Input is fixed-reference log power. No whole-song normalization or future frames.
   x=np.maximum(-80,10*np.log10(np.maximum(mel[:,mi],1e-10)));x=(x+40)/40
   light=np.asarray(g['light/0']); hi=np.asarray(g['light/60'][:,0,:180],dtype=float)
   li=np.minimum((ts*30).astype(int),len(light)-1)
   v=light[:,2,:].astype(float);sat=light[:,1,:].astype(float);v[:,0]=0;sat[:,0]=0
   value=(v@np.arange(256)/np.maximum(v.sum(1),1))/255
   saturation=(sat@np.arange(256)/np.maximum(sat.sum(1),1))/255
   coverage=1-light[:,2,0]/np.maximum(light[:,2,:].sum(1),1)
   hi[:,0]=(hi[:,1]+hi[:,179])/2;hi/=np.maximum(hi.sum(1,keepdims=True),1)
   angles=np.arange(180)*2*np.pi/180
   hx=hi@np.cos(angles)*.5+.5;hy=hi@np.sin(angles)*.5+.5
   entropy=-(hi*np.log(np.maximum(hi,1e-10))).sum(1)/np.log(180)
   activity=np.minimum(1,np.abs(np.diff(value,prepend=value[0]))*12)
   y=np.stack([value,activity,entropy,hx,hy,coverage,saturation],1)[li]
   xs.append(x.astype('float32'));ys.append(y.astype('float32'));lengths.append(len(ts));ids.append(k)
   if i%25==0: print('prepare',i,'/',len(f),flush=True)
 np.savez_compressed(cache,x=np.concatenate(xs,1),y=np.concatenate(ys),lengths=lengths,ids=ids)
 print('prepared',sum(lengths),'frames',flush=True)

class Windows(Dataset):
 def __init__(self,d,split):
  self.x=d['x'];self.y=d['y'];self.index=[];offset=0;self.ids=[]
  for n,k in zip(d['lengths'],d['ids']):
   bucket=int(hashlib.sha256(str(k).encode()).hexdigest()[:8],16)%10
   part='test' if bucket==0 else 'val' if bucket==1 else 'train'
   if part==split:
    self.ids.append(str(k));self.index.extend(range(offset+95,offset+int(n),8 if split=='train' else 16))
   offset+=int(n)
 def __len__(self):return len(self.index)
 def __getitem__(self,i):
  k=self.index[i];return torch.from_numpy(self.x[:,k-95:k+1].copy()),torch.from_numpy(self.y[k].copy())

def run():
 ap=argparse.ArgumentParser();ap.add_argument('--epochs',type=int,default=20);a=ap.parse_args()
 torch.manual_seed(42);np.random.seed(42);torch.set_num_threads(4)
 prepare();d=np.load(OUT/'concert.npz');train=Windows(d,'train');val=Windows(d,'val');test=Windows(d,'test')
 (OUT/'split.json').write_text(json.dumps({k:v.ids for k,v in [('train',train),('val',val),('test',test)]},indent=2))
 device='mps' if torch.backends.mps.is_available() else 'cpu';model=Director().to(device);opt=torch.optim.AdamW(model.parameters(),lr=.0005,weight_decay=.01)
 loaders=[DataLoader(ds,batch_size=128,shuffle=i==0) for i,ds in enumerate([train,val,test])]
 mean=train.y[train.index].mean(0);history=[];best=1e9
 print('device',device,'windows',[len(ds) for ds in [train,val,test]],flush=True)
 for epoch in range(a.epochs):
  t=time.time();model.train();losses=[]
  for x,y in loaders[0]:
   x=x.to(device);y=y.to(device);p=model(x);loss=((p-y)**2).mean();opt.zero_grad();loss.backward();opt.step();losses.append(loss.item())
  model.eval();preds=[];truth=[]
  with torch.no_grad():
   for x,y in loaders[1]:preds.append(model(x.to(device)).cpu().numpy());truth.append(y.numpy())
  p=np.concatenate(preds);y=np.concatenate(truth);mse=((p-y)**2).mean(0);baseline=((mean-y)**2).mean(0)
  entry={'epoch':epoch+1,'train_mse':float(np.mean(losses)),'val_mse':mse.tolist(),'constant_mse':baseline.tolist(),'seconds':time.time()-t};history.append(entry);print(json.dumps(entry),flush=True)
  (OUT/'history.json').write_text(json.dumps(history,indent=2))
  if mse.mean()<best:
   best=mse.mean();torch.save({'model':model.cpu().state_dict(),'epoch':epoch+1,'metrics':entry},OUT/'concert.pt');model.to(device)
 model.cpu();model.load_state_dict(torch.load(OUT/'concert.pt',weights_only=True)['model']);model.eval()
 with torch.no_grad():
  p=np.concatenate([model(x).numpy() for x,y in loaders[2]]);y=np.concatenate([y.numpy() for x,y in loaders[2]])
 report={'test_mse':((p-y)**2).mean(0).tolist(),'constant_mse':((mean-y)**2).mean(0).tolist(),'prediction_std':p.std(0).tolist(),'target_std':y.std(0).tolist(),'limitations':['clip split does not guarantee unseen source show','video histograms do not label scene choices','no subjective quality claim']}
 (OUT/'evaluation.json').write_text(json.dumps(report,indent=2));print('TEST',json.dumps(report),flush=True)
 Path('public/models').mkdir(exist_ok=True)
 torch.onnx.export(model,torch.zeros(1,128,96),'public/models/concert.onnx',input_names=['mel'],output_names=['lighting'],opset_version=17,dynamo=False)
 bank=librosa.filters.mel(sr=22050,n_fft=2048,n_mels=128)
 Path('public/models/mel-bank.json').write_text(json.dumps([[ [int(i),float(row[i])] for i in np.flatnonzero(row)] for row in bank]))
 Path('public/models/concert.json').write_text(json.dumps({'sampleRate':22050,'fftSize':2048,'fps':8,'contextFrames':96,'outputs':['value','activity','entropy','hueCos','hueSin','coverage','saturation'],'source':'RPMC-L2 / Zhao et al. / CC-BY-4.0','evaluation':report},indent=2))
if __name__=='__main__':run()
