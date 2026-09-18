"""Fixed Forest comparison of observations, scope, and learned cue probabilities."""
from pathlib import Path
import argparse, hashlib, importlib.util, json, subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from native_frames import frames

HERE=Path(__file__).parent; ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
spec=importlib.util.spec_from_file_location('direct_scope_display',HERE.parent/'music_encoder/render_probe.py')
direct=importlib.util.module_from_spec(spec); spec.loader.exec_module(direct)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
TITLE=ImageFont.truetype(FONT,28); BODY=ImageFont.truetype(FONT,21); SMALL=ImageFont.truetype(FONT,17)
BEGIN,DURATION,FPS,SR=1860,60,30,48000
COLORS={'learned':(194,160,250),'instant_context':(100,217,213),'amplitude_only':(239,188,105)}


def graph(draw,prediction,now,index,head,x,y):
    width,height=416,113; times=prediction['time']
    title=['Brighten / 100-300 ms','Dim / 100-300 ms','Brighten / 300-1,000 ms','Dim / 300-1,000 ms'][head]
    draw.text((x,y-32),title,font=BODY,fill=(218,231,226))
    for value in [0,.5,1]:
        yy=y+(1-value)*height; draw.line((x,yy,x+width,yy),fill=(45,59,64))
        draw.text((x+4,yy-19),f'{value:g}',font=SMALL,fill=(127,154,149))
    ids=np.flatnonzero((times>=now-12)&(times<=now+1e-8))
    assert len(ids) and ids[-1]<=index
    for name,color in COLORS.items():
        points=[(x+(times[i]-now+12)/12*width,y+(1-float(prediction[name][i,head]))*height) for i in ids]
        if len(points)>1:draw.line(points,fill=color,width=2)
    draw.text((x+width-51,y-31),f'{prediction["learned"][index,head]:.2f}',font=SMALL,fill=COLORS['learned'])


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--run',type=Path,required=True)
    ap.add_argument('--dataset',type=Path,required=True); ap.add_argument('--out',type=Path,required=True)
    args=ap.parse_args(); args.out.mkdir(parents=True,exist_ok=False); cv2.setNumThreads(1)
    cfg=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']['forest']; source=cfg['source']
    # NpzFile indexing decompresses each access. Materialize once, especially
    # for the per-point chart loop; repeated decompression dominates rendering.
    with np.load(args.run/'forest_1800.npz') as bundle: pred={k:bundle[k] for k in bundle.files}
    with np.load(args.dataset/'forest_1800.npz') as bundle: obs={k:bundle[k] for k in bundle.files}
    with np.load(ROOT/'wide_lights/dataset_v1/forest/1800.npz') as bundle: geometry={'transform':bundle['transform']}
    signal=np.loadtxt(ROOT/'wide_lights/audio_v1/forest_1800.csv',delimiter=',',skiprows=1)
    audio_begin=BEGIN-1
    raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(audio_begin),'-i',source,'-t',str(DURATION+1),'-vn','-ac','2','-ar',str(SR),'-f','f32le','pipe:1'])
    audio=np.frombuffer(raw,'<f4').reshape(-1,2)
    assert len(audio)>=(DURATION+1)*SR and np.isfinite(audio).all()
    stream=frames(source,BEGIN-1,DURATION+1); upcoming=next(stream); current=None
    dest=args.out/'forest_31m_native_forecast.mp4'
    encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x1080','-r',str(FPS),'-i','pipe:0',
        '-ss',str(BEGIN),'-i',source,'-t',str(DURATION),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19',
        '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(dest)],stdin=subprocess.PIPE)
    samples=[]; max_source_age=0; max_prediction_age=0
    for frame_id in range(DURATION*FPS):
        now=BEGIN+frame_id/FPS
        while upcoming is not None and upcoming[0]<=now+1e-8:
            current=upcoming; upcoming=next(stream,None)
        assert current is not None
        second,_,_,frame=current
        ix=int(np.searchsorted(obs['time'],now+1e-8,side='right')-1)
        p=int(np.searchsorted(pred['time'],now+1e-8,side='right')-1)
        s=int(np.searchsorted(signal[:,0],now+1e-8,side='right')-1)
        assert abs(obs['time'][ix]-second)<1e-8 and second<=now+1e-8 and pred['time'][p]<=now+1e-8
        max_source_age=max(max_source_age,now-second); max_prediction_age=max(max_prediction_age,now-pred['time'][p])
        endpoint=signal[s,0]; last=round((endpoint-audio_begin)*SR); block=audio[last-960:last]
        assert len(block)==960 and endpoint<=now+1e-8
        g=int(np.floor((second-1800)*10+1e-6)); aligned=cv2.warpAffine(frame,geometry['transform'][g],(640,360))
        shot=Image.fromarray(aligned); sd=ImageDraw.Draw(shot)
        ys,xs=np.where(obs['masks'][0].any(0)); sd.rectangle((int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max())),outline=(110,238,168),width=1)
        canvas=Image.new('RGB',(1440,1080),(6,13,18)); draw=ImageDraw.Draw(canvas)
        draw.text((23,18),'LIGHTFLOW / TRAINED NATIVE-CUE MODEL',font=TITLE,fill=(224,238,231))
        draw.text((23,60),f'Of The Trees / Forest  {int(now//60):02d}:{now%60:04.1f}  |  Fixed development passage  |  Original recording audio',font=BODY,fill=(158,185,173))
        for box in [(20,102,704,535),(724,102,1420,535),(20,550,416,997),(436,550,1420,997)]:
            draw.rounded_rectangle(box,radius=12,fill=(17,26,33))
        draw.text((40,116),'Source / observed light field',font=BODY,fill=(221,234,228)); canvas.paste(shot,(42,151))
        valid=bool(obs['geometry_valid'][ix]); energy=float(obs['target'][ix,0,8:12].mean())
        draw.text((42,512),f'Measured energy {energy:.3f}  /  geometry '+('known' if valid else 'UNKNOWN'),font=SMALL,fill=(160,192,174) if valid else (236,184,125))
        draw.text((744,116),'Stereo scope / immediate reference',font=BODY,fill=(221,234,228))
        scope=Image.new('RGB',(430,360),(5,10,12)); sd=ImageDraw.Draw(scope); unit=360*.44
        sd.line((215-unit,180,215+unit,180),fill=(24,39,42)); sd.line((215,180-unit,215,180+unit),fill=(24,39,42))
        sd.line([(215+float(l)*1.5*unit,180-float(r)*1.5*unit) for l,r in block],fill=(169,255,223),width=1)
        canvas.paste(scope,(744,151)); values=signal[s,1:9]
        for j,(name,value) in enumerate(zip(['Amplitude','Spread','Texture'],values[:3])):
            draw.text((1194,175+j*68),name,font=SMALL,fill=(153,179,171)); draw.text((1194,200+j*68),f'{value:.3f}',font=BODY,fill=(220,235,229))
        for j,line in enumerate(['20 ms window','Fixed gain 1.5','No persistence','30 fps export']):
            draw.text((1194,392+j*25),line,font=SMALL,fill=(153,179,171))
        draw.text((38,565),'Direct light signal',font=BODY,fill=(221,234,228))
        draw.text((38,596),'Scope features / procedural mapping',font=SMALL,fill=(151,181,167))
        intensity,hue,levels=direct.light_values(values)
        draw.rectangle((38,643,398,820),fill=direct.hsl(hue,intensity*.75))
        for j,level in enumerate(levels):draw.rectangle((38+j*45+3,843,38+(j+1)*45-3,941),fill=direct.hsl(hue,level*.8))
        draw.text((38,962),'Learned cues are not driving this panel.',font=SMALL,fill=(220,187,137))
        draw.text((456,565),'Forecast probabilities / trailing 12 seconds',font=BODY,fill=(221,234,228))
        for j,(name,color) in enumerate(COLORS.items()):
            draw.text((456+j*310,595),{'learned':'Trained temporal model','instant_context':'Current audio context','amplitude_only':'Loudness control'}[name],font=SMALL,fill=color)
        for head,(x,y) in enumerate([(466,678),(959,678),(466,877),(959,877)]): graph(draw,pred,now,p,head,x,y)
        draw.text((23,1022),'Model weights are trained. Probability traces are a comparison, not approval of learned musical direction.',font=BODY,fill=(229,195,141))
        draw.text((23,1056),'Source-frame timing retained. No future audio in predictions. Physical input-to-light latency and source A/V offset remain unmeasured.',font=SMALL,fill=(151,181,167))
        encoder.stdin.write(canvas.tobytes())
        if frame_id in [0,900,1770]:
            with (args.out/f'frame_{frame_id:04d}.jpg').open('xb') as f:canvas.save(f,format='JPEG',quality=92)
            samples.append({'time':now,'source_pts':second,'audio_endpoint':float(endpoint),'prediction_endpoint':float(pred['time'][p]),'scope_features':values.tolist(),
                            'intensity':float(intensity),'hue':float(hue),'zone_levels':[float(v) for v in levels]})
        if frame_id%300==0: print('FRAME',frame_id,flush=True)
    stream.close(); encoder.stdin.close(); assert encoder.wait()==0
    with (args.out/'manifest.json').open('x') as f:
        json.dump({'source':source,'run':str(args.run),'interval_seconds':[BEGIN,BEGIN+DURATION],'frames':DURATION*FPS,'fps':FPS,
            'scope_window_ms':20,'scope_gain':1.5,'scope_persistence':0,'max_source_age_seconds':max_source_age,'max_prediction_age_seconds':max_prediction_age,
            'learned_cues_enabled':False,'source_av_offset':'unknown','physical_latency':'unmeasured','samples':samples,
            'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)
    print('COMPLETE',dest,flush=True)


if __name__=='__main__':main()
