from pathlib import Path
import json, subprocess
import numpy as np
import soundfile as sf
from PIL import Image,ImageDraw,ImageFont,ImageFilter
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/stereo_scope_analysis/9-16-26')
FPS=30;DURATION=4

def main():
 report=json.loads((OUT/'analysis.json').read_text());records={r['id']:r for r in json.loads((OUT/'manifest.json').read_text())}
 examples=report['review_examples'];allwaves={};audio=[]
 for e in examples:
  folder=OUT/e['clip'];waves={s:sf.read(folder/(s+'.wav'),dtype='float32')[0] for s in ['mix','drums','bass','other','vocals']};sr=records[e['clip']]['sample_rate'];e['start']=min(max(1,e['center']-2),55)
  waves['reconstructed']=sum(waves[s] for s in ['drums','bass','other','vocals']);waves['without']=waves['reconstructed']-waves[e['source']];allwaves[(e['clip'],e['source'])]=waves
  start=int(e['start']*sr)
  for source in ['mix',e['source']]:
   seg=waves[source][start:start+DURATION*sr].copy();fade=int(.015*sr);seg[:fade]*=np.linspace(0,1,fade)[:,None];seg[-fade:]*=np.linspace(1,0,fade)[:,None];audio.append(seg)
 track=OUT/'component_review_audio.wav';sf.write(track,np.concatenate(audio),sr,subtype='PCM_16')
 target=OUT/'component_scope_review.mp4'
 cmd=['ffmpeg','-v','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1440x900','-r',str(FPS),'-i','pipe:0','-i',str(track),'-map','0:v:0','-map','1:a:0','-t',str(len(examples)*DURATION*2),'-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)]
 encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 fontfile='/System/Library/Fonts/Supplemental/Arial.ttf';fonts={s:ImageFont.truetype(fontfile,s) for s in [15,17,20,24,28]}
 pw,ph=440,260;unit=115
 for ei,e in enumerate(examples):
  waves=allwaves[(e['clip'],e['source'])];rec=records[e['clip']];sr=rec['sample_rate'];signals=[waves['reconstructed'],waves[e['source']],waves['without']]
  for frame in range(DURATION*FPS*2):
   second=frame/FPS;offset=second%DURATION;end=int((e['start']+offset)*sr);n=int(sr*.020)
   im=Image.new('RGB',(1440,900),(7,11,18));d=ImageDraw.Draw(im)
   d.text((24,18),'LIGHTFLOW / COMPONENT DECONSTRUCTION',font=fonts[28],fill=(165,244,219))
   d.text((24,61),e['label'],font=fonts[24],fill=(221,232,239))
   source_sec=rec['start_seconds']+e['start']+offset
   d.text((24,99),f"{e['clip']} / source {int(source_sec//60):02d}:{source_sec%60:05.2f} / 20 ms scope / fixed 1.5x gain",font=fonts[17],fill=(148,170,188))
   soundtrack='ORIGINAL MIX' if second<DURATION else 'ESTIMATED '+e['source'].upper()+' ONLY'
   d.text((850,100),'LISTENING TO: '+soundtrack,font=fonts[17],fill=(248,195,93))
   for row in range(2):
    y=167+row*350
    d.text((24,y-28),'NATIVE LEVELS' if row==0 else 'EQUAL RMS: 0.15 / shape comparison only',font=fonts[17],fill=(153,176,189))
    for col,signal in enumerate(signals):
     x=24+col*472;title=['RECONSTRUCTED MIX','ESTIMATED '+e['source'].upper(),'MIX WITHOUT '+e['source'].upper()][col]
     d.text((x,y),title,font=fonts[17],fill=(204,220,232))
     samples=signal[end-n:end].copy()
     if row==1:samples*=.15/max(float(np.sqrt(np.mean(samples*samples))),1e-7)
     canvas=Image.new('RGB',(pw,ph),(7,16,22));p=ImageDraw.Draw(canvas)
     for v in [-1,-.5,0,.5,1]:
      p.line([(0,ph/2+v*unit),(pw,ph/2+v*unit)],fill=(22,39,46));p.line([(pw/2+v*unit,0),(pw/2+v*unit,ph)],fill=(22,39,46))
     xy=np.column_stack([pw/2+samples[:,0]*1.5*unit,ph/2-samples[:,1]*1.5*unit]);p.line(list(map(tuple,xy.tolist())),fill=(72,255,191),width=1)
     im.paste(canvas,(x,y+30))
   d.text((24,844),'Same 4 seconds replay twice: original audio first, isolated estimated stem second. No automatic audio gain.',font=fonts[17],fill=(148,170,188))
   d.text((24,874),'Estimated stems may contain bleed. Snare and synth identities require listening review; this is not ground truth.',font=fonts[15],fill=(148,170,188))
   if ei==0 and frame==75:im.save(OUT/'component_review_preview.png')
   encoder.stdin.write(im.tobytes())
  print('REVIEW CHAPTER',e['source'],flush=True)
 encoder.stdin.close();assert encoder.wait()==0
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','format=duration,size:stream=codec_type,width,height,nb_read_frames','-of','json',str(target)]))
 with (OUT/'review_manifest.json').open('x') as f:json.dump({'examples':examples,'probe':probe,'generator':'NumPy/Pillow procedural scope, FFmpeg encoding'},f,indent=2)
 print('REVIEW COMPLETE',probe,flush=True)
if __name__=='__main__':main()
