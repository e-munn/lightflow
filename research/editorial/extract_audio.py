"""Extract deterministic causal features from an explicit source catalog."""
from pathlib import Path
import subprocess,json,hashlib,argparse,datetime
ROOT=Path(__file__).resolve().parents[2]
BASE=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference')
SOURCES={
 'levity':BASE/'9-16-26-evening/concerts/levity_coachella_2026_WCaZ6PalOsc.mp4',
 'whethan':BASE/'9-16-26-evening/concerts/whethan_edc_las_vegas_2026_1Q-j11Nlm4k.mp4',
 'rezz':BASE/'9-16-26-190621/concerts/rezz_live_coachella_2026_spnHHNCk4XU.mp4',
 'skrillex_chile':BASE/'9-16-26-190917/concerts/skrillex_live_lollapalooza_chile_2026_loD-whuR5zc.mp4'}

def main():
 p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True);args=p.parse_args();args.out.mkdir(parents=True,exist_ok=False)
 manifest={'created':datetime.datetime.now().astimezone().isoformat(),'schema':'scope-causal-v1','fps':50,'sources':{}}
 for name,source in SOURCES.items():
  print('FEATURES',name,flush=True)
  subprocess.run(['node',str(ROOT/'research/scope_foundation/extract.mjs'),str(source),str(args.out/(name+'.csv'))],check=True)
  with source.open('rb') as f:sha=hashlib.file_digest(f,'sha256').hexdigest()
  manifest['sources'][name]={'path':str(source),'sha256':sha,'split':'train' if name in ['levity','whethan'] else 'validation' if name=='rezz' else 'test'}
 with (args.out/'manifest.json').open('x') as f:json.dump(manifest,f,indent=2)
 print('COMPLETE',args.out,flush=True)
if __name__=='__main__':main()
