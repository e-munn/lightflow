from pathlib import Path
import argparse,json,subprocess,hashlib
import numpy as np

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    sources=json.loads(Path('research/wide_lights/sources.json').read_text())['sources'];review=json.loads(Path('research/native_cues/dataset_review.json').read_text());rows=[]
    for key,decision in review['clips'].items():
        show,start=key.rsplit('_',1)
        if decision['status']!='admit_weak_light_field' or sources[show]['split']!='train':continue
        for profile in ['dark_quiet','thin_loud','room_short','room_long']:
            dest=a.out/(key+'__'+profile+'.csv')
            subprocess.run(['node','research/native_cues/extract_recording.mjs',sources[show]['source'],str(dest),str(int(start)),'240',profile],check=True)
            raw=np.loadtxt(dest,delimiter=',',skiprows=1);assert raw.shape==(12000,25) and np.isfinite(raw).all()
            original=np.loadtxt(Path('/Volumes/ExtremePro/Code/lightflow/research/wide_lights/audio_v1')/(key+'.csv'),delimiter=',',skiprows=1);assert np.array_equal(raw[:,0],original[:,0])
            rows.append(dict(key=key,profile=profile,file=dest.name,sha256=hashlib.sha256(dest.read_bytes()).hexdigest()))
    assert len(rows)==32
    with (a.out/'COMPLETE.json').open('x') as f:json.dump(dict(rows=rows,training_only=True,code_sha256={p:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in ['research/native_cues/recording-dsp.mjs','research/native_cues/extract_recording.mjs','research/native_cues/prepare_recordings.py']}),f,indent=2)
if __name__=='__main__':main()
