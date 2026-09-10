"""Challenge phrase learning against shuffled audio and loudness-only input.
Uses validation only; test results remain separate from tuning decisions.
"""
from train_phrases import PhraseDirector,Phrases,OUT
import torch,numpy as np,json,time
from torch.utils.data import DataLoader
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss,accuracy_score

torch.set_num_threads(4)
d=np.load(OUT/'concert.npz');labels=np.load(OUT/'phrases.npz')
train=Phrases(d,'train');val=Phrases(d,'val')
train.labels=labels['train_labels'];val.labels=labels['val_labels']
model=PhraseDirector();c=torch.load(OUT/'phrase.pt',weights_only=True);model.load_state_dict(c['model']);model.eval()
with torch.no_grad():
 logits=torch.cat([model(x) for x,y in DataLoader(val,batch_size=256)]);p=logits.softmax(-1).numpy()
rng=np.random.default_rng(901);shuffled=p[rng.permutation(len(p))]
# Loudness proxy from mel power, across the same causal twelve-second context.
# This baseline intentionally cannot observe pitch, timbre or instrumentation.
level=np.log10(np.maximum(1e-10,np.power(10,(d['x']*40-40)/10).sum(0)))
def features(ds):
 out=[]
 for k in ds.index:
  x=level[k-95:k+1];blocks=x.reshape(12,8)
  out.append(np.r_[blocks.mean(1),blocks.std(1),np.quantile(x,[.1,.5,.9]),x[-1]])
 return np.array(out)
print('fitting loudness baseline',flush=True)
baseline=HistGradientBoostingClassifier(max_iter=80,max_leaf_nodes=12,l2_regularization=10,random_state=901)
baseline.fit(features(train),train.labels);bp=baseline.predict_proba(features(val))
prior=np.bincount(train.labels,minlength=24)/len(train.labels)
def score(prob):return {'cross_entropy':float(log_loss(val.labels,prob,labels=np.arange(24))),'accuracy':float(accuracy_score(val.labels,prob.argmax(1)))}
report={'selected_epoch':c['epoch'],'real_audio':score(p),'shuffled_audio':score(shuffled),'loudness_only':score(bp),'prior':score(np.tile(prior,(len(val),1))),'interpretation':'Validation diagnostic only. Clip split does not prove unseen-show generalization.'}
(OUT/'phrase-audit.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2),flush=True)
