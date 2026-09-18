"""One scalar brightness baseline, with an exact trace of the displayed value."""
from pathlib import Path
import json,subprocess,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues')
OUT=ROOT/'brightness_v1'
DEST=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_brightness_forest_v1_9-17-26.mp4')

def main():
    assert not DEST.exists();OUT.mkdir(exist_ok=False)
    case=json.loads((ROOT/'modulation_v1/manifest.json').read_text())['cases']['forest']
    with np.load(ROOT/'modulation_v1/forest.npz') as z:times=z['time'];scope=z['scope']
    begin,end=case['display'];cursor=int(np.searchsorted(times,begin-5));level=0.;trace=[]
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',20)
    enc=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','30','-i','pipe:0','-ss',str(begin),'-i',case['source'],'-t',str(end-begin),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(DEST)],stdin=subprocess.PIPE)
    for frame in range(1800):
        now=begin+frame/30
        while cursor<len(times) and times[cursor]<=now+1e-8:
            target=float(np.clip(scope[cursor,0],0,1))
            tau=.015 if target>level else .085
            level+=(target-level)*(1-np.exp(-.02/tau));cursor+=1
        trace.append(level);v=round(255*level)
        im=Image.new('RGB',(1280,720),(v,v,v));d=ImageDraw.Draw(im)
        d.rectangle((0,535,1280,720),fill='#080e12')
        d.text((24,548),f'ONE CHANNEL / brightness {level:.3f}     {frame/30:04.1f} / 60 s',font=font,fill='#dbe6e2')
        d.text((24,578),'Direct audio baseline · not trained · trace shows the same brightness value',font=font,fill='#96aba3')
        d.line((24,615,1256,615),fill='#33443e');d.line((24,695,1256,695),fill='#33443e')
        recent=trace[-240:];pts=[(1256-(len(recent)-1-j)*1232/239,695-float(a)*80) for j,a in enumerate(recent)]
        if len(pts)>1:d.line(pts,fill='#a7dbca',width=2)
        enc.stdin.write(im.tobytes())
        if frame in [90,300,750]:
            with (OUT/f'frame_{frame:04d}.jpg').open('xb') as f:im.save(f,'JPEG',quality=94)
        if frame%600==0:print('FRAME',frame,flush=True)
    enc.stdin.close();assert enc.wait()==0
    assert np.isfinite(trace).all() and min(trace)>=0 and max(trace)<=1
    with (OUT/'brightness.json').open('x') as f:json.dump({'fps':30,'brightness':trace},f)
    with (OUT/'manifest.json').open('x') as f:json.dump({'source':case['source'],'interval':[begin,end],'video':str(DEST),'outputs':['brightness'],'trained':False,'predictive':False,'rule':'scope amplitude 1-exp(-6*rms), one-pole 15ms attack / 85ms release, no normalization per excerpt','display':'neutral RGB code value round(255*brightness); not calibrated physical luminance','warmup_seconds':5,'range':[min(trace),max(trace)],'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)
if __name__=='__main__':main()
