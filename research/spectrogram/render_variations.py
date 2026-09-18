"""Nine controlled spectrogram comparisons, rendered from real stereo audio.
All media outputs go to a fresh ExtremePro folder; never overwrite or delete.
"""
from pathlib import Path
import subprocess, json, hashlib, os
os.environ.setdefault('MPLCONFIGDIR','/private/tmp/lightflow-matplotlib')
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from matplotlib import colormaps

SOURCE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26/of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a')
OUT=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_spectrogram_variations_9-16-26')
FPS=30; SR=48000; START=600.; SECONDS=30.; PREROLL=13.; FFT=4096; HOP=SR//FPS; BINS=192
GAIN=12.; FLOOR=-78.; CEILING=0.
VARIANTS=[
 dict(name='01  FAST HISTORY',detail='0.75 s / log frequency / +12 dB',history=.75,gain=12,metric='magnitude',scale='log'),
 dict(name='02  PHRASE HISTORY',detail='4 s / log frequency / +12 dB',history=4,gain=12,metric='magnitude',scale='log'),
 dict(name='03  LONG HISTORY',detail='12 s / log frequency / +12 dB',history=12,gain=12,metric='magnitude',scale='log'),
 dict(name='04  LOW SENSITIVITY',detail='4 s / log frequency / +0 dB',history=4,gain=0,metric='magnitude',scale='log'),
 dict(name='05  MEDIUM SENSITIVITY',detail='4 s / log frequency / +12 dB',history=4,gain=12,metric='magnitude',scale='log'),
 dict(name='06  HIGH SENSITIVITY',detail='4 s / log frequency / +24 dB',history=4,gain=24,metric='magnitude',scale='log'),
 dict(name='07  SPECTRAL CHANGE',detail='4 s / positive magnitude change / +12 dB',history=4,gain=12,metric='positive_flux',scale='log'),
 dict(name='08  LINEAR FREQUENCY',detail='4 s / linear frequency / +12 dB',history=4,gain=12,metric='magnitude',scale='linear'),
 dict(name='09  RADIAL HISTORY',detail='4 s clockwise / frequency outward / +12 dB',history=4,gain=12,metric='magnitude',scale='log',radial=True)]


def decode():
 result=subprocess.run(['ffmpeg','-v','error','-ss',str(START-PREROLL),'-t',str(SECONDS+PREROLL+.1),'-i',str(SOURCE),'-vn','-ac','2','-ar',str(SR),'-f','f32le','pipe:1'],stdout=subprocess.PIPE,check=True)
 return np.frombuffer(result.stdout,dtype='<f4').reshape(-1,2)


def analyze(pcm):
 # Trailing windows: every visual frame uses only audio at or before its timestamp.
 window=np.hanning(FFT)
 hz=np.fft.rfftfreq(FFT,1/SR)
 results={}
 for scale in ['log','linear']:
  edges=np.geomspace(40,16000,BINS+1) if scale=='log' else np.linspace(40,16000,BINS+1)
  matrix=np.zeros((BINS,len(hz)))
  for i in range(BINS):
   mask=(hz>=edges[i])&(hz<edges[i+1])
   if mask.any():matrix[i,mask]=1/mask.sum()
   else:
    center=np.sqrt(edges[i]*edges[i+1]);j=np.searchsorted(hz,center);f=(center-hz[j-1])/(hz[j]-hz[j-1]);matrix[i,j-1]=1-f;matrix[i,j]=f
  results[scale]={'matrix':matrix,'edges':edges,'frames':[]}
 for end in range(0,len(pcm),HOP):
  samples=pcm[max(0,end-FFT):end]
  if len(samples)<FFT:samples=np.pad(samples,((FFT-len(samples),0),(0,0)))
  fft=np.fft.rfft(samples*window[:,None],axis=0)
  power=np.mean(np.abs(fft)**2,axis=1)*(2/window.sum())**2
  for v in results.values():v['frames'].append(np.sqrt(v['matrix']@power))
 for v in results.values():
  v['amplitude']=np.asarray(v.pop('frames'),np.float32).T
  v['positive_flux']=np.maximum(np.diff(v['amplitude'],axis=1,prepend=v['amplitude'][:,:1]),0)
 return results


