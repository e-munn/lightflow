"""Audit immutable labels without fitting or selecting a new target definition."""
from pathlib import Path
import argparse, csv, hashlib, json, sys
import numpy as np

HERE = Path(__file__).parent
ROOT = Path('/Volumes/ExtremePro/Code/lightflow/research')
sys.path.insert(0, str(HERE.parent / 'light_events'))
from targets import targets


def event_match(a, b, tolerance=.1):
    """Chronological maximum-cardinality matching with a fixed tolerance."""
    a, b = np.asarray(a), np.asarray(b)
    i = j = count = 0
    errors = []
    while i < len(a) and j < len(b):
        if a[i] < b[j] - tolerance - 1e-7:
            i += 1
        elif b[j] < a[i] - tolerance - 1e-7:
            j += 1
        else:
            count += 1
            errors.append(abs(float(a[i] - b[j])))
            i += 1
            j += 1
    return {'reference_count':len(a), 'candidate_count':len(b), 'matched':count,
            'agreement_f1':2*count/(len(a)+len(b)) if len(a)+len(b) else None,
            'median_matched_difference_seconds':float(np.median(errors)) if errors else None}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    review = json.loads((HERE.parent/'wide_lights/review.json').read_text())
    catalog = json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    records = {}
    for key, entry in sorted(review['clips'].items()):
        if entry['status'] != 'admit_weak_appearance':
            continue
        show, start_text = key.rsplit('_', 1)
        start = int(start_text)
        o = np.load(ROOT/'wide_lights/dataset_v1'/show/(start_text+'.npz'))
        l = np.load(ROOT/'light_events/labels_v2'/(key+'.npz'))
        # Model first row is video index 1, and its warmup discards 254 rows.
        keep = (l['time'] >= start+25.5-1e-6) & (l['time'] < start+238)
        valid = keep & l['geometry_valid']
        mask = l['mask'][keep, :2] > 0
        y = l['target'][keep, :2]
        energy = o['target'][:, 8:12]
        mean_luma = -np.log(np.maximum(1-energy, 1e-8))/6
        clip_fraction = o['quality'][:, :, 0].max(1)
        rec = {'split':catalog[show]['split'], 'analysis_seconds':float(keep.sum()/10),
            'geometry_fraction':float(valid.sum()/keep.sum()),
            'forecast_valid_seconds':(mask.sum(0)/10).tolist(),
            'forecast_positive_fraction':((mask*y).sum(0)/np.maximum(1,mask.sum(0))).tolist(),
            'energy_quantiles_10_50_90':np.quantile(l['energy'][valid], [.1,.5,.9]).tolist(),
            'mean_luma_quantiles_10_50_90':np.quantile(mean_luma.mean(1)[valid], [.1,.5,.9]).tolist(),
            'fraction_valid_frames_any_region_over_5pct_clipped':float((clip_fraction[valid]>.05).mean()),
            'fraction_valid_frames_mean_energy_over_075':float((l['energy'][valid]>.75).mean()),
            'color_valid_fraction_given_geometry':float((o['weight'][valid,-1]>0).mean()),
            'opposite_event_within_half_second':{}, 'mapping_gain':{}}
        for kind, other in [('rise','release'), ('release','rise')]:
            ix = l[kind][keep[l[kind]]]
            fraction = sum(np.any((l[other]>i)&(l[other]<=i+5)) for i in ix)/max(1,len(ix))
            rec['opposite_event_within_half_second'][kind] = float(fraction)
        for gain in [4.8, 6., 7.2]:
            obs = o['target'].copy()
            obs[:,8:12] = 1-np.exp(-gain*mean_luma)
            target, weights, meta = targets(obs, o['weight'], o['transform'], o['quality'])
            m = weights[keep,:2]>0
            gain_rec = {'forecast_valid_seconds':(m.sum(0)/10).tolist(),
                        'forecast_positive_fraction':((target[keep,:2]*m).sum(0)/np.maximum(1,m.sum(0))).tolist(),
                        'events':{}}
            for h, kind in enumerate(['rise','release']):
                a=l[kind][keep[l[kind]]]; b=meta[kind][keep[meta[kind]]]
                both=(l['mask'][keep,h]>0)&(weights[keep,h]>0)
                gain_rec['events'][kind] = event_match(l['time'][a], l['time'][b])
                gain_rec['events'][kind]['label_disagreement_on_common_support'] = float((l['target'][keep,h][both]!=target[keep,h][both]).mean()) if both.any() else None
            if gain == 6:
                assert np.array_equal(target[:,:2],l['target'][:,:2])
                assert np.array_equal(weights[:,:2],l['mask'][:,:2])
            rec['mapping_gain'][str(gain)] = gain_rec
        records[key] = rec
        print(key, 'positive', np.round(rec['forecast_positive_fraction'],3), 'clipped', round(rec['fraction_valid_frames_any_region_over_5pct_clipped'],3), flush=True)
    with (args.out/'profile.json').open('x') as f:
        json.dump(records,f,indent=2,allow_nan=False)
    with (args.out/'profile.csv').open('x',newline='') as f:
        w=csv.writer(f)
        w.writerow(['clip','split','geometry_fraction','rise_valid_seconds','release_valid_seconds','rise_positive_fraction','release_positive_fraction','clipped_frame_fraction','high_energy_frame_fraction','rise_agreement_gain4.8','rise_agreement_gain7.2'])
        for key,r in records.items():
            w.writerow([key,r['split'],r['geometry_fraction'],*r['forecast_valid_seconds'],*r['forecast_positive_fraction'],r['fraction_valid_frames_any_region_over_5pct_clipped'],r['fraction_valid_frames_mean_energy_over_075'],r['mapping_gain']['4.8']['events']['rise']['agreement_f1'],r['mapping_gain']['7.2']['events']['rise']['agreement_f1']])
    with (args.out/'manifest.json').open('x') as f:
        json.dump({'labels':str(ROOT/'light_events/labels_v2'),'observations':str(ROOT/'wide_lights/dataset_v1'),
                   'no_training':True,'originals_unchanged':True,'protocol_sha256':hashlib.sha256((HERE/'PROTOCOL.md').read_bytes()).hexdigest(),
                   'code_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},f,indent=2)


if __name__ == '__main__':
    main()
