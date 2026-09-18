"""Extend reviewed native-frame measurements; admission is a separate decision."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import argparse, hashlib, json, sys, time
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from native_frames import frames, source_timestamps
from targets import descriptors
from compare_regions import region_masks

HERE = Path(__file__).parent
ROOT = Path('/Volumes/ExtremePro/Code/lightflow/research')
sys.path.insert(0, str(HERE.parent/'wide_lights'))
from pixels import observe


def save(path, value):
    with path.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)


def masks_for(show, catalog, proposals):
    if show in proposals:
        return region_masks(proposals[show]), np.ones(2, bool)
    cfg = catalog[show]
    x0, y0, x1, y1 = [round(v*2/3) for v in cfg['stage_box']]
    edges = np.linspace(x0, x1, 5).round().astype(int)
    masks = np.zeros((2, 4, 360, 640), bool)
    for k, (left, right) in enumerate(zip(edges[:-1], edges[1:])):
        masks[0, k, y0:y1, left:right] = True
        for box in cfg['exclude']:
            a, b, c, d = [round(v*2/3) for v in box]
            masks[0, k, b:d, a:c] = False
    return masks, np.array([True, False])


def review_sheet(out, key, samples, masks):
    font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf', 16)
    sheet = Image.new('RGB', (1200, 3*462), (8, 15, 20))
    draw = ImageDraw.Draw(sheet)
    union = masks.any((0, 1)); ys, xs = np.where(union)
    crop = (max(0, xs.min()-12), max(0, ys.min()-12), min(640, xs.max()+13), min(360, ys.max()+13))
    for k, (second, valid, energy, frame) in enumerate(samples):
        x, y = (k % 3)*400, (k//3)*462
        shot = Image.fromarray(frame.copy())
        overlay = np.array(shot)
        for t, color in enumerate([(105, 245, 173), (112, 167, 255)]):
            m = masks[t].any(0).astype(np.uint8)
            contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, color, 1)
        shot = Image.fromarray(overlay)
        draw.text((x+6, y+4), f'{key} / {second:.3f}s', font=font, fill='white')
        draw.text((x+6, y+25), f'Geometry {valid} / light energy {energy:.3f}', font=font, fill=(173, 203, 189))
        sheet.paste(shot.resize((400, 225)), (x, y+49))
        inset = shot.crop(tuple(int(v) for v in crop))
        inset.thumbnail((392, 176))
        sheet.paste(inset, (x+4, y+280))
    with (out/(key+'_review.jpg')).open('xb') as f:
        sheet.save(f, format='JPEG', quality=92)


def extract(out, key, catalog, proposals):
    began = time.monotonic()
    show, start_text = key.rsplit('_', 1); start = int(start_text); cfg = catalog[show]
    base = np.load(ROOT/'wide_lights/dataset_v1'/show/f'{start:04d}.npz')
    old = np.load(ROOT/'light_events/labels_v2'/(key+'.npz'))
    masks, available = masks_for(show, catalog, proposals)
    assert not (masks[0].any(0) & masks[1].any(0)).any()
    data = {name: [] for name in ['time', 'relative_pts', 'target', 'mean_luma', 'quality', 'geometry_valid']}
    samples = []; sample_offsets = [1, 30, 60, 90, 120, 150, 180, 210, 239]
    time_base = None
    for second, pts, tb, frame in frames(cfg['source'], start, 240):
        if time_base is None: time_base = tb
        assert time_base == tb
        ix = int(np.floor((second-start)*10+1e-6))
        assert 0 <= ix < len(base['transform'])
        aligned = cv2.warpAffine(frame, base['transform'][ix], (640, 360))
        obs = np.zeros((2, 15), np.float32); quality = np.zeros((2, 4, 3), np.float32)
        luma = np.zeros((2, 4), np.float32)
        for kind in np.flatnonzero(available):
            values = [observe(aligned[m]) for m in masks[kind]]
            weights = np.array([v['color_valid']*v['intensity'] for v in values])
            chroma = np.average([v['chroma'] for v in values], axis=0, weights=weights) if weights.sum()>.02 else np.ones(3)/3
            obs[kind] = [v['p99_luma'] for v in values]+[v['lit_coverage'] for v in values]+[v['intensity'] for v in values]+chroma.tolist()
            quality[kind] = [[v['clipped_pixel_fraction'], v['color_support'], v['color_valid']] for v in values]
            luma[kind] = [v['mean_luma'] for v in values]
        valid = bool(old['geometry_valid'][ix])
        for name, value in [('time', second), ('relative_pts', pts), ('target', obs), ('quality', quality), ('mean_luma', luma), ('geometry_valid', valid)]:
            data[name].append(value)
        if len(samples)<len(sample_offsets) and second>=start+sample_offsets[len(samples)]:
            samples.append((second, valid, float(obs[0, 8:12].mean()), aligned.copy()))
    data = {name: np.asarray(value) for name, value in data.items()}
    expected = source_timestamps(cfg['source'], start, 240)
    assert len(data['time'])==len(expected), (key, len(data['time']), len(expected))
    error = float(np.max(abs(data['time']-expected))); assert error<1e-6
    assert len(samples)==9 and np.isfinite(data['target']).all()
    assert ((data['target']>=0)&(data['target']<=1.00001)).all()
    desc = {kind: descriptors(data['time'], data['target'][:, k, 8:12], data['geometry_valid'] & available[k]) for k, kind in enumerate(['light', 'screen'])}
    with (out/(key+'.npz')).open('xb') as f:
        np.savez_compressed(f, **data, masks=masks, type_available=available,
                            **{kind+'_'+name: value for kind, values in desc.items() for name, value in values.items()})
    review_sheet(out, key, samples, masks)
    report = {'source': cfg['source'], 'split': cfg['split'], 'interval_seconds': [start, start+240],
              'frames': len(expected), 'time_base': [time_base.numerator, time_base.denominator],
              'pts_formula': 'source_seconds = requested_seek_seconds + relative_pts * time_base',
              'source_pts_max_error_seconds': error, 'source_gaps_over_50ms': int((np.diff(data['time'])>.0500001).sum()),
              'type_available': available.tolist(), 'geometry_valid_fraction': float(data['geometry_valid'].mean()),
              'pixel_counts': masks.sum((2, 3)).tolist(), 'review_seconds': [v[0] for v in samples],
              'admission': 'pending source/mask review', 'seconds_to_extract': time.monotonic()-began}
    for kind in ['light', 'screen']:
        k = ['light', 'screen'].index(kind); keep = data['geometry_valid'] & available[k]
        report[kind] = {'edges_brighten_dim': desc[kind]['edge'].sum(0).astype(int).tolist(),
                        'pair_valid_fraction': float(desc[kind]['pair_valid'].mean()),
                        'clipped_frame_fraction': float((data['quality'][keep,k,:,0].max(1)>.05).mean()) if keep.any() else None}
    save(out/(key+'.json'), report)
    print('COMPLETE', key, report['frames'], 'native frames;', report['light'], flush=True)
    return report


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', type=Path, required=True)
    args = ap.parse_args(); args.out.mkdir(parents=True, exist_ok=False); cv2.setNumThreads(1)
    catalog = json.loads((HERE.parent/'wide_lights/sources.json').read_text())['sources']
    proposals = json.loads((HERE/'region_candidates.json').read_text())['sources']
    old_review = json.loads((HERE.parent/'wide_lights/review.json').read_text())['clips']
    keys = [key for key, value in old_review.items() if value['status']=='admit_weak_appearance']
    assert len(keys)==14
    sources = [Path(__file__), HERE/'native_frames.py', HERE/'targets.py', HERE/'compare_regions.py',
               HERE/'region_candidates.json', HERE/'DATASET_EXPERIMENT.md', HERE.parent/'wide_lights/pixels.py']
    save(args.out/'protocol.json', {'status': 'started', 'clips': keys, 'code_sha256': {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources},
         'source_geometry': 'wide_lights/dataset_v1 + light_events/labels_v2 geometry_valid only',
         'forest_status': 'Repeatedly inspected development evaluation; not a fresh test',
         'source_audio_visual_offset': 'unknown', 'no_rpmc': True, 'training_admission': False})
    # Two bounded independent decoders; shared source assets remain read-only.
    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(lambda key: extract(args.out, key, catalog, proposals), keys))
    save(args.out/'summary.json', dict(zip(keys, values)))
    save(args.out/'COMPLETE.json', {'clips': len(keys), 'native_frames': sum(v['frames'] for v in values), 'training_admission': False})


if __name__=='__main__': main()
