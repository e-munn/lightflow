"""Does past context help beyond current audio? Does the saved export match Torch?"""
from pathlib import Path
import json,sys
import numpy as np
import torch
from restoration_train_full_range import Residual,examples,prediction,metric
model_root=Path(sys.argv[1]);data=Path(sys.argv[2]);out=Path(sys.argv[3]);out.mkdir(exist_ok=False)
m=json.loads((model_root/'model.json').read_text());manifest=json.loads((data/'manifest.json').read_text());model=Residual(len(m['mean']));model.load_state_dict(torch.load(model_root/'checkpoint.pt',weights_only=True));model.eval();fit=(model,np.array(m['mean'],np.float32),np.array(m['std'],np.float32),[],0);torch.set_num_threads(4)
report={}
for c in manifest['cases']:
 if c['split']=='train':continue
 for condition,file in zip(manifest['conditions'],c['files']):
  x,_,y,d=examples(data,c,file);correct=prediction(fit,x,d)
  wrong=x.copy();wrong[:,9:]=np.roll(x[:,9:],850,axis=0);flat=np.tile(x[:,:9],(1,9))
  results={'correct':metric(y,correct),'wrong_past_current_unchanged':metric(y,prediction(fit,wrong,d)),'repeated_present_no_history':metric(y,prediction(fit,flat,d))}
  report[c['name']+'_'+str(c['start'])+'_'+condition['name']]=results
  if condition['name']!='original':print(c['name'],condition['name'],'correct/wrong-past/no-history',*[round(results[k]['mse'],5) for k in results])
with (out/'report.json').open('x') as f:json.dump(report,f,indent=2)
