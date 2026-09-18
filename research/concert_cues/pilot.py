"""Reviewable video observations; no claim to recovered DMX or human cue labels."""
from pathlib import Path
import subprocess,json,csv
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
SOURCE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26/concerts/of_the_trees_ultra_miami_2026_b3E9eB6Uw_E.mp4')
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/concert_cues/extraction_pilot_2026-09-16')
START=600;DURATION=12;FPS=30;W=640;H=360
# A provisional mask for the INITIAL camera view only, selected from contact sheet.
# Excludes audience and right-side logo; includes beams and screen (not separated).
REGIONS=[(20,20,110,190),(110,20,200,190),(200,20,290,190),(290,20,380,190)]

def main():
 OUT.mkdir(parents=True,exist_ok=False)
 raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(START),'-i',str(SOURCE),'-t',str(DURATION),'-vf',f'fps={FPS},scale={W}:{H}','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
 frames=np.frombuffer(raw,np.uint8).reshape(-1,H,W,3)
 features=[];previous=None;previous_edges=None
 for i,rgb in enumerate(frames):
  gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)/255.
  edge=cv2.Laplacian(gray,cv2.CV_64F)
  small=cv2.resize(edge,(80,45)).ravel();small-=small.mean()
  corr=1. if previous_edges is None else float(small@previous_edges/(np.linalg.norm(small)*np.linalg.norm(previous_edges)+1e-9))
  difference=0. if previous is None else float(np.abs(gray-previous).mean())
  regions=[]
  for x1,y1,x2,y2 in REGIONS:
   roi=rgb[y1:y2,x1:x2]/255.;lum=roi@np.array([.2126,.7152,.0722]);mask=lum>.2
   hsv=cv2.cvtColor(np.uint8(roi*255),cv2.COLOR_RGB2HSV)
   # Circular hue avoids red wrapping around the hue axis. Low saturation is flagged.
   weight=hsv[:,:,1]/255.*lum;angle=hsv[:,:,0]*np.pi/90
   hue=(np.arctan2(np.sum(np.sin(angle)*weight),np.sum(np.cos(angle)*weight))/(2*np.pi))%1
   regions.append({'luma_mean':float(lum.mean()),'luma_p90':float(np.quantile(lum,.9)),
     'lit_coverage':float(mask.mean()),'hue':float(hue),'hue_confidence':float(weight.mean())})
  features.append({'frame':i,'source_seconds':START+i/FPS,'edge_similarity':corr,'image_change':difference,'regions':regions})
  previous=gray;previous_edges=small
 # Discontinuity candidates only: flashes and changing LED graphics can also trigger this.
 suspects=[i for i,f in enumerate(features) if i and f['edge_similarity']<.15 and f['image_change']>.075]
 for i,f in enumerate(features):
  flags=[]
  if i/FPS>=4:flags.append('outside provisionally reviewed initial wide shot')
  if any(abs(i-j)<=6 for j in suspects):flags.append('cut / flash ambiguity')
  if np.mean(frames[i]>=250)>.08:flags.append('clipping / exposure ambiguity')
  f['review_flags']=flags
  f['candidate_only']=not flags
  f['training_accepted']=False # Requires full motion/audio review; never auto-admit.
 with (OUT/'observations.json').open('x') as f:json.dump(features,f,indent=2)
 with (OUT/'observations.csv').open('x',newline='') as f:
  writer=csv.writer(f);writer.writerow(['source_seconds','candidate_only','training_accepted','flags']+[f'region_{r}_{k}' for r in range(4) for k in ['luma_p90','lit_coverage','hue']])
  for row in features:writer.writerow([row['source_seconds'],row['candidate_only'],False,'; '.join(row['review_flags'])]+[row['regions'][r][k] for r in range(4) for k in ['luma_p90','lit_coverage','hue']])
 font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16);big=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',24)
 target=OUT/'source_and_observations.mp4'
 p=subprocess.Popen(['ffmpeg','-v','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r',str(FPS),'-i','pipe:0','-ss',str(START),'-t',str(DURATION),'-i',str(SOURCE),'-map','0:v','-map','1:a','-t',str(DURATION),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(target)],stdin=subprocess.PIPE)
 colors=[(123,241,208),(92,181,245),(212,156,250),(247,194,97)]
 for i,frame in enumerate(frames):
  row=features[i];im=Image.new('RGB',(1280,720),(9,15,19));d=ImageDraw.Draw(im)
  d.text((24,17),'LIGHTFLOW / CONCERT CUE EXTRACTION PILOT',font=big,fill=(220,240,233))
  d.text((24,51),f'Ultra Miami / {int(row["source_seconds"])//60:02d}:{row["source_seconds"]%60:05.2f} / Original audio',font=font,fill=(136,167,159))
  im.paste(Image.fromarray(frame),(24,92))
  if row['candidate_only']:
   for j,(x1,y1,x2,y2) in enumerate(REGIONS):d.rectangle((24+x1,92+y1,24+x2,92+y2),outline=colors[j],width=2)
  d.text((696,94),'REGIONAL LIGHT OBSERVATIONS',font=font,fill=(194,223,211))
  for j,r in enumerate(row['regions']):
   y=140+j*69;d.text((696,y),f'ZONE {j+1}',font=font,fill=colors[j]);d.rectangle((796,y,1235,y+22),fill=(25,38,41))
   if row['candidate_only']:d.rectangle((796,y,796+439*r['luma_p90'],y+22),fill=colors[j])
   d.text((796,y+29),f'P90 luminance {r["luma_p90"]:.2f} / lit coverage {r["lit_coverage"]:.2f}',font=font,fill=(127,151,150))
  d.text((24,474),'INITIAL WIDE SHOT / provisional observations' if row['candidate_only'] else 'MASK DISABLED / shot or exposure needs review',font=big,fill=(145,234,196) if row['candidate_only'] else (251,175,125))
  d.text((24,511),'Not accepted training labels. Camera exposure and LED-screen content remain mixed with stage lighting.',font=font,fill=(156,174,177))
  x0,y0,ww,hh=24,559,1232,106;d.rectangle((x0,y0,x0+ww,y0+hh),fill=(16,25,30))
  for j in range(4):
   points=[(x0+k/(len(features)-1)*ww,y0+hh-10-features[k]['regions'][j]['luma_p90']*(hh-20)) for k in range(i+1)]
   if len(points)>1:d.line(points,fill=colors[j],width=2)
  d.line((x0+i/(len(features)-1)*ww,y0,x0+i/(len(features)-1)*ww,y0+hh),fill='white')
  d.text((24,681),'Raw observations retained across rejected shots for audit; invalid regions never become training targets.',font=font,fill=(120,145,148))
  if i==60:im.save(OUT/'preview.png')
  p.stdin.write(im.tobytes())
 p.stdin.close();assert p.wait()==0
 manifest={'source':str(SOURCE),'start_seconds':START,'duration_seconds':DURATION,'fps':FPS,'regions_xyxy':REGIONS,'candidate_seconds':sum(f['candidate_only'] for f in features)/FPS,'training_accepted_seconds':0,'discontinuity_candidate_seconds':[START+i/FPS for i in suspects], 'limitations':['12 second pilot, not full-show audit','First four seconds provisionally masked from still review','Moving beams / graphics can mimic cuts','Exposure cannot be uniquely separated from physical light intensity','Audio-video source offset not independently verified','Observed pixels are not calibrated DMX commands']}
 with (OUT/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
 (OUT/'SOURCES.md').write_text('# Concert cue pilot\n\nUser-provided Ultra Miami 2026 video. Original preserved. Rights unknown. Computed image observations only; no accepted human cue labels yet.\n')
 print(json.dumps(manifest),flush=True)
if __name__=='__main__':main()
