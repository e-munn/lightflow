"""Mine review candidates only; never infer intended holds from absent edges."""
from pathlib import Path
import argparse,json,hashlib
import numpy as np

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,required=True);a=ap.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    root=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues/dataset_v1');allrows=[];summary={}
    for p in sorted(root.glob('*.npz')):
        z=np.load(p);t=z['time'];e=z['target'][:,0,8:12];coverage=z['target'][:,0,4:8];clip=z['quality'][:,0,:,0].max(1);valid=z['geometry_valid'];rows=[];rejected={'geometry_or_gap':0,'clipping':0,'unclassified':0}
        # 8s windows on a fixed 2s grid, no audio-based or model-based selection.
        for start in np.arange(np.ceil(t[0]),t[-1]-8,2):
            ids=np.flatnonzero((t>=start)&(t<start+8))
            if len(ids)<230 or not valid[ids].all() or np.max(np.diff(t[ids]))>.050001:
                rejected['geometry_or_gap']+=1;continue
            if np.quantile(clip[ids],.95)>.02 or clip[ids].max()>.05:
                rejected['clipping']+=1;continue
            mean=e[ids].mean(1);seconds=np.array([np.median(mean[(t[ids]>=start+j)&(t[ids]<start+j+1)]) for j in range(8)])
            delta=float(seconds[-2:].mean()-seconds[:2].mean());spread=float(np.quantile(mean,.9)-np.quantile(mean,.1));steps=np.diff(seconds)
            types=[]
            if spread<.08 and .08<float(mean.mean())<.85:types.append('stable_appearance')
            if delta>.18 and (steps>=-.025).sum()>=6:types.append('rising_appearance')
            if delta<-.18 and (steps<=.025).sum()>=6:types.append('falling_appearance')
            if not types:rejected['unclassified']+=1;continue
            for kind in types:
                row=dict(clip=p.stem,start=float(start),duration=8,kind=kind,energy_mean=float(mean.mean()),energy_range90_10=spread,change=delta,seconds=seconds.tolist(),coverage_range90_10=float(np.quantile(coverage[ids].mean(1),.9)-np.quantile(coverage[ids].mean(1),.1)),max_clipped_fraction=float(clip[ids].max()),edge_count=int(z['light_edge'][ids].sum()),training_admitted=False)
                rows.append(row);allrows.append(row)
        summary[p.stem]=dict(candidates=len(rows),rejected=rejected)
    # At most one review span per class per show, suppress overlapping selections.
    selected=[]
    for kind in ['stable_appearance','rising_appearance','falling_appearance']:
        shows=sorted({r['clip'].rsplit('_',1)[0] for r in allrows})
        for show in shows:
            rows=[r for r in allrows if r['kind']==kind and r['clip'].rsplit('_',1)[0]==show]
            rows.sort(key=lambda r:r['energy_range90_10'] if kind=='stable_appearance' else -abs(r['change']))
            for r in rows:
                if all(s['clip']!=r['clip'] or abs(s['start']-r['start'])>=8 for s in selected):selected.append(r);break
    result=dict(protocol='Review candidates only, not labels for intention. Full geometry support and low clipping required. Eight-second windows. Stable mean field is not evidence that fixtures held; motion, color and masked regions remain to inspect.',summary=summary,candidates=allrows,selected=selected,code_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    with (a.out/'candidates.json').open('x') as f:json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps({'total':len(allrows),'selected':selected,'summary':summary},indent=2))
if __name__=='__main__':main()
