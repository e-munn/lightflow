from pathlib import Path
import json, subprocess, time, os
os.environ.setdefault('KMP_DUPLICATE_LIB_OK','TRUE')
import numpy as np
import torch, soundfile as sf
from demucs.pretrained import get_model
from demucs.apply import apply_model
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/stereo_scope_analysis/9-16-26')
AUDIO=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26')
CLIPS=[('ultra_10m','of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a',600),('ultra_30m','of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a',1800),('forest_20m','of_the_trees_electric_forest_-eVk7dh8dO4.m4a',1200)]
def main():
 OUT.mkdir(parents=True,exist_ok=False)
 torch.set_num_threads(4)
 model=get_model('htdemucs');model.eval();sr=model.samplerate
 records=[]
 for name,file,start in CLIPS:
  folder=OUT/name;folder.mkdir()
  audio=np.frombuffer(subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-t','60','-i',str(AUDIO/file),'-vn','-ac','2','-ar',str(sr),'-f','f32le','pipe:1']),dtype='<f4').reshape(-1,2).copy()
  sf.write(folder/'mix.wav',audio,sr,subtype='FLOAT')
  wave=torch.from_numpy(audio.T);ref=wave.mean(0);mean=ref.mean();std=ref.std()
  print('SEPARATING',name,len(audio)/sr,'seconds',flush=True);beg=time.monotonic()
  with torch.inference_mode():
   stems=apply_model(model,((wave-mean)/std)[None],shifts=0,split=True,overlap=.25,progress=True,device='cpu',num_workers=0)[0]
  stems=(stems*std+mean/len(model.sources)).numpy()
  for source,stem in zip(model.sources,stems):sf.write(folder/(source+'.wav'),stem.T,sr,subtype='FLOAT')
  residual=audio-stems.sum(0).T
  reconstruction_snr=float(10*np.log10(np.mean(audio**2)/max(np.mean(residual**2),1e-15)))
  record=dict(id=name,source=str(AUDIO/file),start_seconds=start,duration_seconds=len(audio)/sr,sample_rate=sr,sources=model.sources,separator='htdemucs',shifts=0,overlap=.25,reconstruction_snr_db=reconstruction_snr,processing_seconds=time.monotonic()-beg)
  records.append(record)
  with (folder/'provenance.json').open('x') as f:json.dump(record,f,indent=2)
  print('SEPARATED',record,flush=True)
 with (OUT/'manifest.json').open('x') as f:json.dump(records,f,indent=2)
 with (OUT/'SOURCES.md').open('x') as f:f.write('# Stereo scope component study\n\nThree 60-second excerpts of user-provided Of The Trees shows. Estimated drums/bass/vocals/other stems from cached HTDemucs. Not studio multitracks; bleed and phase artifacts are possible. Synth and individual drum types are not directly separated. Rights UNKNOWN. No model training. All heavy files on ExtremePro; no existing files deleted or overwritten.\n')
 print('DONE',OUT,flush=True)
if __name__=='__main__':main()
