"""Measure disjoint candidate light and screen fields without training a model."""
from pathlib import Path
import argparse,hashlib,json,sys
import cv2
import numpy as np
from native_frames import frames
from targets import descriptors

HERE=Path(__file__).parent
ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research')
sys.path.insert(0,str(HERE.parent/'wide_lights'))
from pixels import observe


def region_masks(config):
    whole=[]
    for kind in ['light_field_rectangles','screen_rectangles']:
        m=np.zeros((360,640),bool)
        for x0,y0,x1,y1 in config[kind]:m[y0:y1,x0:x1]=True
        whole.append(m)
    assert not (whole[0]&whole[1]).any()
    groups=[]
    for mask in whole:
        ys,xs=np.where(mask);left,right=xs.min(),xs.max()+1
        edges=np.linspace(left,right,5).round().astype(int)
        group=[]
        for a,b in zip(edges[:-1],edges[1:]):
            m=mask.copy();m[:,:a]=False;m[:,b:]=False
            assert m.sum()>=30
            group.append(m)
        groups.append(group)
    return np.array(groups)


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    args.out.mkdir(parents=True,exist_ok=False)
    config=json.loads((HERE/'region_candidates.json').read_text())['sources']
    catalog=json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources'];report={}
    for show,cfg in config.items():
        start=cfg['clip_start'];masks=region_masks(cfg)
        base=np.load(ROOT/'wide_lights/dataset_v1'/show/f'{start:04d}.npz')
        previous=np.load(ROOT/'light_events/labels_v2'/f'{show}_{start:04d}.npz')
        for offset in [60,180]:
            key=f'{show}_{start:04d}_{offset:03d}';begin=start+offset-1
            time=[];observations=[];quality=[];valid=[]
            for second,pts,time_base,frame in frames(catalog[show]['source'],begin,22):
                ix=int(np.floor((second-start)*10+1e-6));aligned=cv2.warpAffine(frame,base['transform'][ix],(640,360))
                types=[];qualities=[]
                for group in masks:
                    values=[observe(aligned[m]) for m in group]
                    weights=np.array([v['color_valid']*v['intensity'] for v in values])
                    chroma=np.average([v['chroma'] for v in values],axis=0,weights=weights) if weights.sum()>.02 else np.ones(3)/3
                    types.append([v['p99_luma'] for v in values]+[v['lit_coverage'] for v in values]+[v['intensity'] for v in values]+chroma.tolist())
                    qualities.append([[v['clipped_pixel_fraction'],v['color_support'],v['color_valid']] for v in values])
                time.append(second);observations.append(types);quality.append(qualities);valid.append(bool(previous['geometry_valid'][ix]))
            time=np.array(time);observations=np.array(observations,np.float32);quality=np.array(quality,np.float32);valid=np.array(valid)
            native=np.load(ROOT/'native_cues/pilot_v2'/(key+'.npz'))
            assert np.array_equal(time,native['time'])
            analysis=(time>=start+offset)&(time<start+offset+20)
            desc={name:descriptors(time,observations[:,k,8:12],valid) for k,name in enumerate(['light','screen'])}
            with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,time=time,target=observations,quality=quality,geometry_valid=valid,analysis_window=analysis,masks=masks,**{kind+'_'+name:value for kind,values in desc.items() for name,value in values.items()})
            record={'source':catalog[show]['source'],'interval_seconds':[start+offset,start+offset+20],
                    'pixel_counts_by_type_and_horizontal_region':masks.sum((2,3)).tolist(),'training_admission':'pending continuous/source review',
                    'notes':'Mask semantics remain candidate observations; empty light fields do not imply that the whole rig is dark. Screen light spill and background graphics may remain.'}
            for k,name in enumerate(['light','screen']):
                keep=analysis&valid;e=observations[keep,k,8:12].mean(1)
                record[name]={'mean_energy_quantiles':np.quantile(e,[.1,.5,.9]).tolist(),'energy_std':float(e.std()),
                    'fraction_frames_over_5pct_clipped':float((quality[keep,k,:,0].max(1)>.05).mean()),
                    'brighten_dim_counts':desc[name]['edge'][analysis].sum(0).astype(int).tolist()}
            report[key]=record
            print(key, 'light',record['light'],'screen',record['screen'],flush=True)
    with (args.out/'summary.json').open('x') as f:json.dump(report,f,indent=2,allow_nan=False)
    with (args.out/'manifest.json').open('x') as f:json.dump({'status':'complete','types':['candidate_light_field','screen_interior'],'mask_overlap_pixels':0,
        'source_pts_verified_against':'native_cues/pilot_v2 (exact equality)',
        'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'config_sha256':hashlib.sha256((HERE/'region_candidates.json').read_bytes()).hexdigest(),'training_admission':False},f,indent=2)


if __name__=='__main__':main()
