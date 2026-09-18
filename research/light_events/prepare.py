"""Create candidate label audit, independent of model fit."""
from pathlib import Path
import argparse,json,sys,subprocess,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from targets import targets

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights')

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=False)
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())
    review=json.loads((HERE.parent/'wide_lights/review.json').read_text())
    rng=np.random.default_rng(1926);report={};samples=[]
    for show,cfg in catalog['sources'].items():
        candidates={'rise':[],'release':[],'hold':[]}
        for start in cfg['starts']:
            key=f'{show}_{start:04d}'
            if review['clips'][key]['status']!='admit_weak_appearance':continue
            data=np.load(ROOT/'dataset_v1'/show/f'{start:04d}.npz')
            y,mask,meta=targets(data['target'],data['weight'],data['transform'],data['quality'])
            with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,time=data['time'],target=y,mask=mask,**meta)
            report[key]={'split':cfg['split'],'events':{name:len(meta[name]) for name in ['rise','release']},'valid_seconds':float(meta['geometry_valid'].sum()/10),'mask_coverage':mask.mean(0).tolist(),'prevalence':((y*mask).sum(0)/np.maximum(1,mask.sum(0))).tolist()}
            for kind in ['rise','release']:
                for index in meta[kind]:
                    if index>10 and index<len(y)-25:candidates[kind].append((start,int(index),float(data['time'][index])))
            hold=np.flatnonzero((y[:,2]>0)&(mask[:,2]>0))
            hold=hold[(hold>10)&(hold<len(y)-25)][::20]
            for index in hold:candidates['hold'].append((start,int(index),float(data['time'][index])))
        # Sample without looking at model predictions. Two events of each type.
        picked=[]
        for kind,items in candidates.items():
            for i in rng.choice(len(items),min(2,len(items)),replace=False):picked.append((kind,*items[i]))
        # Decode from the original clip start with the same fps filter as the
        # observation extractor. Seeking separately to flashes can choose an
        # adjacent source frame and misrepresent a short strobe in the audit.
        snapshots={}
        for start in sorted({p[1] for p in picked}):
            needed=set()
            for kind,clip_start,index,second in picked:
                if clip_start==start:needed.update(index+off for off in ([-3,0,3] if kind!='hold' else [0,10,20]))
            decoder=subprocess.Popen(['ffmpeg','-v','error','-ss',str(start),'-i',cfg['source'],'-t','240','-vf','fps=10,scale=320:180','-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],stdout=subprocess.PIPE)
            for index in range(2400):
                raw=decoder.stdout.read(320*180*3)
                if len(raw)!=320*180*3:raise ValueError('Incomplete audit decode')
                if index in needed:snapshots[(start,index)]=raw
            decoder.stdout.close();assert decoder.wait()==0
        font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',17)
        sheet=Image.new('RGB',(960,len(picked)*215),(9,16,21));draw=ImageDraw.Draw(sheet)
        for row,(kind,start,index,second) in enumerate(picked):
            offsets=[-.3,0,.3] if kind!='hold' else [0,1,2]
            record={'show':show,'clip':f'{show}_{start:04d}','kind':kind,'index':index,'second':second,'source':cfg['source'],'sampled_offsets':offsets}
            samples.append(record)
            for col,offset in enumerate(offsets):
                raw=snapshots[(start,index+round(offset*10))]
                frame=Image.frombytes('RGB',(320,180),raw);d=ImageDraw.Draw(frame)
                # Unregistered source: rectangle is approximate and explicitly marked.
                d.rectangle(tuple(round(v/3) for v in cfg['stage_box']),outline=(146,231,199),width=1)
                sheet.paste(frame,(col*320,row*215+30))
                draw.text((col*320+4,row*215+5),f'{kind} {second+offset:.1f}s',font=font,fill=(220,231,225))
        with (args.out/(show+'_events.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=92)
        print(show,{k:v for k,v in report.items() if k.startswith(show)},flush=True)
    with (args.out/'summary.json').open('x') as f:json.dump(report,f,indent=2)
    with (args.out/'samples.json').open('x') as f:json.dump(samples,f,indent=2)
    with (args.out/'manifest.json').open('x') as f:json.dump({'provenance':'Inferred relative stage appearance; pending sampled review, not fixture ground truth','code_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'targets.py',HERE/'EXPERIMENT.md']}},f,indent=2)
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
