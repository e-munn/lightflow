"""Same frames, same regions, three extraction choices. Original audio retained."""
from pathlib import Path
import json,subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from pixels import observe

SOURCE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26-194931/concerts/of_the_trees_electric_forest_25_Cxb4TCmXG1c.mp4')
OUT=Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights/pixel_comparison_v1')
EXPORT=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_pixel_methods_9-16-26.mp4')
START=2560;DURATION=60;FPS=30;W=640;H=360
BOXES=[tuple(round(v*2/3) for v in (310+i*80,212,390+i*80,328)) for i in range(4)]


def main():
    OUT.mkdir(parents=True,exist_ok=False)
    dec=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-ss',str(START),'-i',str(SOURCE),'-t',str(DURATION),'-vf',f'fps={FPS},scale={W}:{H}','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
    enc=subprocess.Popen(['ffmpeg','-v','error','-n','-f','rawvideo','-pix_fmt','rgb24','-s','1440x900','-r',str(FPS),'-i','pipe:0','-ss',str(START),'-i',str(SOURCE),'-t',str(DURATION),'-map','0:v','-map','1:a','-c:v','libx264','-threads','2','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(EXPORT)],stdin=subprocess.PIPE)
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',19);big=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',27)
    rows=[]
    try:
        while True:
            raw=dec.stdout.read(W*H*3)
            if not raw:break
            frame=np.frombuffer(raw,np.uint8).reshape(H,W,3);i=len(rows)
            values=[observe(frame[y0:y1,x0:x1]) for x0,y0,x1,y1 in BOXES]
            rows.append({'seconds':START+i/FPS,'regions':values})
            im=Image.new('RGB',(1440,900),(8,14,18));d=ImageDraw.Draw(im)
            d.text((28,22),'LIGHTFLOW / WHICH PIXELS SHOULD TEACH THE MODEL?',font=big,fill=(225,241,234))
            d.text((28,62),f'Same source, same boxes, same instant / {int(START+i/FPS)//60:02d}:{(START+i/FPS)%60:05.2f}',font=font,fill=(143,173,168))
            im.paste(Image.fromarray(frame),(28,112))
            for x0,y0,x1,y1 in BOXES:d.rectangle((28+x0,112+y0,28+x1,112+y1),outline=(136,231,201),width=1)
            d.text((715,121),'A / BRIGHTEST PIXELS',font=big,fill=(208,233,223))
            d.text((715,162),'The existing preview. Sensitive to small lights.',font=font,fill=(145,168,167))
            d.text((715,195),'Peaks can clip or hide changes in lit area.',font=font,fill=(145,168,167))
            for j,v in enumerate(values):d.rectangle((715+j*171,249,873+j*171,415),fill=tuple(int(255*np.clip(c,0,1)) for c in v['top_rgb']))
            for col,(key,title,line) in enumerate([('area_rgb','B / AREA AND COLOR','Fixed gain on average RGB; broad light carries more weight.'),('intensity_color_rgb','C / AREA + UNCLIPPED COLOR','Brightness from area; color only where enough evidence survives.')]):
                x=28+col*715
                d.text((x,515),title,font=big,fill=(208,233,223));d.text((x,557),line,font=font,fill=(145,168,167))
                for j,v in enumerate(values):
                    d.rectangle((x+j*171,610,x+j*171+158,769),fill=tuple(int(255*np.clip(c,0,1)) for c in v[key]))
                    if col==1 and not v['color_valid']:d.text((x+j*171+5,781),'color unknown',font=font,fill=(235,182,132))
            d.text((28,848),'Observed image behavior, not model output. No per-frame gain normalization. Unknown color is masked during training.',font=font,fill=(163,184,177))
            if i in [0,450,900,1350]:
                with (OUT/f'frame_{i:04d}.jpg').open('xb') as f:im.save(f,format='JPEG',quality=90)
            enc.stdin.write(im.tobytes())
        dec.stdout.close();assert dec.wait()==0;enc.stdin.close();assert enc.wait()==0
    finally:
        for p in [dec,enc]:
            if p.poll() is None:p.terminate();p.wait()
    with (OUT/'observations.json').open('x') as f:json.dump(rows,f,indent=2,allow_nan=False)
    with (OUT/'manifest.json').open('x') as f:json.dump({'source':str(SOURCE),'source_start':START,'duration':DURATION,'fps':FPS,'export':str(EXPORT),'boxes_640x360':BOXES,'accepted_training_seconds':0,'purpose':'Extraction-method comparison, not model evaluation'},f,indent=2)
    with Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/SOURCES.md').open('a') as f:f.write('\n- `../../Exports/'+EXPORT.name+'` — three pixel-extraction methods on user-supplied Forest wide recording Cxb4TCmXG1c, 42:40–43:40; rights UNKNOWN; source retained.\n')
    print('COMPLETE',EXPORT,flush=True)


if __name__=='__main__':main()
