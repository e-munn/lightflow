"""Typed source observations and candidate edges on the original video clock."""
from pathlib import Path
import argparse,hashlib,json,sys
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageFont
from native_frames import frames,source_timestamps
from targets import descriptors

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
sys.path.insert(0,str(HERE.parent/'wide_lights'))
from pixels import observe

CASES=[('ravenscoon',3000),('alleycvt',1800),('griz',1800),('levity_forest',2100),('forest',1800)]
KINDS={'ravenscoon':'mixed_screen_and_light_field','griz':'screen_dominated',
       'alleycvt':'candidate_beam_fixture_field','levity_forest':'candidate_beam_fixture_field','forest':'candidate_beam_fixture_field'}


def main():
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    report={};font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',16)
    rng=np.random.default_rng(192619)
    for show,start in CASES:
        cfg=catalog[show];base=np.load(ROOT/'wide_lights/dataset_v1'/show/f'{start:04d}.npz')
        old=np.load(ROOT/'light_events/labels_v2'/f'{show}_{start:04d}.npz')
        x0,y0,x1,y1=[round(v*2/3) for v in cfg['stage_box']];edges=np.linspace(x0,x1,5).round().astype(int)
        masks=[]
        for left,right in zip(edges[:-1],edges[1:]):
            m=np.zeros((360,640),bool);m[y0:y1,left:right]=True
            for box in cfg['exclude']:
                a,b,c,d=[round(v*2/3) for v in box];m[b:d,a:c]=False
            masks.append(m)
        for offset in [60,180]:
            key=f'{show}_{start:04d}_{offset:03d}';begin=start+offset-1;duration=22
            data={k:[] for k in ['time','relative_pts','geometry_valid','energy','mean_luma','coverage','p99_luma','chroma','clipped_fraction','color_support','color_valid']}
            thumbs=[];native_base=None
            for second,pts,time_base,frame in frames(cfg['source'],begin,duration):
                if native_base is None:native_base=time_base
                assert time_base==native_base, 'Time base changed within clip'
                index=int(np.floor((second-start)*10+1e-6))
                aligned=cv2.warpAffine(frame,base['transform'][index],(640,360))
                region=[observe(aligned[m]) for m in masks]
                data['time'].append(second);data['relative_pts'].append(pts);data['geometry_valid'].append(bool(old['geometry_valid'][index]))
                for dest,field in [('energy','intensity'),('mean_luma','mean_luma'),('coverage','lit_coverage'),('p99_luma','p99_luma'),('chroma','chroma'),('clipped_fraction','clipped_pixel_fraction'),('color_support','color_support'),('color_valid','color_valid')]:
                    data[dest].append([v[field] for v in region])
                thumbs.append(cv2.resize(aligned,(320,180),interpolation=cv2.INTER_AREA))
            data={k:np.array(v) for k,v in data.items()}
            expected=source_timestamps(cfg['source'],begin,duration)
            assert len(data['time'])==len(expected), (key,len(data['time']),len(expected))
            error=float(np.max(abs(data['time']-expected)));assert error<1e-6
            labels=descriptors(data['time'],data['energy'],data['geometry_valid'])
            window=(data['time']>=start+offset)&(data['time']<start+offset+20)
            data['analysis_window']=window
            with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,**data,**labels)
            times=data['time'];events={name:np.flatnonzero(window&(labels['edge'][:,h]>0)) for h,name in enumerate(['brighten','dim'])}
            samples=[]
            for name,ids in events.items():
                ids=ids[(ids>0)&(ids<len(times)-1)]
                for index in sorted(rng.choice(ids,min(2,len(ids)),replace=False).tolist()):samples.append((name,index))
            sheet=Image.new('RGB',(960,max(1,len(samples))*325),(8,15,20));draw=ImageDraw.Draw(sheet)
            if not samples:draw.text((15,15),'No strong candidate edges in this span; this does not imply a visual hold.',font=font,fill='white')
            for row,(name,index) in enumerate(samples):
                for column,ix in enumerate([index-1,index,index+1]):
                    x=column*320;y=row*325
                    draw.text((x+4,y+3),f'{name} / {times[ix]:.3f}s',font=font,fill=(220,233,225))
                    draw.text((x+4,y+23),f'energy {labels["mean_energy"][ix]:.3f} / valid {data["geometry_valid"][ix]}',font=font,fill=(162,192,178))
                    source=Image.fromarray(thumbs[ix]);sd=ImageDraw.Draw(source)
                    sd.rectangle((x0//2,y0//2,x1//2,y1//2),outline=(146,237,198),width=1)
                    draw_source=source.copy();sheet.paste(draw_source,(x,y+45))
                    crop=Image.fromarray(thumbs[ix]).crop((x0//2,y0//2,x1//2,y1//2)).resize((320,90))
                    sheet.paste(crop,(x,y+230))
            with (args.out/(key+'_events.jpg')).open('xb') as f:sheet.save(f,format='JPEG',quality=92)
            report[key]={'source':cfg['source'],'split':cfg['split'],'region_kind':KINDS[show],
                'beam_target_eligible_by_region_type':KINDS[show]=='candidate_beam_fixture_field',
                'training_admission':'pending review; pilot only','interval_seconds':[start+offset,start+offset+20],
                'decode_interval_seconds':[begin,begin+duration],'decoded_frames':len(times),
                'time_base':[time_base.numerator,time_base.denominator],
                'pts_formula':'source_seconds = requested_seek_seconds + relative_pts * time_base',
                'source_pts_max_error_seconds':error,'source_gaps_over_50ms':int((np.diff(times)>.0500001).sum()),
                'pair_valid_fraction':float(labels['pair_valid'][window].mean()),
                'edge_counts':{k:len(v) for k,v in events.items()},
                'slow_contrast_valid_fraction':float(labels['contrast_1s_valid'][window].mean()),
                'samples':[{'kind':name,'index':index,'before_seconds':float(times[index-1]),'event_seconds':float(times[index]),'after_seconds':float(times[index+1]),'observed_switch_interval_seconds':[float(times[index-1]),float(times[index])]} for name,index in samples]}
            print('COMPLETE',key,'native_frames',len(times),'events',report[key]['edge_counts'],'kind',KINDS[show],flush=True)
    with (args.out/'review.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    with (args.out/'manifest.json').open('x') as f:json.dump({'status':'complete','pixel_mapping':'Existing fixed observe() mapping; no per-frame normalization',
        'geometry':'Existing transforms/masks held on native source clock, with original registration-jump exclusions',
        'training_admission':'not admitted; sampled review required','no_rpmc_assets_loaded':True,'physical_audio_light_offset':'Unknown',
        'code_sha256':{str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),HERE/'native_frames.py',HERE/'targets.py',HERE/'EXPERIMENT.md',HERE.parent/'wide_lights/pixels.py']}},f,indent=2)


if __name__=='__main__':main()
