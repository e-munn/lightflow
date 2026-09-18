"""Run the saved native-cue model on a user-selected audio/video file."""
from pathlib import Path
import argparse, hashlib, json, subprocess
import numpy as np
import torch
from train_forecast import Model, features, infer, NAMES, WARM

HERE=Path(__file__).parent


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--model',type=Path,required=True)
    ap.add_argument('--source',type=Path,required=True)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--start',type=float,default=0)
    ap.add_argument('--duration',type=float,default=60)
    ap.add_argument('--device',default='cpu',choices=['cpu','mps'])
    args=ap.parse_args()
    assert args.source.is_file() and args.start>=0 and args.duration>25.5
    args.out.mkdir(parents=True,exist_ok=False)
    model_file=args.model/'model.json' if args.model.is_dir() else args.model
    config=json.loads(model_file.read_text())
    assert config['version']=='native-light-edge-forecast-v1' and config['outputs']==NAMES
    subprocess.run(['node',str(HERE.parent/'wide_lights/extract_audio.mjs'),str(args.source),str(args.out/'audio_features.csv'),str(args.start),str(args.duration)],check=True)
    raw=np.loadtxt(args.out/'audio_features.csv',delimiter=',',skiprows=1)
    x,t=features(raw)
    torch.set_num_threads(4)
    model=Model(np.ones(4,np.float32)*.5).to(args.device)
    model.load_state_dict({k:torch.tensor(v,dtype=torch.float32) for k,v in config['state'].items()},strict=True)
    model.eval()
    p=infer(model,x,np.array(config['mean'],np.float32),np.array(config['std'],np.float32),args.device)
    assert p.shape==(len(t),4) and np.isfinite(p).all()
    ready=np.arange(len(t))>=WARM
    with (args.out/'forecast.csv').open('x') as f:
        np.savetxt(f,np.column_stack([t,ready,p]),delimiter=',',header=','.join(['seconds','context_ready',*NAMES]),comments='',fmt='%.7f')
    with (args.out/'manifest.json').open('x') as f:
        json.dump({'source':str(args.source),'start':args.start,'duration':args.duration,'model':str(model_file),
            'model_sha256':hashlib.sha256(model_file.read_bytes()).hexdigest(),'outputs':NAMES,'prediction_rows':len(t),
            'context_seconds':25.5,'model_inputs':'Received audio only; trailing 20 ms signal features and past context',
            'output_meaning':'Probabilities of weak observed light-field appearance edges, not calibrated desired dimmer values',
            'cue_policy_enabled':False,'physical_latency':'unmeasured'},f,indent=2)
    print('COMPLETE',args.out,flush=True)


if __name__=='__main__':main()
