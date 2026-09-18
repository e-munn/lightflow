"""Controlled stereo-scope study. New external output folder; no overwrites."""
from pathlib import Path
import json, subprocess, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
SOURCE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26/of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.m4a')
OUT=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_stereo_scope_variations_9-16-26')
SR=48000;FPS=30;START=600;SECONDS=30;PRE=2
VARIANTS=[
 ('01  BASELINE','L / R | 20 ms | 1.5x gain',20,1.5,0,'lr'),
 ('02  SHORT WINDOW','L / R | 5 ms | 1.5x gain',5,1.5,0,'lr'),
 ('03  LONG WINDOW','L / R | 80 ms | 1.5x gain',80,1.5,0,'lr'),
 ('04  LOW SENSITIVITY','L / R | 20 ms | 0.5x gain',20,.5,0,'lr'),
 ('05  HIGH SENSITIVITY','L / R | 20 ms | 3x gain',20,3,0,'lr'),
 ('06  SHORT TRAIL','L / R | 20 ms | 120 ms decay',20,1.5,.12,'lr'),
 ('07  LONG TRAIL','L / R | 20 ms | 400 ms decay',20,1.5,.4,'lr'),
 ('08  MID / SIDE','X = side | Y = mid | 20 ms',20,1.5,0,'ms'),
 ('09  DELAYED MONO','X = mono now | Y = mono 1 ms ago',20,1.5,0,'delay')]

def main():
 OUT.mkdir(exist_ok=False)
 raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(START-PRE),'-t',str(SECONDS+PRE+.1),'-i',str(SOURCE),'-vn','-ac','2','-ar',str(SR),'-f','f32le','pipe:1'])
 pcm=np.frombuffer(raw,dtype='<f4').reshape(-1,2)
 fonts={s:ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',s) for s in [12,14,20,30]}
 base=Image.new('RGB',(1920,1080),(7,11,18));d=ImageDraw.Draw(base)
 d.text((24,17),'LIGHTFLOW / STEREO SCOPE STUDIES',font=fonts[30],fill=(168,248,220))
 d.text((25,57),'OF THE TREES / ULTRA MIAMI 2026 / 10:00-10:30    |    Same audio, nine controlled line drawings',font=fonts[14],fill=(145,164,182))
 boxes=[]; backgrounds=[]
 pw,ph=576,218
 yy,xx=np.mgrid[:ph,:pw]; unit=(ph-14)/2
 grid=np.zeros((ph,pw,3),np.float32)+np.array([6,12,17],np.float32)
 for v in [-1,-.5,0,.5,1]:
  vx=int(round(pw/2+unit*v));vy=int(round(ph/2+unit*v))
  if 0<=vx<pw:grid[:,vx]=[23,38,44]
  if 0<=vy<ph:grid[vy,:]=[23,38,44]
 for i,(name,desc,*_) in enumerate(VARIANTS):
  x=24+(i%3)*632;y=91+(i//3)*322
  d.rounded_rectangle((x,y,x+608,y+307),radius=8,fill=(13,19,29),outline=(35,45,61))
  d.text((x+16,y+11),name,font=fonts[20],fill=(220,232,238));d.text((x+16,y+40),desc,font=fonts[14],fill=(144,167,183))
  d.text((x+16,y+286),'Fixed scale / no automatic normalization',font=fonts[12],fill=(104,133,148))
  boxes.append((x+16,y+64));backgrounds.append(grid.copy())
 previous=[np.zeros((ph,pw),np.float32) for _ in VARIANTS]
 clipping=[[] for _ in VARIANTS]
 target=OUT/'of_the_trees_nine_stereo_scope_variations_30s.mp4'
 cmd=['ffmpeg','-hide_banner','-loglevel','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','pipe:0','-ss',str(START),'-t',str(SECONDS),'-i',str(SOURCE),'-map','0:v:0','-map','1:a:0','-t',str(SECONDS),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)]
 process=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 for frame in range(SECONDS*FPS):
  end=int(round((PRE+frame/FPS)*SR));img=base.copy()
  for i,(_,_,ms,gain,tau,mapping) in enumerate(VARIANTS):
   n=int(ms*SR/1000);samples=pcm[end-n:end]
   if mapping=='lr':x,y=samples[:,0],samples[:,1]
   elif mapping=='ms':x,y=(samples[:,0]-samples[:,1])*.5,(samples[:,0]+samples[:,1])*.5
   else:x,y=samples.mean(axis=1),pcm[end-n-48:end-48].mean(axis=1)
   x=x*gain;y=y*gain
   clipping[i].append(float(np.mean((np.abs(x)>1)|(np.abs(y)>1))))
   coords=list(zip((pw/2+x*unit).tolist(),(ph/2-y*unit).tolist()))
   trace=Image.new('L',(pw,ph));td=ImageDraw.Draw(trace);td.line(coords,fill=225,width=1,joint='curve')
   a=np.asarray(trace,dtype=np.float32)
   if tau>0:a=np.maximum(a,previous[i]*np.exp(-1/(FPS*tau)))
   previous[i]=a
   core=Image.fromarray(np.uint8(a))
   glow=np.asarray(core.filter(ImageFilter.GaussianBlur(2.0)),dtype=np.float32)
   light=a*.87+glow*.85
   rgb=np.clip(backgrounds[i]+light[:,:,None]*np.array([.32,1.,.78]),0,255).astype(np.uint8)
   img.paste(Image.fromarray(rgb),boxes[i])
  if frame==450:img.save(OUT/'comparison_preview.png')
  process.stdin.write(img.tobytes())
  if frame%300==0:print('RENDERED',frame,'/ 900',flush=True)
 process.stdin.close();assert process.wait()==0
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_type,width,height,nb_read_frames','-of','json',str(target)]))
 assert float(probe['format']['duration'])==30
 metadata=dict(source=str(SOURCE),source_start_seconds=START,duration_seconds=SECONDS,sample_rate=SR,frames_per_second=FPS,variants=[dict(name=v[0],description=v[1],window_ms=v[2],gain=v[3],trail_decay_seconds=v[4],mapping=v[5],fraction_outside_unit_axes=float(np.mean(clipping[i]))) for i,v in enumerate(VARIANTS)],generator='Procedural NumPy/Pillow drawing, FFmpeg encoded; not TouchDesigner or a trained model',notes='Equal X/Y unit scale. All samples in each trailing window are drawn. Gain is fixed. Trails decay exponentially. Delayed mono is a temporal embedding, not a stereo measurement. Unit-axis excursions can extend horizontally into the wide plot and clip vertically at plot boundaries.',probe=probe)
 with (OUT/'manifest.json').open('x') as f:json.dump(metadata,f,indent=2)
 with (OUT/'SOURCES.md').open('x') as f:f.write('# Stereo scope variations\n\nUser-provided Of The Trees Ultra Miami 2026 audio, 10:00-10:30. Rights UNKNOWN. Procedural reference visualizations, not learned outputs or human choreography labels. See manifest.json for mappings and measurements. No existing files deleted or overwritten.\n')
 print('COMPLETE',target,probe,flush=True)
if __name__=='__main__':main()
