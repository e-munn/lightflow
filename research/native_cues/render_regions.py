"""Playable spatial-mask comparison, with native observations held for display."""
from pathlib import Path
import argparse,json,subprocess,sys
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
sys.path.insert(0,str(HERE.parent/'wide_lights'))
from render import card
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE=ImageFont.truetype(FONT,27);BODY=ImageFont.truetype(FONT,20);SMALL=ImageFont.truetype(FONT,17)


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args();args.out.mkdir(parents=True,exist_ok=False)
    configs=json.loads((HERE/'region_candidates.json').read_text())['sources']
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources'];manifest={}
    for show,cfg in configs.items():
        start=cfg['clip_start'];begin=start+60;source=catalog[show]['source'];key=f'{show}_{start:04d}_060'
        data=np.load(ROOT/'native_cues/region_comparison_v1'/(key+'.npz'))
        original=np.load(ROOT/'native_cues/pilot_v2'/(key+'.npz'))
        geometry=np.load(ROOT/'wide_lights/dataset_v1'/show/f'{start:04d}.npz')
        dest=args.out/(show+'_separate_regions.mp4')
        stream=frames(source,begin-1,22);upcoming=next(stream);current=None
        encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x900','-r','30','-i','pipe:0',
            '-ss',str(begin),'-i',source,'-t','20','-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19',
            '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
        max_age=0
        for frame_id in range(600):
            now=begin+frame_id/30
            while upcoming is not None and upcoming[0]<=now+1e-8:
                current=upcoming;upcoming=next(stream,None)
            assert current is not None
            second,pts,time_base,frame=current
            index=int(np.searchsorted(data['time'],now+1e-8,side='right')-1)
            assert abs(data['time'][index]-second)<1e-8 and second<=now+1e-8
            max_age=max(max_age,now-second)
            g=int(np.floor((second-start)*10+1e-6));aligned=cv2.warpAffine(frame,geometry['transform'][g],(640,360))
            shot=Image.fromarray(aligned);sd=ImageDraw.Draw(shot)
            for name,color in [('light_field_rectangles',(107,247,177)),('screen_rectangles',(120,170,255))]:
                for box in cfg[name]:sd.rectangle(tuple(box),outline=color,width=2)
            canvas=Image.new('RGB',(1440,900),(6,13,18));draw=ImageDraw.Draw(canvas)
            draw.text((22,18),'LIGHTFLOW / SEPARATE THE SCREEN FROM THE LIGHT FIELD',font=TITLE,fill=(223,237,231))
            draw.text((22,60),f'{show.upper()}   {int(now//60):02d}:{now%60:04.1f}   |   Source PTS {second:.6f}s   |   Observation review',font=BODY,fill=(150,177,168))
            draw.text((22,104),'Green: candidate light fields   Blue: screen interior',font=BODY,fill=(184,208,195))
            canvas.paste(shot,(22,143))
            for j,label in enumerate(['Candidate light field','Screen interior']):
                y=data['target'][index,j];color_ok=float((data['quality'][index,j,:,2]*y[8:12]).sum())>.02
                card(draw,(704,103+j*214,710,199),label,y,bool(data['geometry_valid'][index]),color_ok)
            draw.text((22,531),'Each panel: energy fill, peak bar and lit-area width. One fixed mapping; no per-frame normalization.',font=BODY,fill=(181,205,192))
            draw.text((22,580),'Recent observed mean energy / trailing 8 seconds',font=BODY,fill=(220,235,226))
            left,top,width,height=30,627,1378,184
            for value in [0,.5,1]:
                yy=top+(1-value)*height;draw.line((left,yy,left+width,yy),fill=(44,56,63))
                draw.text((left+6,yy-22),f'{value:g}',font=SMALL,fill=(147,176,160))
            colors=[(107,247,177),(120,170,255),(162,164,162)]
            series=[data['target'][:,0,8:12].mean(1),data['target'][:,1,8:12].mean(1),original['energy'].mean(1)]
            ids=np.flatnonzero((data['time']>=max(begin-1,now-8))&(data['time']<=now+1e-8))
            for values,color in zip(series,colors):
                points=[(left+(data['time'][i]-now+8)/8*width,top+(1-float(values[i]))*height) for i in ids]
                if len(points)>1:draw.line(points,fill=color,width=2)
            draw.text((705,582),'Light field     Screen     Original mixed crop',font=SMALL,fill=(177,195,186))
            draw.text((22,839),'Native-timestamp observations held for 30 fps display. Screen spill and background graphics may remain.',font=SMALL,fill=(151,181,167))
            draw.text((22,872),'No model output. Mask candidates cover part of the show; empty regions do not prove a whole-rig blackout.',font=SMALL,fill=(225,187,133))
            encoder.stdin.write(canvas.tobytes())
            if frame_id in [0,300]:
                with (args.out/(show+f'_{frame_id:04d}.jpg')).open('xb') as f:canvas.save(f,format='JPEG',quality=92)
        stream.close();encoder.stdin.close();assert encoder.wait()==0
        manifest[show]={'source':source,'interval_seconds':[begin,begin+20],'frames':600,'fps':30,'max_source_sample_age_seconds':float(max_age),
                        'future_frames_displayed':False,'observations':'Disjoint candidate light and screen fields; partial stage appearance','model_output':False,'physical_latency':'Unmeasured'}
        print('COMPLETE',dest,flush=True)
    with (args.out/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)


if __name__=='__main__':main()
