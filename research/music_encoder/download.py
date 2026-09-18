"""Pinned official MERT assets; additive download, no remote code execution."""
from pathlib import Path
from urllib.request import urlopen
import argparse,hashlib,json

REVISION='12af15fef9d0ac838c3f475bfbbf26d2060dd4f5'
REPO='m-a-p/MERT-v1-95M'

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);args=ap.parse_args()
    metadata=json.load(urlopen(f'https://huggingface.co/api/models/{REPO}/revision/{REVISION}?blobs=true',timeout=30))
    assert metadata['sha']==REVISION
    files={entry['rfilename']:entry for entry in metadata['siblings']}
    args.out.mkdir(parents=True,exist_ok=False);saved=[]
    for name in ['README.md','config.json','preprocessor_config.json','modeling_MERT.py','configuration_MERT.py','pytorch_model.bin']:
        url=f'https://huggingface.co/{REPO}/resolve/{REVISION}/{name}'
        digest=hashlib.sha256();size=0
        with urlopen(url,timeout=60) as source,(args.out/name).open('xb') as target:
            while True:
                block=source.read(1024*1024)
                if not block:break
                target.write(block);digest.update(block);size+=len(block)
        expected=files[name].get('lfs',{}).get('sha256')
        if expected:assert digest.hexdigest()==expected
        saved.append({'name':name,'url':url,'bytes':size,'sha256':digest.hexdigest(),'expected_lfs_sha256':expected})
        print('SAVED',name,size,flush=True)
    with (args.out/'PROVENANCE.json').open('x') as f:json.dump({'repo':REPO,'revision':REVISION,'license':'CC-BY-NC-4.0 model weights; research only','files':saved,'note':'Official custom code downloaded for inspection only. No trust_remote_code execution. Weights must load with torch.load(weights_only=True).'},f,indent=2)
    print('COMPLETE',args.out,flush=True)

if __name__=='__main__':main()
