"""Auditable same-renderer source, observation, and model comparisons."""
from pathlib import Path
import argparse,json,subprocess
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights')
HERE=Path(__file__).parent
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE=ImageFont.truetype(FONT,27);BODY=ImageFont.truetype(FONT,19);SMALL=ImageFont.truetype(FONT,16)

def card(draw,box,title,y,valid=True,color_valid=True):
    x,top,w,h=box
    draw.rounded_rectangle((x,top,x+w,top+h),radius=12,fill=(17,26,33))
    draw.text((x+16,top+12),title,font=BODY,fill=(217,231,225))
    if not valid:
        draw.text((x+16,top+65),'Observation unavailable',font=BODY,fill=(235,168,98));return
    chroma=y[12:] if color_valid else np.ones(3)/3
    color=chroma/max(chroma.max(),1e-6)
    for j in range(4):
        left=x+16+j*(w-32)/4;right=left+(w-32)/4-6
        rgb=tuple((255*np.clip(color*y[8+j],0,1)).astype(int))
        draw.rectangle((left,top+48,right,top+h-65),fill=rgb)
        # Peak intensity and lit fraction have independent visible encodings.
        accent=tuple((255*np.clip(color*y[j],0,1)).astype(int))
        draw.rectangle((left,top+h-52,right,top+h-38),fill=accent)
        draw.rectangle((left,top+h-27,right,top+h-19),fill=(44,52,59))
        if y[4+j]>0:draw.rectangle((left,top+h-27,left+(right-left)*y[4+j],top+h-19),fill=(189,207,200))
    if not color_valid:draw.text((x+w-152,top+16),'color unknown',font=SMALL,fill=(235,168,98))

def segment(show,start,offset,duration,dest,run=None):
    cfg=json.loads((HERE/'sources.json').read_text())['sources'][show]
    labels=np.load(ROOT/'dataset_v1'/show/f'{start:04d}.npz')
    pred=np.load(run/f'{show}_{start:04d}.npz') if run else None
    source=cfg['source'];begin=start+offset
    decoder=subprocess.Popen(['ffmpeg','-v','error','-ss',str(begin),'-i',source,'-t',str(duration),'-vf','fps=10,scale=640:360','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
    encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x900','-r','10','-i','pipe:0','-ss',str(begin),'-i',source,'-t',str(duration),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
    for frame_id in range(duration*10):
        raw=decoder.stdout.read(640*360*3)
        if len(raw)!=640*360*3:raise ValueError('Short decode')
        i=offset*10+frame_id;t=begin+frame_id/10
        frame=np.frombuffer(raw,np.uint8).reshape(360,640,3)
        aligned=cv2.warpAffine(frame,labels['transform'][i],(640,360))
        shot=Image.fromarray(aligned);d=ImageDraw.Draw(shot)
        a,b,c,e=[round(v*2/3) for v in cfg['stage_box']]
        edges=np.linspace(a,c,5).round().astype(int)
        for left,right in zip(edges[:-1],edges[1:]):d.rectangle((int(left),b,int(right),e),outline=(152,235,199),width=2)
        for box in cfg['exclude']:d.rectangle(tuple(round(v*2/3) for v in box),outline=(250,163,97),width=2)
        canvas=Image.new('RGB',(1440,900),(6,13,18));draw=ImageDraw.Draw(canvas)
        draw.text((22,20),'LIGHTFLOW / WIDE-SHOT APPEARANCE',font=TITLE,fill=(223,237,230))
        draw.text((22,60),f'{show.replace("_"," ")}   {int(t//60):02d}:{t%60:04.1f}   |   Original recording audio; physical light/audio offset unknown',font=BODY,fill=(149,177,165))
        canvas.paste(shot.resize((704,396)),(20,102))
        card(draw,(744,102,676,396),'Observed stage regions',labels['target'][i],labels['weight'][i,0]>0,labels['weight'][i,-1]>0)
        draw.text((22,513),'Each panel: four regions. Large fill = energy; thin colored bar = peak; pale width = lit area.',font=BODY,fill=(179,200,191))
        if pred is not None:
            k=int(np.argmin(np.abs(pred['time']-t)))
            assert abs(pred['time'][k]-t)<.011
            for j,(key,name) in enumerate([('direct_scope_adapter','Direct scope-derived control'),('amplitude_only','Loudness-only baseline'),('learned','Learned appearance / experimental')]):
                card(draw,(20+j*473,553,454,282),name,pred[key][k])
        else:
            draw.text((22,575),'EXTRACTION REVIEW / NOT MODEL OUTPUT',font=TITLE,fill=(218,231,224))
            draw.text((22,625),'Unknown geometry is excluded. Unknown color is shown neutral and excluded from color loss.',font=BODY,fill=(173,196,185))
            draw.text((22,665),'Stage pixels can include screens, haze and exposure changes. They are not recovered fixture commands.',font=BODY,fill=(173,196,185))
            draw.text((22,705),'Peak and coverage are kept separate to preserve both small accents and broad washes.',font=BODY,fill=(173,196,185))
        draw.text((22,857),'Same fixed display mapping for every panel. No per-frame automatic brightness normalization.',font=SMALL,fill=(137,163,152))
        encoder.stdin.write(canvas.tobytes())
        if frame_id in (0,duration*5):
            with dest.with_name(dest.stem+f'_{frame_id:04d}.jpg').open('xb') as f:canvas.save(f,format='JPEG',quality=91)
    decoder.stdout.close();assert decoder.wait()==0
    encoder.stdin.close();assert encoder.wait()==0

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);ap.add_argument('--run',type=Path);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    if args.run:
        for start in [600,1800,3000]:
            dest=args.out/f'forest_{start:04d}_comparison.mp4';segment('forest',start,60,60,dest,args.run);print('COMPLETE',dest,flush=True)
    else:
        for show,start in [('ravenscoon',1800),('alleycvt',1800),('griz',1800),('levity_forest',2100),('forest',1800)]:
            dest=args.out/(show+'_review.mp4');segment(show,start,60,12,dest);print('COMPLETE',dest,flush=True)

if __name__=='__main__':main()
