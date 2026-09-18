"""Offline shot-boundary proposals using upstream TransNet V2, then visual review."""
from pathlib import Path
import argparse,sys,subprocess,json,time
import numpy as np
import torch
from PIL import Image,ImageDraw,ImageFont
MODEL=Path('/Volumes/ExtremePro/Code/lightflow/research/third_party/transnet_v2_2026-09-16')
sys.path.insert(0,str(MODEL))
from transnetv2_pytorch import TransNetV2

def streamed_windows(command):
 process=subprocess.Popen(command,stdout=subprocess.PIPE)
 size=27*48*3
 try:
  raw=process.stdout.read(75*size);first=np.frombuffer(raw,np.uint8).reshape(-1,27,48,3)
  if len(first)==0:raise ValueError('No decoded video frames')
  total=len(first);eof=total<75
  window=np.concatenate([np.repeat(first[:1],25,axis=0),first,np.repeat(first[-1:],75-total,axis=0)])
  index=0
  while True:
   yield index,window,total
   index+=50
   if eof and index>=total:break
   raw=b'' if eof else process.stdout.read(50*size)
   new=np.frombuffer(raw,np.uint8).reshape(-1,27,48,3);total+=len(new);eof=len(new)<50
   last=new[-1:] if len(new) else window[-1:]
   window=np.concatenate([window[50:],new,np.repeat(last,50-len(new),axis=0)])
  assert process.wait()==0
 finally:
  if process.poll() is None:process.terminate();process.wait()

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--start',type=float,default=0);ap.add_argument('--duration',type=float,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--review-pages',type=int,default=4);ap.add_argument('--device',choices=['cpu','mps'],default='cpu');ap.add_argument('--stream',action='store_true');args=ap.parse_args()
 args.out.mkdir(parents=True,exist_ok=False);torch.set_num_threads(4);model=TransNetV2();model.load_state_dict(torch.load(MODEL/'weights.pth',map_location='cpu',weights_only=True));model.eval().to(args.device)
 fps=30
 command=['ffmpeg','-v','error','-threads','2','-ss',str(args.start),'-i',str(args.source),'-t',str(args.duration),'-vf',f'fps={fps},scale=48:27','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1']
 if args.stream:windows=streamed_windows(command)
 else:
  raw=subprocess.check_output(command);frames=np.frombuffer(raw,np.uint8).reshape(-1,27,48,3);n=len(frames)
  # Upstream inference keeps the central 50 of each 100-frame window.
  right=25+(50-n%50)%50;padded=np.concatenate([np.repeat(frames[:1],25,axis=0),frames,np.repeat(frames[-1:],right,axis=0)])
  windows=((i,padded[i:i+100],n) for i in range(0,len(padded)-99,50))
 predictions=[];all_predictions=[];started=time.perf_counter()
 with torch.no_grad():
  for i,window,n in windows:
   x=torch.from_numpy(window.copy())[None].to(args.device)
   single,many=model(x);predictions.extend(torch.sigmoid(single)[0,25:75,0].tolist());all_predictions.extend(torch.sigmoid(many['many_hot'])[0,25:75,0].tolist())
   if i%3600==0:print('PREDICT',round(i/fps,1),'/',args.duration,'seconds; wall',round(time.perf_counter()-started,1),flush=True)
 predictions=np.array(predictions[:n]);all_predictions=np.array(all_predictions[:n]);assert len(predictions)==n
 # Group consecutive high-probability frames into a single transition interval.
 hot=np.flatnonzero(predictions>=.5);groups=np.split(hot,np.flatnonzero(np.diff(hot)>1)+1) if len(hot) else []
 boundaries=[{'start':args.start+int(g[0])/fps,'end':args.start+(int(g[-1])+1)/fps,'peak':args.start+int(g[np.argmax(predictions[g])])/fps,'probability':float(predictions[g].max()),'review_status':'unreviewed'} for g in groups]
 with (args.out/'predictions.npz').open('xb') as f:np.savez_compressed(f,single=predictions,many=all_predictions)
 with (args.out/'boundaries.json').open('x') as f:json.dump({'source':str(args.source),'source_start':args.start,'duration':n/fps,'fps':fps,'device':args.device,'streamed':args.stream,'boundaries':boundaries,'wall_seconds':time.perf_counter()-started,'method':'TransNetV2 upstream PyTorch implementation; ByteDance converted checkpoint; threshold .5; offline future context allowed for cleaning video only','accepted_training_seconds':0},f,indent=2)
 font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
 for page in range(min(args.review_pages,(len(boundaries)+7)//8)):
  rows=boundaries[page*8:page*8+8];sheet=Image.new('RGB',(960,len(rows)*205),(12,18,20));d=ImageDraw.Draw(sheet)
  for j,b in enumerate(rows):
   d.text((8,j*205+3),f'Candidate {b["peak"]:.3f}s / p={b["probability"]:.2f} / before, transition, after',font=font,fill='white')
   for col,t in enumerate([b['start']-.2,b['peak'],b['end']+.2]):
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(max(0,t)),'-i',str(args.source),'-frames:v','1','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
    sheet.paste(Image.fromarray(np.frombuffer(raw,np.uint8).reshape(180,320,3)),(col*320,j*205+25))
  with (args.out/f'cuts_{page+1}.jpg').open('xb') as f:sheet.save(f,format='JPEG',quality=90)
 print('COMPLETE',args.out,'cuts',len(boundaries),'wall',round(time.perf_counter()-started,1),flush=True)
if __name__=='__main__':main()
