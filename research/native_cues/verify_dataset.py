"""Independent array/clock checks and regression against the earlier pilot."""
from pathlib import Path
from fractions import Fraction
import argparse, hashlib, json
import numpy as np

ROOT=Path('/Volumes/ExtremePro/Code/lightflow/research/native_cues')


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dataset',type=Path,required=True)
    args=ap.parse_args(); summary=json.loads((args.dataset/'summary.json').read_text()); report={}
    manifest=json.loads((args.dataset/'protocol.json').read_text())
    for path, digest in manifest['code_sha256'].items():
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest, path
    for key, meta in summary.items():
        data=np.load(args.dataset/(key+'.npz')); n=meta['frames']; start=meta['interval_seconds'][0]
        clock=start+data['relative_pts']*float(Fraction(*meta['time_base']))
        assert np.max(abs(clock-data['time']))<1e-9
        assert data['target'].shape==(n,2,15) and data['quality'].shape==(n,2,4,3)
        assert not (data['masks'][0].any(0)&data['masks'][1].any(0)).any()
        assert np.isfinite(data['target']).all() and np.isfinite(data['quality']).all()
        assert ((data['quality']>=0)&(data['quality']<=1.00001)).all()
        mapped=1-np.exp(-6*data['mean_luma']); mapping_error=float(np.max(abs(mapped-data['target'][:,:,8:12])))
        assert mapping_error<3e-7
        for k,kind in enumerate(['light','screen']):
            pair=data[kind+'_pair_valid']; edges=data[kind+'_edge']
            assert not edges[~pair].any()
            assert not pair[1:][~(data['geometry_valid'][1:]&data['geometry_valid'][:-1])].any()
            if not data['type_available'][k]:
                assert not data['target'][:,k].any() and not pair.any() and not data[kind+'_edge_mask'].any()
        report[key]={'frames':n,'mapping_max_error':mapping_error,'sha256':hashlib.sha256((args.dataset/(key+'.npz')).read_bytes()).hexdigest()}
    regression=[]
    for pilot in sorted((ROOT/'pilot_v2').glob('*.npz')):
        key=pilot.stem.rsplit('_',1)[0]; old=np.load(pilot); data=np.load(args.dataset/(key+'.npz'))
        # Match by rounded native presentation time, independent of seek origin.
        lookup={round(t,6):i for i,t in enumerate(data['time'])}
        ix=np.array([lookup[round(t,6)] for t in old['time']])
        time_error=float(np.max(abs(data['time'][ix]-old['time']))); assert time_error<1e-9
        if key.startswith(('griz_','ravenscoon_')):
            prior=np.load(ROOT/'region_comparison_v1'/pilot.name)
            error=float(np.max(abs(data['target'][ix]-prior['target'])))
        else:
            error=float(np.max(abs(data['target'][ix,0,8:12]-old['energy'])))
        assert error<1e-6, (pilot.name,error)
        assert np.array_equal(data['geometry_valid'][ix],old['geometry_valid'])
        regression.append({'span':pilot.stem,'frames':len(ix),'time_max_error_seconds':time_error,'observation_max_error':error})
    result={'clips':report,'pilot_regression':regression,'native_frames':sum(v['frames'] for v in report.values()),
            'pilot_frames_regressed':sum(v['frames'] for v in regression),'status':'passed',
            'scope':'array and file-clock checks; not physical latency or exhaustive source review'}
    with (args.dataset/'verification.json').open('x') as f:json.dump(result,f,indent=2,allow_nan=False)
    print(json.dumps({k:v for k,v in result.items() if k not in ['clips','pilot_regression']},indent=2))


if __name__=='__main__':main()
