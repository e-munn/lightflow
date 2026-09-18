from pathlib import Path
import json,csv
import numpy as np
import soundfile as sf
from scipy.signal import find_peaks
from scipy.stats import spearmanr
from PIL import Image, ImageDraw
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/stereo_scope_analysis/9-16-26')
FPS=50;WINDOW=.020
SOURCES=['drums','bass','other','vocals']
METRICS=['rms','major','minor','roundness','side_fraction','correlation','balance','roughness','centroid_hz']

def frames_for(a,sr):
 hop=sr//FPS;n=int(sr*WINDOW)
 ends=np.arange(n,len(a)+1,hop)
 # Copy once for vectorized analysis; <=22 MB per one-minute stem.
 frames=np.stack([a[e-n:e] for e in ends])
 return frames,ends/sr

def features(f,sr):
 mean=f.mean(1);center=f-mean[:,None,:]
 xx=(center[:,:,0]**2).mean(1);yy=(center[:,:,1]**2).mean(1);xy=(center[:,:,0]*center[:,:,1]).mean(1)
 disc=np.sqrt((xx-yy)**2+4*xy**2)
 major=np.sqrt(np.maximum((xx+yy+disc)/2,0));minor=np.sqrt(np.maximum((xx+yy-disc)/2,0))
 mid=f.mean(2);side=(f[:,:,0]-f[:,:,1])/2
 me=(mid**2).mean(1);se=(side**2).mean(1)
 rms=np.sqrt((f**2).mean((1,2)))
 rough=np.sqrt((np.diff(f,axis=1)**2).sum(2)).mean(1)/np.maximum(rms,1e-8)
 spectrum=np.mean(np.abs(np.fft.rfft(f*np.hanning(f.shape[1])[None,:,None],axis=1))**2,axis=2)
 hz=np.fft.rfftfreq(f.shape[1],1/sr);total=spectrum.sum(1)
 result=dict(rms=rms,major=major,minor=minor,roundness=minor/np.maximum(major,1e-8),side_fraction=se/np.maximum(me+se,1e-10),correlation=xy/np.sqrt(np.maximum(xx*yy,1e-16)),balance=(xx-yy)/np.maximum(xx+yy,1e-10),roughness=rough,centroid_hz=(spectrum*hz).sum(1)/np.maximum(total,1e-10))
 for name,lo,hi in [('low',35,150),('body',150,1000),('high',1000,10000)]:result[name+'_share']=spectrum[:,(hz>=lo)&(hz<hi)].sum(1)/np.maximum(total,1e-10)
 return result

def occupancy(f,gain=1.5,normalize=False):
 if normalize:f=f*.15/max(float(np.sqrt(np.mean(f**2))),1e-8)
 size=128;unit=58
 p=(f*gain*unit+size/2)
 im=Image.new('L',(size,size));ImageDraw.Draw(im).line(list(map(tuple,p.tolist())),fill=255,width=1)
 return float(np.mean(np.asarray(im)>0))

def scalar(f):
 m=features(f[None],44100)
 return {k:float(m[k][0]) for k in METRICS}

def med(arr):return float(np.median(arr)) if len(arr) else None

