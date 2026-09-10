"""Run actual local audio through the causal feature definition and browser model.
These tracks are a qualitative probe, not an asserted unseen-song benchmark.
"""
import os
os.environ['NUMBA_CACHE_DIR']='/private/tmp/lightflow-numba'
import librosa,numpy as np,onnxruntime as ort,json,time
from pathlib import Path
session=ort.InferenceSession('public/models/concert.onnx',providers=['CPUExecutionProvider'])
phrase_session=ort.InferenceSession('public/models/phrases.onnx',providers=['CPUExecutionProvider'])
bank=librosa.filters.mel(sr=22050,n_fft=2048,n_mels=128);hann=np.hanning(2049)[:-1];reports=[]
for slug in ['damn_right_-_audrey_nuna','calabria_-_austin_marc','mcdonalds']:
 y,sr=librosa.load(Path('public/songs')/(slug+'.mp3'),sr=22050,duration=90);history=np.full((128,96),-1,dtype='float32');preds=[];logits=[];levels=[];times=[]
 for end in np.ceil(np.arange(1,int(len(y)/sr*8))*sr/8).astype(int):
  power=abs(np.fft.rfft(y[end-2048:end]*hann))**2;mel=bank@power;history[:,:-1]=history[:,1:];history[:,-1]=(np.maximum(-80,10*np.log10(np.maximum(mel,1e-10)))+40)/40
  t=time.perf_counter();preds.append(session.run(None,{'mel':history[None].copy()})[0][0]);logits.append(phrase_session.run(None,{'mel':history[None].copy()})[0][0]);times.append((time.perf_counter()-t)*1000);levels.append(float(np.sqrt(np.mean(y[end-2048:end]**2))))
 p=np.array(preds);r={'track':slug,'seconds':len(y)/sr,'output_std':p[96:].std(0).tolist(),'output_range':np.ptp(p[96:],axis=0).tolist(),'inference_p95_ms':float(np.percentile(times,95)),'brightness_level_corr':float(np.corrcoef(p[96:,0],levels[96:])[0,1])};reports.append(r)
 Path('scripts/director/artifacts/'+slug+'-trace.json').write_text(json.dumps({'fps':8,'values':p.tolist(),'logits':np.array(logits).tolist(),'levels':levels}))
 print(json.dumps(r),flush=True)
Path('scripts/director/artifacts/local-tracks.json').write_text(json.dumps(reports,indent=2))
