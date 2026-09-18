"""Authored output-contract proposals, not learned cues or recovered lighting intent."""
from pathlib import Path
import json, subprocess, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues')
OUT=ROOT/'authored_directions_v1'
DEST=Path('/Volumes/ExtremePro/Movies/Exports/lightflow_authored_directions_forest_9-17-26.mp4')
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
F=[ImageFont.truetype(FONT,n) for n in [30,24,18]]
NAMES=['A / SUSTAIN','B / BUILD + RELEASE','C / ACCENT + REST','D / SPATIAL TRANSITION']
DESC=['A held field; fine detail rides on top.','Authored 12-second rise, then a short release.','Strong audio attacks; decay into darkness.','Audio attacks move the focus between groups.']

def main():
    assert not DEST.exists()
    OUT.mkdir(exist_ok=False)
    case=json.loads((ROOT/'modulation_v1/manifest.json').read_text())['cases']['forest']
    with np.load(ROOT/'modulation_v1/forest.npz') as z:
        times=z['time'];scope=z['scope']
    begin,end=case['display'];fps=30;duration=end-begin
    trace=[];accent=0.;last_hit=-100.;group=0;center=.15;slow=.5;cursor=int(np.searchsorted(times,begin))
    encoder=subprocess.Popen(['ffmpeg','-n','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1440x1000','-r',str(fps),'-i','pipe:0','-ss',str(begin),'-i',case['source'],'-t',str(duration),'-map','0:v','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(DEST)],stdin=subprocess.PIPE)
    xgrid=np.linspace(0,1,24)
    for frame in range(duration*fps):
        t=frame/fps;now=begin+t
        while cursor<len(times) and times[cursor]<=now+1e-8:
            amp,spread,texture,balance,bass,air,attack,corr=scope[cursor]
            slow+=.02/1.5*(amp-slow);accent*=np.exp(-.02/.22)
            if attack>.42 and times[cursor]-last_hit>.4:
                accent=min(1.,.65+.35*attack);last_hit=times[cursor];group=(group+1)%4
            target=[.12,.88,.38,.62][group];center+=(target-center)*(.02/.32)
            cursor+=1
        a=(.30+.40*slow+.15*amp)*( .85+.15*np.cos(xgrid*np.pi*2))
        phase=(t%16)/12
        envelope=(.06+.84*min(phase,1)**1.6) if phase<1 else .9*np.exp(-(t%16-12)/.6)
        b=envelope*(.55+.45*amp)*np.exp(-.5*((xgrid-.5)/(.07+.43*min(phase,1)))**2)
        c=accent*(.6+.4*amp)*np.where((np.arange(24)//3)%2==group%2,1.,.08)
        d=(.35+.6*amp)*np.exp(-.5*((xgrid-center)/(.06+.22*spread))**2)
        levels=np.clip([a,b,c,d],0,1);trace.append(levels)
        im=Image.new('RGB',(1440,1000),(6,12,17));dr=ImageDraw.Draw(im)
        dr.text((28,22),'LIGHTFLOW / FOUR POSSIBLE DIRECTIONS',font=F[0],fill='#e3f3ed')
        dr.text((28,66),'Of The Trees / Electric Forest 31:00–32:00 · same audio, same palette and light layout',font=F[2],fill='#a8c5ba')
        dr.text((28,96),'AUTHORED EXAMPLES — no trained model. The build timing is a design sketch, not a detected phrase.',font=F[2],fill='#ecc38c')
        for k,(x,y) in enumerate([(24,152),(732,152),(24,550),(732,550)]):
            dr.rounded_rectangle((x,y,x+684,y+372),12,fill='#0d191f',outline='#29413f')
            dr.text((x+18,y+15),NAMES[k],font=F[1],fill='#e0eee7')
            dr.text((x+18,y+51),DESC[k],font=F[2],fill='#9bb8ad')
            # Identical fixture geometry/palette: all differences come from the envelopes.
            for j,v in enumerate(levels[k]):
                xx=x+20+j*27
                col=tuple(int(q*v) for q in (160,244,223))
                dr.rectangle((xx,y+106,xx+19,y+282),fill=tuple(int(q*.38) for q in col))
                dr.rectangle((xx,y+283-int(v*150),xx+19,y+283),fill=col)
                dr.ellipse((xx,y+299,xx+19,y+318),fill=col)
            label=['HELD / breathing with energy',f'{"BUILD" if phase<1 else "RELEASE"} / {t%16:04.1f}s in authored cycle', 'ACCENT' if accent>.2 else 'REST',f'FOCUS / group {group+1}'][k]
            dr.text((x+18,y+338),label,font=F[2],fill='#c1d4cc')
        dr.text((28,951),f'{t:04.1f} / 60 seconds   ·   Compare sustained presence, anticipation, restraint and movement.',font=F[2],fill='#b2c9be')
        dr.rectangle((28,983,28+int(1384*t/duration),988),fill='#79b7a6')
        encoder.stdin.write(im.tobytes())
        if frame in (90,300,390,750,1200):
            with (OUT/f'frame_{frame:04d}.jpg').open('xb') as f:im.save(f,'JPEG',quality=94)
        if frame%300==0:print('FRAME',frame,flush=True)
    encoder.stdin.close();assert encoder.wait()==0
    with (OUT/'fixture_levels.npy').open('xb') as f:np.save(f,np.asarray(trace,dtype=np.float32))
    report={'authored':True,'trained':False,'source':case['source'],'source_interval':[begin,end],'video':str(DEST),'fps':fps,'frames':len(trace),'rules':DESC,'build_schedule':'16 s cycle: 12 s rise, 4 s release; authored, not inferred','attack_rule':'attack > .42 with .4 s refractory, .22 s decay','spatial_rule':'attack advances group; .32 s position smoothing','code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'human_quality_approval':False}
    with (OUT/'manifest.json').open('x') as f:json.dump(report,f,indent=2)
    print(DEST,flush=True)

if __name__=='__main__':main()
