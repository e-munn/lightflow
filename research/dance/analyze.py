"""Offline movement hypotheses, never human lighting labels. Append-only outputs."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import statistics
import uuid

BODY = (11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28)
CORE = (11, 12, 23, 24)
EXTREMITIES = (13, 14, 15, 16, 25, 26, 27, 28)
VERSION = 'dance-phrasing-v2-limb-groups'
RADIUS = 0.06
MAX_GAP = 0.15


def percentile(values, q, fallback=0):
    if not values:
        return fallback
    values = sorted(values)
    at = (len(values) - 1) * q
    low = math.floor(at)
    return values[low] + (values[math.ceil(at)] - values[low]) * (at - low)


def clamp(value):
    return max(0, min(1, value))


def fit_at(times, values, t):
    """Local line evaluated at t; uneven PTS must not shift constant-velocity motion."""
    mean_t, mean_v = statistics.mean(times), statistics.mean(values)
    denominator = sum((at - mean_t) ** 2 for at in times)
    slope = sum((at - mean_t) * (v - mean_v) for at, v in zip(times, values)) / denominator if denominator else 0
    return mean_v + slope * (t - mean_t)


def movement(frames, aspect):
    """Image-plane units, fixed torso scale, no bridging of missing observations."""
    if not math.isfinite(aspect) or aspect <= 0:
        raise ValueError('A valid video aspect ratio is required')
    raw, scales = [], []
    previous_t = -1
    for frame in frames:
        t = frame['t']
        if not math.isfinite(t) or t < 0 or t <= previous_t:
            raise ValueError('Frame timestamps must be finite and strictly increasing')
        previous_t = t
        poses, primary = frame['poses'], frame['primary']
        points = poses[primary] if primary is not None and 0 <= primary < len(poses) else None
        valid = points is not None and len(poses) == 1 and not frame.get('cut') and frame.get('track') is not None
        valid = valid and all(len(points[j]) >= 4 and all(math.isfinite(v) for v in points[j])
                              and points[j][3] >= 0.5 and 0 <= points[j][0] <= 1
                              and 0 <= points[j][1] <= 1 for j in BODY)
        if not valid:
            raw.append(None)
            continue
        xy = {j: [points[j][0] * aspect, points[j][1]] for j in BODY}
        center = [statistics.mean(xy[j][d] for j in CORE) for d in (0, 1)]
        scale = statistics.mean([math.dist(xy[11], xy[23]), math.dist(xy[12], xy[24])])
        if scale < 0.02:
            raw.append(None)
            continue
        scales.append(scale)
        raw.append({'center': center, 'xy': xy})
    scale = statistics.median(scales) if scales else 1
    rows = [{'t': f['t'], 'segment': None, 'speed': None, 'armSpeed': None, 'legSpeed': None, 'travel': None, 'extension': None,
             'deceleration': None, 'flow': None, 'punctuation': None, 'holding': False} for f in frames]
    segments, current = [], []
    for i, value in enumerate(raw):
        if current and (value is None or frames[i]['t'] - frames[i-1]['t'] > MAX_GAP
                        or frames[i]['track'] != frames[i-1]['track']):
            segments.append(current)
            current = []
        if value is not None:
            current.append(i)
    if current:
        segments.append(current)
    lookahead = 0
    for segment_id, indices in enumerate(segments):
        smooth, centers, supported_until = {}, {}, {}
        for i in indices:
            neighbors = [j for j in indices if abs(frames[j]['t'] - frames[i]['t']) <= RADIUS + 1e-8]
            times = [frames[j]['t'] for j in neighbors]
            centers[i] = [fit_at(times, [raw[j]['center'][d] for j in neighbors], frames[i]['t']) / scale for d in (0, 1)]
            smooth[i] = {joint: [fit_at(times, [raw[j]['xy'][joint][d] - raw[j]['center'][d]
                                              for j in neighbors], frames[i]['t']) / scale for d in (0, 1)] for joint in BODY}
            supported_until[i] = frames[neighbors[-1]]['t']
            rows[i]['segment'] = segment_id
            rows[i]['extension'] = statistics.mean(math.hypot(*smooth[i][j]) for j in EXTREMITIES)
        for position in range(1, len(indices) - 1):
            a, i, b = indices[position-1:position+2]
            dt = frames[b]['t'] - frames[a]['t']
            rows[i]['speed'] = statistics.mean(math.dist(smooth[b][j], smooth[a][j]) for j in BODY) / dt
            rows[i]['armSpeed'] = statistics.mean(math.dist(smooth[b][j], smooth[a][j]) for j in (13, 14, 15, 16)) / dt
            rows[i]['legSpeed'] = statistics.mean(math.dist(smooth[b][j], smooth[a][j]) for j in (25, 26, 27, 28)) / dt
            rows[i]['travel'] = math.dist(centers[b], centers[a]) / dt
            lookahead = max(lookahead, supported_until[b] - frames[i]['t'])
        for position in range(2, len(indices) - 1):
            a, i = indices[position-1:position+1]
            rows[i]['deceleration'] = max(0, (rows[a]['speed'] - rows[i]['speed']) / (frames[i]['t'] - frames[a]['t']))

    speed95 = max(0.5, percentile([r['speed'] for r in rows if r['speed'] is not None], .95))
    extension_values = [r['extension'] for r in rows if r['speed'] is not None]
    ext05, ext95 = percentile(extension_values, .05), percentile(extension_values, .95)
    decel85 = max(1.5, percentile([r['deceleration'] for r in rows if r['deceleration']], .85))
    candidates = []
    # Hold proposals require both relative stillness and little image-plane travel.
    hold = []
    def finish_hold():
        if hold and rows[hold[-1]]['t'] - rows[hold[0]]['t'] >= .24:
            for i in hold:
                rows[i]['holding'] = True
            candidates.append({'kind': 'hold', 'start': rows[hold[0]]['t'], 'end': rows[hold[-1]]['t'],
                               'reason': 'Relative speed < 0.25 torso lengths/s and center travel < 0.20 for at least 240 ms. Check whether this is an intentional hold.'})
        hold.clear()
    for i, row in enumerate(rows):
        if hold and row['segment'] != rows[hold[-1]]['segment']:
            finish_hold()
        if row['speed'] is not None and row['speed'] < .25 and row['travel'] < .20:
            hold.append(i)
        else:
            finish_hold()
    finish_hold()
    # Provisional arrivals: a local peak in slowing after visible movement.
    peaks = []
    for i in range(2, len(rows) - 1):
        a, r, b = rows[i-1:i+2]
        if (r['deceleration'] is not None and a['speed'] is not None and b['deceleration'] is not None
                and a['segment'] == r['segment'] == b['segment'] and a['speed'] > .45
                and r['deceleration'] >= decel85 and r['deceleration'] >= (a['deceleration'] or 0)
                and r['deceleration'] > b['deceleration']):
            peaks.append(i)
    selected = []
    for i in sorted(peaks, key=lambda j: rows[j]['deceleration'], reverse=True):
        if all(abs(rows[i]['t'] - rows[j]['t']) >= .35 for j in selected):
            selected.append(i)
    for i in sorted(selected):
        candidates.append({'kind': 'arrival', 'start': rows[i]['t'], 'end': rows[i]['t'],
                           'reason': f"Slowing peak {rows[i]['deceleration']:.2f} torso lengths/s² after movement. Could be articulation, tracking noise, or a turn; inspect it."})
    moving = []
    def finish_transition():
        if moving and rows[moving[-1]]['t'] - rows[moving[0]]['t'] >= .5:
            candidates.append({'kind': 'transition', 'start': rows[moving[0]]['t'], 'end': rows[moving[-1]]['t'],
                               'reason': 'At least 500 ms of uninterrupted relative movement ≥ 0.25 torso lengths/s. Continuity alone does not establish grace or musical phrasing.'})
        moving.clear()
    for i, row in enumerate(rows):
        if moving and row['segment'] != rows[moving[-1]]['segment']:
            finish_transition()
        if row['speed'] is not None and row['speed'] >= .25:
            moving.append(i)
        else:
            finish_transition()
    finish_transition()

    arrivals = set(selected)
    last_segment, held_base, pulse, previous_t = None, None, 0, 0
    for i, row in enumerate(rows):
        if row['speed'] is None:
            last_segment, held_base, pulse = None, None, 0
            continue
        dt = row['t'] - previous_t
        if row['segment'] != last_segment:
            held_base, pulse = None, 0
        extension = clamp((row['extension'] - ext05) / max(.15, ext95 - ext05))
        activity = clamp(row['speed'] / speed95)
        row['flow'] = clamp(.12 + .66 * extension + .22 * activity)
        if not row['holding'] or held_base is None:
            held_base = .15 + .45 * extension
        pulse = .35 if i in arrivals else pulse * math.exp(-max(0, dt) / .16)
        row['punctuation'] = clamp(held_base + pulse)
        last_segment, previous_t = row['segment'], row['t']
    candidates.sort(key=lambda c: (c['start'], c['kind']))
    for i, candidate in enumerate(candidates):
        candidate['id'] = f'cue-{i:03d}'
    return {'frames': rows, 'candidates': candidates,
            'parameters': {'torsoScale': scale, 'speed95': speed95, 'extension05': ext05,
                           'extension95': ext95, 'deceleration85': decel85,
                           'smoothingRadiusSeconds': RADIUS, 'maximumGapSeconds': MAX_GAP,
                           'measuredFeatureLookaheadSeconds': lookahead,
                           'holdRelativeSpeed': .25, 'holdTravelSpeed': .20, 'holdMinimumSeconds': .24},
            'coverage': sum(r['speed'] is not None for r in rows) / max(1, len(rows))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', required=True)
    args = parser.parse_args()
    root = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs').resolve()
    run = Path(args.run).resolve()
    if run.parent != root or not Path('/Volumes/ExtremePro').is_mount():
        raise ValueError('A run on the mounted SanDisk is required')
    job = json.loads((run / 'job.json').read_text())
    result = json.loads((run / 'result.json').read_text())
    if job.get('trackingMode') != 'solo':
        raise ValueError('Movement analysis requires a strict solo run')
    import av
    with av.open(str(run / 'preview.mp4')) as container:
        stream = container.streams.video[0]
        # Include display pixel aspect ratio, even though current previews are square-pixel.
        aspect = stream.width / stream.height * float(stream.sample_aspect_ratio or 1)
    chunks = sorted((run / 'frames').glob('*.json'))
    digest, frames = hashlib.sha256(), []
    for chunk in chunks:
        data = chunk.read_bytes()
        digest.update(data)
        frames.extend(json.loads(data))
    analysis = movement(frames, aspect)
    analysis_id = str(uuid.uuid4())
    analysis.update({'id': analysis_id, 'version': VERSION, 'runId': job['id'],
                     'createdAt': datetime.now(timezone.utc).isoformat(),
                     'duration': min(job['duration'], result['duration']), 'aspect': aspect,
                     'status': 'draft', 'sourceStart': job['start'],
                     'poseSha256': digest.hexdigest(),
                     'implementationSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                     'audioSha256': hashlib.sha256((run / 'audio.m4a').read_bytes()).hexdigest(),
                     'limitations': [
                         'Automatically proposed movement cues and authored brightness hypotheses; no trained model or human lighting labels.',
                         'Identity, exact joint locations and source A/V alignment still need visual/listening review.',
                         'Image-plane movement: camera motion, perspective, foreshortening and fine finger choreography are unresolved.',
                         'Centered smoothing and whole-passage calibration use future video. Hold and arrival proposals also use future observations; this is an offline teacher experiment, not a causal live controller.',
                         'Missing observations and segment edges remain null. No interpolation or darkness label is inserted.',
                     ]})
    directory = run / 'analyses'
    directory.mkdir(exist_ok=True)
    with (directory / f'{analysis_id}.json').open('x') as output:
        json.dump(analysis, output, allow_nan=False, separators=(',', ':'))
    print(analysis_id)


if __name__ == '__main__':
    main()