def main():
 OUT.mkdir(exist_ok=False)
 pcm=decode();data=analyze(pcm)
 print('ANALYZED',len(pcm)/SR,'seconds',flush=True)
 lut=(colormaps['magma'](np.linspace(0,1,256))[:,:3]*255).astype(np.uint8)
 fontfile='/System/Library/Fonts/Supplemental/Arial.ttf'
 fonts={n:ImageFont.truetype(fontfile,n) for n in [12,14,17,20,30]}
 canvas=Image.new('RGB',(1920,1080),(7,11,18));d=ImageDraw.Draw(canvas)
 d.text((24,17),'LIGHTFLOW / SPECTROGRAM STUDIES',font=fonts[30],fill=(176,244,222))
 d.text((25,55),'OF THE TREES / ULTRA MIAMI 2026 / 10:00-10:30    |    Same audio, nine controlled views',font=fonts[17],fill=(143,160,178))
 boxes=[]
 for i,v in enumerate(VARIANTS):
  x=24+(i%3)*632;y=91+(i//3)*322
  d.rounded_rectangle((x,y,x+608,y+307),radius=8,fill=(13,19,29),outline=(35,45,61))
  d.text((x+16,y+11),v['name'],font=fonts[20],fill=(218,229,236))
  d.text((x+16,y+38),v['detail'],font=fonts[14],fill=(139,157,177))
  bx=x+43;by=y+65;bw=549;bh=212
  boxes.append((bx,by,bw,bh))
  if not v.get('radial'):
   d.text((x+6,by),'16k',font=fonts[12],fill=(129,143,163));d.text((x+9,by+bh-12),'40',font=fonts[12],fill=(129,143,163))
   d.text((bx,y+285),f"-{v['history']:g}s",font=fonts[12],fill=(129,143,163));d.text((bx+bw-26,y+285),'now',font=fonts[12],fill=(167,230,208))
  else:d.text((bx,y+285),'Center: 40 Hz / rim: 16 kHz / seam at top: newest',font=fonts[12],fill=(129,143,163))
 target=OUT/'of_the_trees_nine_spectrogram_variations_30s.mp4'
 command=['ffmpeg','-hide_banner','-loglevel','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','pipe:0','-ss',str(START),'-t',str(SECONDS),'-i',str(SOURCE),'-map','0:v:0','-map','1:a:0','-t',str(SECONDS),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)]
 encoder=subprocess.Popen(command,stdin=subprocess.PIPE)
 radar={}
 for i,(_,_,w,h) in enumerate(boxes):
  if VARIANTS[i].get('radial'):
   yy,xx=np.mgrid[:h,:w];xx=xx-(w-1)/2;yy=(h-1)/2-yy
   radius=np.sqrt(xx**2+yy**2)/(h*.47)
   angle=(np.arctan2(xx,yy)%(2*np.pi))/(2*np.pi)
   # Top is newest; clockwise moves toward older samples.
   radar[i]=(radius,angle)
 clip_stats={v['name']:[] for v in VARIANTS}
 for frame in range(int(SECONDS*FPS)):
  t=PREROLL+frame/FPS;end=int(round(t*FPS))
  img=canvas.copy()
  for i,v in enumerate(VARIANTS):
   bx,by,bw,bh=boxes[i]
   arr=data[v['scale']]['amplitude' if v['metric']=='magnitude' else 'positive_flux']
   count=max(2,int(round(v['history']*FPS)))
   spec=arr[:,end-count+1:end+1]
   db=20*np.log10(np.maximum(spec,1e-9))+v['gain']
   z=np.clip((db-FLOOR)/(CEILING-FLOOR),0,1)
   clip_stats[v['name']].append(float(np.mean(z>=1)))
   if v.get('radial'):
    radius,angle=radar[i]
    fidx=np.clip((radius*(BINS-1)).astype(int),0,BINS-1)
    tidx=np.clip(((1-angle)*(count-1)).astype(int),0,count-1)
    pixels=lut[(z[fidx,tidx]*255).astype(np.uint8)]
    pixels[radius>1]=(7,11,18)
    patch=Image.fromarray(pixels)
   else:
    patch=Image.fromarray(lut[(z[::-1]*255).astype(np.uint8)]).resize((bw,bh),Image.Resampling.BILINEAR)
   img.paste(patch,(bx,by))
  if frame==450:img.save(OUT/'comparison_preview.png')
  encoder.stdin.write(img.tobytes())
  if frame%300==0:print('RENDERED',frame,'/ 900',flush=True)
 encoder.stdin.close();assert encoder.wait()==0,'Encoder failed'
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_type,width,height,nb_read_frames,r_frame_rate','-of','json',str(target)]))
 assert abs(float(probe['format']['duration'])-SECONDS)<.1
 h=hashlib.sha256()
 with target.open('rb') as f:
  for b in iter(lambda:f.read(8*1024*1024),b''):h.update(b)
 manifest=dict(source=str(SOURCE),source_start_seconds=START,duration_seconds=SECONDS,preroll_seconds=PREROLL,sample_rate=SR,fft_size=FFT,hop_samples=HOP,window='Hann, trailing/causal',spectral_measurement='RMS amplitude across stereo channels and FFT bins in each frequency band; coherent-gain scaling',frequency_range_hz=[40,16000],bands=BINS,color_range_db=[FLOOR,CEILING],color_map='magma',variants=VARIANTS,mean_saturated_fraction={k:float(np.mean(v)) for k,v in clip_stats.items()},generator='Procedural NumPy/Pillow study, FFmpeg encoded; not TouchDesigner or model output',sha256=h.hexdigest(),probe=probe)
 with (OUT/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
 with (OUT/'SOURCES.md').open('x') as f:f.write('# Spectrogram variations\n\nSource: user-provided Of The Trees Ultra Miami 2026 audio; excerpt 10:00-10:30. Original media remains untouched. Rights UNKNOWN. Procedural comparison, not human-authored choreography labels or trained-model output. Full extraction, mapping, and verification parameters in manifest.json.\n\nSensitivity is a fixed +0/+12/+24 dB display gain with a shared -78..0 dB color range; no per-frame auto-normalization. Spectral-change mode measures positive changes in band amplitude, not musical beat labels. Radial mode maps frequency outward and time clockwise from newest at the top toward older samples. Low-frequency band interpolation does not increase the FFT frequency resolution.\n')
 print('COMPLETE',target,probe,flush=True)

if __name__=='__main__':main()