def main():
 records=json.loads((OUT/'manifest.json').read_text())
 report={'method':{'fps':FPS,'window_ms':20,'raster':'128x128, fixed 1.5 gain, one-pixel line, no glow/persistence','rms_matched_target':.15,'interpretation':'estimated source separation; no confirmed isolated snare or synth labels'},'clips':[],'events':[],'interventions':[]}
 for rec in records:
  folder=OUT/rec['id']; waves={s:sf.read(folder/(s+'.wav'),dtype='float32')[0] for s in ['mix']+SOURCES};sr=rec['sample_rate']
  feats={};frame_arrays={}
  for s,a in waves.items():
   f,t=frames_for(a,sr);frame_arrays[s]=f;feats[s]=features(f,sr)
  energy=np.stack([feats[s]['rms']**2 for s in SOURCES]);shares=energy/np.maximum(energy.sum(0),1e-12)
  clip={'id':rec['id'],'source_start':rec['start_seconds'],'reconstruction_snr_db':rec['reconstruction_snr_db'],'stems':{},'energy_feature_correlations':{}}
  for i,s in enumerate(SOURCES):
   active=(feats[s]['rms']>=np.quantile(feats[s]['rms'],.5))&(feats[s]['rms']>.003)
   clip['stems'][s]={'energy_share':float(energy[i].sum()/energy.sum()),'active_frames':int(active.sum()),'active_median':{k:med(v[active]) for k,v in feats[s].items()}}
   clip['energy_feature_correlations'][s]={k:float(spearmanr(feats[s]['rms'],feats['mix'][k]).statistic) for k in ['rms','minor','roundness','side_fraction','roughness']}
  stride=np.arange(25,len(t)-25,5)
  clip['mix_median']={k:med(v[stride]) for k,v in feats['mix'].items()}
  clip['rendered_stems']={}
  for s in ['mix']+SOURCES:
   inds=[j for j in stride if feats[s]['rms'][j]>.003]
   clip['rendered_stems'][s]={'count':len(inds),'raw_lit_fraction':med([occupancy(frame_arrays[s][j]) for j in inds]),'rms_matched_lit_fraction':med([occupancy(frame_arrays[s][j],normalize=True) for j in inds])}
  # Drum event candidates. This is acoustic triage, not verified drum taxonomy.
  dr=feats['drums'];peaks,_=find_peaks(dr['rms'],distance=int(.18*FPS),prominence=max(.004,np.quantile(dr['rms'],.95)*.12))
  for idx in peaks:
   if idx<12 or idx>len(t)-12:continue
   lo=float(dr['low_share'][idx]);body=float(dr['body_share'][idx]);hi=float(dr['high_share'][idx])
   kind='kick-like' if lo>.55 else ('hat-like' if hi>.65 and body<.12 else ('snare-like' if body>.08 and hi>.20 and lo<.50 else 'mixed-drum'))
   before=np.arange(idx-9,idx-4);attack=np.arange(idx-1,idx+2)
   changes={k:float(np.median(feats['mix'][k][attack])-np.median(feats['mix'][k][before])) for k in ['rms','minor','roundness','side_fraction','roughness']}
   changes['lit_fraction']=float(np.median([occupancy(frame_arrays['mix'][j]) for j in attack])-np.median([occupancy(frame_arrays['mix'][j]) for j in before]))
   report['events'].append(dict(clip=rec['id'],time=float(t[idx]),source_time=rec['start_seconds']+float(t[idx]),label=kind,label_confidence='heuristic / unreviewed',drum_rms=float(dr['rms'][idx]),drum_band_shares=dict(low=lo,body=body,high=hi),changes=changes))
  reconstructed=sum(waves[s] for s in SOURCES)
  for i,s in enumerate(SOURCES):
   # Upper-quintile source activity, sampled across the passage; no loudness normalization in raw comparison.
   eligible=np.where((feats[s]['rms']>=np.quantile(feats[s]['rms'],.8))&(feats[s]['rms']>.003))[0]
   eligible=eligible[(eligible>25)&(eligible<len(t)-25)]
   if len(eligible)>100:eligible=eligible[np.linspace(0,len(eligible)-1,100).astype(int)]
   fullf,_=frames_for(reconstructed,sr);withoutf,_=frames_for(reconstructed-waves[s],sr)
   fm=features(fullf[eligible],sr);wm=features(withoutf[eligible],sr)
   diffs={k:(fm[k]-wm[k]).tolist() for k in ['rms','minor','roundness','side_fraction','roughness']}
   raw=[];matched=[]
   for j in eligible:
    raw.append(occupancy(fullf[j])-occupancy(withoutf[j]));matched.append(occupancy(fullf[j],normalize=True)-occupancy(withoutf[j],normalize=True))
   diffs['lit_fraction']=raw;diffs['rms_matched_lit_fraction']=matched
   report['interventions'].append({'clip':rec['id'],'source':s,'count':len(eligible),'median_addition_effect':{k:med(v) for k,v in diffs.items()},'fraction_positive':{k:float(np.mean(np.asarray(v)>0)) for k,v in diffs.items()},'note':'Full separated reconstruction minus leave-one-estimated-stem-out; differences can include separation artifacts.'})
  with (folder/'features.csv').open('x',newline='') as f:
   writer=csv.writer(f);keys=[(s,k) for s in ['mix']+SOURCES for k in METRICS]
   writer.writerow(['relative_seconds','source_seconds']+[s+'_'+k for s,k in keys])
   writer.writerows([[float(ts),float(ts+rec['start_seconds'])]+[float(feats[s][k][j]) for s,k in keys] for j,ts in enumerate(t)])
  report['clips'].append(clip)
  print('MEASURED',rec['id'],len(peaks),'drum peaks',flush=True)
 report['event_summary']={}
 for kind in ['snare-like','kick-like','hat-like','mixed-drum']:
  events=[e for e in report['events'] if e['label']==kind]
  report['event_summary'][kind]={'count':len(events),'median_changes':{k:med([e['changes'][k] for e in events]) for k in ['rms','minor','roundness','side_fraction','roughness','lit_fraction']},'fraction_increased':{k:float(np.mean([e['changes'][k]>0 for e in events])) if events else None for k in ['rms','minor','roundness','side_fraction','roughness','lit_fraction']}}
 # Representative review windows: heuristically selected, not confirmed instrument labels.
 selected=[]
 snares=sorted([e for e in report['events'] if e['label']=='snare-like'],key=lambda e:e['drum_rms'],reverse=True)
 if snares:selected.append(dict(clip=snares[0]['clip'],source='drums',center=snares[0]['time'],label='Snare-like drum candidate (unconfirmed)'))
 for source in ['bass','other','vocals']:
  best=None
  for rec in records:
   folder=OUT/rec['id'];a,sr=sf.read(folder/(source+'.wav'),dtype='float32');f,t=frames_for(a,sr);rms=np.sqrt(np.mean(f**2,axis=(1,2)))
   # Sustained energy over one second rather than a single transient.
   smooth=np.convolve(rms,np.ones(FPS)/FPS,mode='same');smooth[:FPS*3]=0;smooth[-FPS*3:]=0
   j=int(np.argmax(smooth));candidate=dict(clip=rec['id'],source=source,center=float(t[j]),score=float(smooth[j]),label={'bass':'Estimated bass','other':'Estimated other (synth candidate, not isolated synth)','vocals':'Estimated vocals (may include bleed)'}[source])
   if best is None or candidate['score']>best['score']:best=candidate
  selected.append(best)
 report['review_examples']=selected
 with (OUT/'analysis.json').open('x') as f:json.dump(report,f,indent=2)
 print('ANALYSIS COMPLETE',report['event_summary'],flush=True)
if __name__=='__main__':main()
