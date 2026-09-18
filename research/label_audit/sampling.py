"""Measure temporal-sampling sensitivity with fixed geometry and source spans."""
from pathlib import Path
import argparse, hashlib, json, subprocess
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from profile import ROOT, HERE, event_match
from targets import suppress

CASES = [('ravenscoon',3000),('alleycvt',1800),('griz',1800),('levity_forest',2100),('forest',1800)]
OFFSETS = [60,180]
LUMA = np.array([.2126,.7152,.0722],np.float32)


def detect(times, energy, valid, fps, left, right):
    lag=round(.3*fps)
    support=np.zeros(len(times),bool)
    support[lag:]=np.logical_and.reduce([valid[j:len(valid)-lag+j] for j in range(lag+1)])
    delta=np.zeros(len(times));delta[lag:]=energy[lag:]-energy[:-lag]
    result={}
    for name,sign in [('rise',1),('release',-1)]:
        strength=sign*delta
        ids=suppress(np.flatnonzero(support&(strength>=.25)),strength,radius=lag)
        ids=ids[(times[ids]>=left-1e-6)&(times[ids]<right-1e-6)]
        result[name]=times[ids]
    return result


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    records={}
    font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
    for show,start in CASES:
        cfg=catalog[show]
        obs=np.load(ROOT/'wide_lights/dataset_v1'/show/f'{start:04d}.npz')
        labels=np.load(ROOT/'light_events/labels_v2'/f'{show}_{start:04d}.npz')
        x0,y0,x1,y1=[round(x*2/3) for x in cfg['stage_box']]
        edges=np.linspace(x0,x1,5).round().astype(int)
        masks=[]
        for a,b in zip(edges[:-1],edges[1:]):
            m=np.zeros((360,640),bool);m[y0:y1,a:b]=True
            for box in cfg['exclude']:
                e,f,g,h=[round(x*2/3) for x in box];m[f:h,e:g]=False
            masks.append(m)
        for offset in OFFSETS:
            key=f'{show}_{start:04d}_{offset:03d}'
            # Start at the original clip origin so the fps filter has the same
            # phase convention; trim only after placing frames on its time grid.
            left=start+offset;right=left+20;first=left-1
            vf=f'fps=30,trim=start={offset-1}:end={offset+21},setpts=PTS-STARTPTS,scale=640:360'
            decoder=subprocess.Popen(['ffmpeg','-v','error','-threads','2','-filter_threads','1',
                '-ss',str(start),'-t',str(offset+22),'-i',cfg['source'],'-vf',vf,
                '-an','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
            times=[];energy=[];valid=[];quality=[];snapshot=[]
            for j in range(22*30):
                raw=decoder.stdout.read(640*360*3)
                if len(raw)!=640*360*3:raise RuntimeError(f'Short decode {key} frame {j}')
                now=first+j/30
                ix=int(np.floor((now-start)*10+1e-6))
                frame=np.frombuffer(raw,np.uint8).reshape(360,640,3)
                aligned=cv2.warpAffine(frame,obs['transform'][ix],(640,360))
                value=[];clipped=[]
                for m in masks:
                    pixels=aligned[m].astype(np.float32)/255
                    value.append(1-np.exp(-6*float((pixels@LUMA).mean())))
                    clipped.append(float((pixels.max(1)>=250/255).mean()))
                times.append(now);energy.append(value);valid.append(bool(labels['geometry_valid'][ix]));quality.append(clipped)
                if j in [30,330,600]:
                    shot=Image.fromarray(aligned);d=ImageDraw.Draw(shot)
                    d.rectangle((x0,y0,x1,y1),outline=(141,242,202),width=2)
                    for box in cfg['exclude']:d.rectangle(tuple(round(x*2/3) for x in box),outline=(255,173,102),width=2)
                    snapshot.append((now,shot,bool(labels['geometry_valid'][ix])))
            assert not decoder.stdout.read(1), 'Unexpected additional frames'
            decoder.stdout.close();assert decoder.wait()==0
            times=np.array(times);energy=np.array(energy,np.float32);valid=np.array(valid)
            mean=energy.mean(1)
            modes={'30hz':detect(times,mean,valid,30,left,right)}
            for phase in range(3):
                modes[f'10hz_phase{phase}']=detect(times[phase::3],mean[phase::3],valid[phase::3],10,left,right)
            modes['stored_10hz']={name:labels['time'][labels[name]][(labels['time'][labels[name]]>=left)&(labels['time'][labels[name]]<right)] for name in ['rise','release']}
            rec={'show':show,'split':cfg['split'],'start':left,'duration':20,
                 'source':cfg['source'],'geometry_fraction':float(valid[(times>=left)&(times<right)].mean()),
                 'event_times':{mode:{k:v.tolist() for k,v in events.items()} for mode,events in modes.items()},
                 'versus_30hz':{mode:{name:event_match(modes['30hz'][name],events[name]) for name in ['rise','release']} for mode,events in modes.items() if mode!='30hz'},
                 'between_10hz_phases':{f'{a}_vs_{b}':{name:event_match(modes[f'10hz_phase{a}'][name],modes[f'10hz_phase{b}'][name]) for name in ['rise','release']} for a,b in [(0,1),(0,2),(1,2)]}}
            records[key]=rec
            with (args.out/(key+'.npz')).open('xb') as f:
                np.savez_compressed(f,time=times,energy=energy,valid=valid,clipped_fraction=np.array(quality))
            sheet=Image.new('RGB',(1280,3*395),(9,16,21));draw=ImageDraw.Draw(sheet)
            for row,(second,shot,ok) in enumerate(snapshot):
                draw.text((10,row*395+7),f'{key} / {second:.2f}s / geometry valid: {ok} / source and enlarged measured region',font=font,fill='white')
                sheet.paste(shot,(0,row*395+30))
                crop=shot.crop((x0,y0,x1,y1));crop.thumbnail((600,350))
                # Enlarge without altering color/brightness.
                ratio=min(600/crop.width,350/crop.height)
                crop=crop.resize((round(crop.width*ratio),round(crop.height*ratio)))
                sheet.paste(crop,(660,row*395+30+(350-crop.height)//2))
            with (args.out/(key+'_source.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=91)
            print('COMPLETE',key,'geometry',round(rec['geometry_fraction'],3),
                  'events', {k:[len(v['rise']),len(v['release'])] for k,v in modes.items()},flush=True)
    with (args.out/'comparison.json').open('x') as f:json.dump(records,f,indent=2,allow_nan=False)
    with (args.out/'manifest.json').open('x') as f:json.dump({'status':'complete','cases':CASES,'offsets':OFFSETS,
        'fps':30,'geometry':'Existing 10 Hz transforms and valid mask held; not improved camera tracking',
        'event_matching_tolerance_seconds':.1,'ground_truth_precision':'Unknown; this audit measures agreement',
        'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'protocol_sha256':hashlib.sha256((HERE/'PROTOCOL.md').read_bytes()).hexdigest()},f,indent=2)


if __name__=='__main__':main()
