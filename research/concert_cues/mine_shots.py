"""Propose shot intervals for MANUAL review; never automatically accept labels."""
from pathlib import Path
import argparse, subprocess, json, csv, io
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
FPS=2;W=384;H=216

def main():
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
 a.out.mkdir(parents=True,exist_ok=False);(a.out/'stills').mkdir()
 process=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-i',str(a.source),'-vf',f'fps={FPS},scale={W}:{H}','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
 records=[];cuts=[0];frames=[];previous=None;orb=cv2.ORB_create(nfeatures=250);matcher=cv2.BFMatcher(cv2.NORM_HAMMING);old_desc=None
 while True:
  raw=process.stdout.read(W*H*3)
  if len(raw)!=W*H*3:break
  rgb=np.frombuffer(raw,np.uint8).reshape(H,W,3);i=len(records);gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
  small=cv2.resize(gray,(96,54)).astype(np.float32)/255
  norm=(small-small.mean())/(small.std()+.035)
  residual=0 if previous is None else float(np.mean(np.abs(norm-previous)))
  keypoints,desc=orb.detectAndCompute(gray,None);matches=[]
  if desc is not None and old_desc is not None:
   matches=[x[0] for x in matcher.knnMatch(old_desc,desc,k=2) if len(x)==2 and x[0].distance<.72*x[1].distance]
  matchratio=len(matches)/max(1,min(len(desc) if desc is not None else 0,len(old_desc) if old_desc is not None else 0))
  # Stage flashes and changing screens can trigger; all boundaries are proposals.
  cut=i>0 and residual>.68 and matchratio<.09
  if cut and i-cuts[-1]>=2:cuts.append(i)
  records.append({'time':i/FPS,'brightness':float(small.mean()),'residual':residual,'match_ratio':matchratio,'cut_candidate':cut})
  if i%4==0:
   frame_path=a.out/'stills'/f'{i:06d}.jpg'
   with frame_path.open('xb') as f:Image.fromarray(rgb).save(f,format='JPEG',quality=75)
  previous=norm;old_desc=desc
  if i%1200==0:print('SCAN',a.source.name,round(i/FPS),'seconds',flush=True)
 assert process.wait()==0
 cuts.append(len(records));segments=[]
 for first,last in zip(cuts,cuts[1:]):
  duration=(last-first)/FPS
  if duration<6:continue
  brightness=float(np.mean([r['brightness'] for r in records[first:last]]))
  if brightness<.012:continue
  segments.append({'start':first/FPS,'end':last/FPS,'duration':duration,'brightness':brightness,'status':'unreviewed','index':len(segments)})
 # Long segments first, with temporal coverage. At most 32 visual review candidates.
 selected=[]
 for segment in sorted(segments,key=lambda s:s['duration'],reverse=True):
  if all(abs(segment['start']-s['start'])>20 for s in selected):selected.append(segment)
  if len(selected)==32:break
 selected.sort(key=lambda s:s['start'])
 font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',15)
 for page in range((len(selected)+7)//8):
  rows=selected[page*8:page*8+8];sheet=Image.new('RGB',(1536,250*len(rows)),(12,18,20));d=ImageDraw.Draw(sheet)
  for row,s in enumerate(rows):
   d.text((8,row*250+4),f'#{s["index"]} {s["start"]:.1f}–{s["end"]:.1f}s | {s["duration"]:.1f}s | UNREVIEWED',font=font,fill='white')
   for col,fraction in enumerate([.05,.35,.65,.95]):
    index=round((s['start']+fraction*s['duration'])*FPS/4)*4
    index=min(index,((len(records)-1)//4)*4)
    im=Image.open(a.out/'stills'/f'{index:06d}.jpg');sheet.paste(im,(col*384,row*250+27))
  with (a.out/f'candidates_{page+1}.jpg').open('xb') as f:sheet.save(f,format='JPEG',quality=85)
 with (a.out/'scan.csv').open('x',newline='') as f:
  w=csv.DictWriter(f,fieldnames=list(records[0]));w.writeheader();w.writerows(records)
 with (a.out/'candidates.json').open('x') as f:json.dump({'source':str(a.source),'fps':FPS,'cut_candidates':[v/FPS for v in cuts],'all_segments':segments,'review_selection':selected,'accepted_training_seconds':0,'method':'normalized image change plus ORB match deficit; heuristic only; 0.5s boundary resolution'},f,indent=2)
 print('COMPLETE',a.out,'candidates',len(segments),'selected',len(selected),flush=True)
if __name__=='__main__':main()
