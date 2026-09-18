"""Same light renderer for direct, learned, simple and delayed-model conditions."""
from pathlib import Path
import argparse,colorsys,hashlib,json,subprocess
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames

HERE=Path(__file__).parent
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE=ImageFont.truetype(FONT,29);BODY=ImageFont.truetype(FONT,22);SMALL=ImageFont.truetype(FONT,17)
NAMES=['Direct scope signal','With learned modulation','With simple audio control','With delayed-model control']
DESCRIPTIONS=['Reference / no learned change','Trained temporal model / candidate','Current-context logistic / same policy','17 s delayed model input / direct audio unchanged']


def rgb(hue,lightness):
    return tuple(round(v*255) for v in colorsys.hls_to_rgb(float(hue),float(lightness),.55))


def panel(draw,x,y,values,k):
    intensity,hue,spread,texture,balance,accent,gain,spread_gain=values
    draw.rounded_rectangle((x,y,x+684,y+288),radius=12,fill=(17,26,33))
    draw.text((x+18,y+13),NAMES[k],font=BODY,fill=(221,236,229))
    draw.text((x+18,y+44),DESCRIPTIONS[k],font=SMALL,fill=(154,180,170))
    draw.rectangle((x+18,y+78,x+666,y+178),fill=rgb(hue,intensity*.75))
    for j in range(8):
        envelope=np.exp(-.5*(((j+.5)/8-(.5+balance*.36))/(.1+spread*.55))**2)
        detail=1-texture*.45+(j%2)*texture*.45
        level=intensity*(.18+.82*envelope)*detail
        draw.rectangle((x+18+j*81+4,y+195,x+18+(j+1)*81-4,y+250),fill=rgb(hue,level*.8))
    draw.text((x+18,y+264),f'Intensity {intensity:.3f}   /   gain {gain:.3f}   /   spread {spread:.3f}',font=SMALL,fill=(169,197,181))


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--data',type=Path,required=True);ap.add_argument('--out',type=Path,required=True)
    args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=False)
    config=json.loads((args.data/'manifest.json').read_text());report={}
    for key,case in config['cases'].items():
        with np.load(args.data/(key+'.npz')) as bundle:data={k:bundle[k] for k in bundle.files}
        source=case['source'];begin,end=case['display'];duration=end-begin;fps=30;sr=48000
        raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(begin-1),'-i',source,'-t',str(duration+1),'-vn','-ac','2','-ar',str(sr),'-f','f32le','pipe:1'])
        audio=np.frombuffer(raw,'<f4').reshape(-1,2)
        assert len(audio)>=(duration+1)*sr and np.isfinite(audio).all()
        decoder=frames(source,begin-1,duration+1);upcoming=next(decoder);current=None
        dest=args.out/(key+'_modulation.mp4')
        encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x1080','-r',str(fps),'-i','pipe:0',
            '-ss',str(begin),'-i',source,'-t',str(duration),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19',
            '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
        max_source_age=0;max_audio_age=0;max_prediction_age=0;samples=[]
        for frame_id in range(duration*fps):
            now=begin+frame_id/fps
            while upcoming is not None and upcoming[0]<=now+1e-8:
                current=upcoming;upcoming=next(decoder,None)
            assert current is not None
            second,_,_,source_frame=current
            i=int(np.searchsorted(data['time'],now+1e-8,side='right')-1);at=data['time'][i]
            assert at<=now+1e-8 and second<=now+1e-8
            used=data['prediction_index'][i];assert (used>=0).all()
            assert (data['prediction_time'][used]+.02<=at+1e-8).all()
            max_source_age=max(max_source_age,now-second);max_audio_age=max(max_audio_age,now-at)
            max_prediction_age=max(max_prediction_age,float(np.max(now-data['prediction_time'][used])))
            last=round((at-begin+1)*sr);block=audio[last-960:last];assert len(block)==960
            canvas=Image.new('RGB',(1440,1080),(6,13,18));draw=ImageDraw.Draw(canvas)
            draw.text((22,18),'LIGHTFLOW / DOES LEARNED MODULATION ADD EXPRESSION?',font=TITLE,fill=(223,238,230))
            draw.text((22,63),f'{case["label"]}   {int(now//60):02d}:{now%60:04.1f}   /   {case["role"]}',font=BODY,fill=(158,187,174))
            draw.text((22,106),'Source footage / original audio',font=SMALL,fill=(209,229,217))
            canvas.paste(Image.fromarray(source_frame).resize((440,248)),(22,136))
            draw.text((498,106),'Stereo scope / 20 ms, gain 1.5, no persistence',font=SMALL,fill=(209,229,217))
            scope=Image.new('RGB',(440,248),(5,10,12));sd=ImageDraw.Draw(scope);unit=248*.44
            sd.line((220-unit,124,220+unit,124),fill=(26,41,43));sd.line((220,124-unit,220,124+unit),fill=(26,41,43))
            sd.line([(220+float(l)*1.5*unit,124-float(r)*1.5*unit) for l,r in block],fill=(169,255,223),width=1)
            canvas.paste(scope,(498,136))
            for j,line in enumerate(['Same fast audio signal in all four panels.','Same palette and spatial renderer.','Model changes brightness and spread.','Compare accents, detail and phrasing.','Offline candidate / musical quality unapproved.']):
                draw.text((966,149+j*42),line,font=SMALL,fill=(167,195,180) if j<4 else (230,191,136))
            for k,(x,y) in enumerate([(20,414),(736,414),(20,726),(736,726)]):panel(draw,x,y,data['output'][i,k],k)
            draw.text((22,1045),'Learned cue forecasts failed cross-show controls. This preview tests their expression; it does not replace the live scope.',font=SMALL,fill=(210,186,146))
            encoder.stdin.write(canvas.tobytes())
            if frame_id in [0,900,1770]:
                with (args.out/(key+f'_{frame_id:04d}.jpg')).open('xb') as f:canvas.save(f,format='JPEG',quality=92)
                samples.append({'time':now,'source_pts':second,'audio_endpoint':float(at),'outputs':data['output'][i].tolist()})
            if frame_id%600==0:print(key,'FRAME',frame_id,flush=True)
        decoder.close();encoder.stdin.close();assert encoder.wait()==0
        report[key]={'source':source,'interval_seconds':[begin,end],'frames':duration*fps,'fps':fps,'max_source_age_seconds':max_source_age,
            'max_audio_age_seconds':max_audio_age,'max_prediction_age_seconds':max_prediction_age,'samples':samples,'human_quality_approval':False,'physical_latency_measured':False}
    with (args.out/'manifest.json').open('x') as f:json.dump({'cases':report,'data':str(args.data),'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)


if __name__=='__main__':main()
