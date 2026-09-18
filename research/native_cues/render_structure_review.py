from pathlib import Path
import json,subprocess,sys
import numpy as np
import cv2
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames
root=Path('/Volumes/ExtremePro/Code/lightflow/research');out=root/'native_cues/structure_review_v1'
d=json.loads((out/'candidates.json').read_text());sources=json.loads(Path('research/wide_lights/sources.json').read_text())['sources'];font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16);reports=[]
for item in d['selected']:
    key=item['clip'];show,clipstart=key.rsplit('_',1);source=sources[show]['source'];start=item['start'];stem=key+'_'+str(int(start));z=np.load(root/'native_cues/dataset_v1'/(key+'.npz'));base=np.load(root/'wide_lights/dataset_v1'/show/(clipstart+'.npz'));sheet=Image.new('RGB',(1280,4*214),(9,14,19));draw=ImageDraw.Draw(sheet);mask=z['masks'][0].any(0).astype('uint8');contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE);nextsample=0;count=0
    for t,pts,tb,frame in frames(source,start,8):
        count+=1
        if nextsample<16 and t>=start+nextsample*.5:
            ix=int(np.floor((t-int(clipstart))*10+1e-6));aligned=cv2.warpAffine(frame,base['transform'][ix],(640,360));cv2.drawContours(aligned,contours,-1,(90,255,120),1)
            k=nextsample;x=k%4*320;y=k//4*214;sheet.paste(Image.fromarray(aligned).resize((320,180)),(x,y+34));draw.text((x+4,y+2),f'{show} {t:.3f}s',fill='white',font=font);draw.text((x+4,y+18),'green = measured region',fill=(90,255,120),font=font);nextsample+=1
    assert nextsample==16
    with (out/(stem+'_sheet.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=92)
    video=out/(stem+'.mp4')
    subprocess.run(['ffmpeg','-v','error','-n','-ss',str(start),'-i',source,'-t','8','-map','0:v:0','-map','0:a:0','-vf','scale=960:540','-c:v','libx264','-preset','fast','-crf','21','-c:a','aac','-b:a','192k','-movflags','+faststart',str(video)],check=True)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_type,nb_read_frames,duration,channels','-of','json',str(video)]));v=next(x for x in probe['streams'] if x['codec_type']=='video');audio=next(x for x in probe['streams'] if x['codec_type']=='audio');assert abs(float(v['duration'])-8)<.05 and audio['channels']==2
    reports.append(dict(clip=key,start=start,source_frames_decoded=count,samples=16,video=str(video),probe=probe,training_admitted=False));print('COMPLETE',stem,flush=True)
with (out/'review_artifacts.json').open('x') as f:json.dump(reports,f,indent=2)
