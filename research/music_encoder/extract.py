"""Frozen music representations from strictly trailing received-audio windows."""
from pathlib import Path
import argparse,hashlib,json,subprocess,time
import numpy as np
import torch
from benchmark import load_model,encode

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--model',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--device',default='mps');args=ap.parse_args()
    assert (args.model/'PROVENANCE.json').exists()
    here=Path(__file__).parent;cfg=json.loads((here.parent/'wide_lights/sources.json').read_text());review=json.loads((here.parent/'wide_lights/review.json').read_text())
    args.out.mkdir(parents=True,exist_ok=False);torch.set_num_threads(4)
    model,conversions=load_model(args.model,args.device);records=[];started=time.monotonic()
    with (args.out/'STARTED.json').open('x') as f:json.dump({'status':'started; this file is not evidence of a live process','model':str(args.model),'fps':2,'window_seconds':5,'channel':'left','source_config':cfg},f,indent=2)
    for show,source_cfg in cfg['sources'].items():
        source=source_cfg['source'];probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_entries','stream=sample_rate','-of','json',source]))['streams'][0];sr=int(probe['sample_rate'])
        for start in source_cfg['starts']:
            key=f'{show}_{start:04d}'
            if review['clips'][key]['status']!='admit_weak_appearance':continue
            raw=subprocess.check_output(['ffmpeg','-v','error','-ss',str(start),'-i',source,'-t',str(cfg['duration_per_clip']),'-vn','-af','pan=mono|c0=c0','-f','f32le','pipe:1'])
            audio=np.frombuffer(raw,np.float32).copy();assert len(audio)==cfg['duration_per_clip']*sr
            endpoints=np.arange(5,cfg['duration_per_clip'],.5);values=[];timings=[]
            for endpoint in endpoints:
                value,elapsed=encode(model,audio,round(endpoint*sr),sr,args.device);assert np.isfinite(value).all();values.append(value);timings.append(elapsed)
            with (args.out/(key+'.npz')).open('xb') as f:np.savez_compressed(f,time=start+endpoints,features=np.array(values),processing_seconds=np.array(timings))
            record={'clip':key,'split':source_cfg['split'],'frames':len(values),'feature_dimensions':len(values[0]),'source':source,'start':start,'sample_rate':sr,'processing_ms_p50_p95':np.quantile(np.array(timings)*1000,[.5,.95]).tolist()}
            records.append(record);print('COMPLETE CLIP',key,'wall_seconds',round(time.monotonic()-started,1),'p95_ms',round(record['processing_ms_p50_p95'][1],1),flush=True)
    with (args.out/'manifest.json').open('x') as f:json.dump({'status':'complete','model':str(args.model),'revision':'12af15fef9d0ac838c3f475bfbbf26d2060dd4f5','license':'CC-BY-NC-4.0 research candidate',
        'records':records,'feature_definition':'Native-rate left channel, trailing 5 s window sliced before 24k resampling and window normalization; whole-window and last-38-frame means from layers 6 and 12, concatenated in that order',
        'timing':'Timestamps are received audio window endpoints; actual features become available after measured processing_seconds. A deployed policy must account for processing/scheduling latency.',
        'key_conversions':conversions,'no_rpmc_assets_loaded':True,'code_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [Path(__file__),here/'benchmark.py',here/'EXPERIMENT.md']}},f,indent=2)
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
