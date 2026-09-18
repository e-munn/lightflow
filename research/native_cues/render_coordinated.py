"""Single authored, past-audio-driven lighting prototype. No trained predictions."""
from pathlib import Path
import json,subprocess,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues')
OUT=ROOT/'coordinated_v2'
DEST=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_coordinated_forest_v2_9-17-26.mp4')
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
F=[ImageFont.truetype(FONT,n) for n in (28,18,15)]

def main():
    assert not DEST.exists();OUT.mkdir(exist_ok=False)
    case=json.loads((ROOT/'modulation_v1/manifest.json').read_text())['cases']['forest']
    with np.load(ROOT/'modulation_v1/forest.npz') as z:times=z['time'];features=z['scope']
    begin,end=case['display'];fps=30
    cursor=int(np.searchsorted(times,begin-10));fast=slow=0.;rise=accent=0.;last=-100.;group=0;center=.5
    grid=np.linspace(0,1,32);traces=[];states=[]
    encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r','30','-i','pipe:0','-ss',str(begin),'-i',case['source'],'-t',str(end-begin),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(DEST)],stdin=subprocess.PIPE)
    for frame in range((end-begin)*fps):
        now=begin+frame/fps
        while cursor<len(times) and times[cursor]<=now+1e-8:
            amp,spread,texture,balance,bass,air,attack,corr=features[cursor]
            fast+=(amp-fast)*(1-np.exp(-.02/.25));slow+=(amp-slow)*(1-np.exp(-.02/2.5))
            rise+=(np.clip((fast-slow)*6,0,1)-rise)*(1-np.exp(-.02/.65))
            accent*=np.exp(-.02/(.16+.2*bass))
            if attack>.42 and times[cursor]-last>.4:
                accent=.65+.35*attack;last=times[cursor];group=(group+1)%4
            center+=([.15,.85,.38,.62][group]-center)*(1-np.exp(-.02/.45))
            cursor+=1
        # A held bed, widening energy-rise field, sparse accents and moving focus coexist.
        gate=np.clip((fast-.13)/.38,0,1)
        sustain=gate*(.06+.19*slow)*( .8+.2*np.cos(grid*np.pi*2))
        build=gate*rise*.5*np.exp(-.5*((grid-.5)/(.12+.4*rise))**2)
        motion=gate*(.12+.32*amp)*(1-.65*rise)*np.exp(-.5*((grid-center)/(.045+.6*spread))**2)
        hits=accent*.65*np.where((np.arange(32)//4)%2==group%2,1.,.03)
        levels=np.clip(1-(1-sustain)*(1-build)*(1-motion)*(1-hits),0,1)
        traces.append(levels);states.append([float(slow),float(rise),float(accent),float(center)])
        im=Image.new('RGB',(1280,720),(4,8,13));glow=Image.new('RGB',im.size);gd=ImageDraw.Draw(glow)
        for j,v in enumerate(levels):
            x=40+j*38;col=tuple(int(q*float(v)**.55) for q in (122,233,222))
            gd.polygon([(x-7,567),(x+7,567),(x+40,204),(x-40,204)],fill=tuple(int(c*.8) for c in col))
            gd.ellipse((x-17,550,x+17,584),fill=col)
        im=Image.blend(im,glow.filter(ImageFilter.GaussianBlur(14)),.85);d=ImageDraw.Draw(im)
        d.text((28,22),'LIGHTFLOW / ONE COORDINATED PERFORMANCE',font=F[0],fill='#e3f3ed')
        d.text((28,64),'Of The Trees · Electric Forest · same one-minute passage',font=F[1],fill='#a8c5ba')
        d.text((28,95),'Authored audio-driven rules — not trained or predictive. Listen for connected and arbitrary moments.',font=F[1],fill='#ecc38c')
        d.line((28,590,1252,590),fill='#233531',width=2)
        for j,v in enumerate(levels):
            x=40+j*38;col=tuple(int(q*float(v)**.55) for q in (150,255,235))
            d.line((x,245,x,553),fill=tuple(int(c*.75) for c in col),width=8)
            d.ellipse((x-7,559,x+7,573),fill=col)
        labels=[('SUSTAIN',gate*(.06+.19*slow)*3),('BUILD',rise),('ACCENT',accent),('MOVEMENT',gate*(1-.65*rise))]
        for k,(label,value) in enumerate(labels):
            x=28+k*308;d.text((x,617),label,font=F[2],fill='#9bb8ad');d.rectangle((x,643,x+260,647),fill='#172923');d.rectangle((x,643,x+int(260*np.clip(value,0,1)),647),fill='#79b7a6')
        d.text((28,675),f'{frame/fps:04.1f} / 60 seconds    ·    Layers blend continuously; accents and focus respond to audio attacks.',font=F[1],fill='#b2c9be')
        encoder.stdin.write(im.tobytes())
        if frame in (90,300,750,1200):
            with (OUT/f'frame_{frame:04d}.jpg').open('xb') as f:im.save(f,'JPEG',quality=94)
        if frame%300==0:print('FRAME',frame,flush=True)
    encoder.stdin.close();assert encoder.wait()==0
    with (OUT/'trace.npz').open('xb') as f:np.savez_compressed(f,levels=traces,states=states)
    with (OUT/'manifest.json').open('x') as f:json.dump({'source':case['source'],'interval':[begin,end],'video':str(DEST),'authored':True,'trained':False,'predictive':False,'past_audio_only':True,'warmup_seconds':10,'build':'positive .25s vs 2.5s energy difference, .65s smoothing; not phrase detection','blend':'one minus product of complementary layer intensities','states':['slow_energy','rise','accent','focus_position'],'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)
if __name__=='__main__':main()
