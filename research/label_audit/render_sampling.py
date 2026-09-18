"""Same-display comparison of observed energy at 10 and 30 Hz, with source audio."""
from pathlib import Path
import argparse,json,subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
HERE=Path(__file__).parent
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE=ImageFont.truetype(FONT,28);BODY=ImageFont.truetype(FONT,21);SMALL=ImageFont.truetype(FONT,17)


def panel(draw,x,y,label,energy,valid):
    draw.rounded_rectangle((x,y,x+678,y+195),radius=10,fill=(18,27,34))
    draw.text((x+15,y+12),label,font=BODY,fill=(221,233,227))
    if not valid:
        draw.text((x+15,y+85),'Observation unavailable / camera geometry',font=BODY,fill=(227,179,118))
        return
    for j,value in enumerate(energy):
        value=float(np.clip(value,0,1));g=round(255*value)
        draw.rectangle((x+15+j*163,y+50,x+167+j*163,y+150),fill=(g,g,g))
        draw.text((x+15+j*163,y+161),f'{value:.3f}',font=SMALL,fill=(170,193,181))


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    source=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']['forest']['source']
    sampled=np.load(ROOT/'label_audit/sampling_v2/forest_1800_060.npz')
    original=np.load(ROOT/'wide_lights/dataset_v1/forest/1800.npz')
    labels=np.load(ROOT/'light_events/labels_v2/forest_1800.npz')
    comparison=json.loads((ROOT/'label_audit/sampling_v2/comparison.json').read_text())['forest_1800_060']
    dest=args.out/'forest_sampling_31m.mp4'
    decoder=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-filter_threads','1','-ss','1800','-t','81','-i',source,
        '-vf','fps=30,trim=start=60:end=80,setpts=PTS-STARTPTS,scale=640:360','-an','-fps_mode','passthrough',
        '-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
    encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x900','-r','30','-i','pipe:0',
        '-ss','1860','-i',source,'-t','20','-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
    for frame_id in range(600):
        raw=decoder.stdout.read(640*360*3);assert len(raw)==640*360*3
        now=1860+frame_id/30
        index30=int(np.searchsorted(sampled['time'],now+1e-7,side='right')-1)
        index10=int(np.searchsorted(original['time'],now+1e-7,side='right')-1)
        assert abs(sampled['time'][index30]-now)<1e-6
        canvas=Image.new('RGB',(1440,900),(6,13,18));draw=ImageDraw.Draw(canvas)
        draw.text((22,18),'LIGHTFLOW / KEEPING THE FLASHES IN THE DATA',font=TITLE,fill=(224,236,230))
        draw.text((22,59),f'Of The Trees / Forest   31:{now-1860:04.1f}   |   Source footage + extracted observations',font=BODY,fill=(152,181,173))
        canvas.paste(Image.frombytes('RGB',(640,360),raw),(22,108))
        draw.text((698,114),'Same region, mapping and geometry masks',font=BODY,fill=(219,232,224))
        lines=['Only the video sampling changes.','Four grayscale panels show regional energy.','The 10 Hz values hold between samples.','The 30 Hz values retain more brief flashes.',
               'Rise events in this fixed 20-second passage:','30 Hz: 18     Original 10 Hz: 12','Only 7 match within 100 ms.']
        for j,line in enumerate(lines):draw.text((698,163+j*40),line,font=BODY,fill=(211,193,146) if j>3 else (161,187,177))
        panel(draw,22,493,'Original observation / 10 Hz',original['target'][index10,8:12],labels['geometry_valid'][index10])
        panel(draw,724,493,'Re-extracted observation / 30 Hz',sampled['energy'][index30],sampled['valid'][index30])
        # Fixed common history scale, with no future portion displayed.
        draw.text((24,710),'Recent regional mean / past 5 seconds',font=SMALL,fill=(183,205,193))
        left,top,width,height=25,744,1388,99
        for level in [0,.5,1]:draw.line((left,top+(1-level)*height,left+width,top+(1-level)*height),fill=(43,55,61))
        for times,values,color in [(sampled['time'],sampled['energy'].mean(1),(136,229,199)),(original['time'],original['target'][:,8:12].mean(1),(242,173,103))]:
            ids=np.flatnonzero((times>=max(1859,now-5))&(times<=now+1e-7))
            pts=[(left+(times[i]-now+5)/5*width,top+(1-float(values[i]))*height) for i in ids]
            if len(pts)>1:draw.line(pts,fill=color,width=2)
        draw.text((720,710),'Orange: original 10 Hz    Mint: 30 Hz',font=SMALL,fill=(183,205,193))
        draw.text((24,865),'Extraction audit; no learned show. 30 Hz is not ground truth. Clipping and physical light/audio offset remain unresolved.',font=SMALL,fill=(155,180,171))
        encoder.stdin.write(canvas.tobytes())
        if frame_id in [0,90,540]:
            with (args.out/f'frame_{frame_id:04d}.jpg').open('xb') as f:canvas.save(f,format='JPEG',quality=91)
    assert not decoder.stdout.read(1);decoder.stdout.close();assert decoder.wait()==0
    encoder.stdin.close();assert encoder.wait()==0
    with (args.out/'manifest.json').open('x') as f:json.dump({'source':source,'interval_seconds':[1860,1880],'fps':30,'frames':600,'observations':'Same regions and fixed mapping; original 10 Hz versus new 30 Hz','model_output':False,'source_audio':'Original recording retained; physical offset unknown','sampling_comparison':comparison},f,indent=2)
    print('COMPLETE',dest,flush=True)


if __name__=='__main__':main()
