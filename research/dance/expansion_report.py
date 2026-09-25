"""Summarize new solo runs without modifying source media or admitting training data."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import statistics

ROOT = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs')
GROUPS = {'torso': (11, 12, 23, 24), 'arms': (11, 12, 13, 14, 15, 16), 'legs': (23, 24, 25, 26, 27, 28)}


def valid(point):
    return len(point) >= 4 and point[3] >= .5 and all(math.isfinite(v) and 0 <= v <= 1 for v in point[:2])


def correlation(a, b):
    if len(a) < 3:
        return None
    ma, mb = statistics.mean(a), statistics.mean(b)
    da, db = [x-ma for x in a], [x-mb for x in b]
    denominator = math.sqrt(sum(x*x for x in da) * sum(x*x for x in db))
    return sum(x*y for x, y in zip(da, db)) / denominator if denominator else None


def summarize(run):
    job = json.loads((run/'job.json').read_text())
    result = json.loads((run/'result.json').read_text())
    frames = [f for p in sorted((run/'frames').glob('*.json')) for f in json.loads(p.read_text())]
    analyses = [json.loads(p.read_text()) for p in (run/'analyses').glob('*.json')]
    analysis = max(analyses, key=lambda a: a['createdAt']) if analyses else None
    groups, bad = Counter(), Counter()
    gap_duration, max_gap = 0, 0
    for i, f in enumerate(frames):
        dt = (frames[i+1]['t']-f['t']) if i+1 < len(frames) else 1/result['fps']
        p = f['poses'][f['primary']] if f['primary'] is not None else None
        if not p:
            gap_duration += dt
            max_gap = max(max_gap, gap_duration)
            continue
        gap_duration = 0
        for name, joints in GROUPS.items():
            groups[name] += all(valid(p[j]) for j in joints)
        for j in set(sum((list(g) for g in GROUPS.values()), [])):
            if not valid(p[j]): bad[str(j)] += 1
    movement = [f for f in analysis['frames'] if f['speed'] is not None] if analysis else []
    arm = [f['armSpeed'] for f in movement]
    leg = [f['legSpeed'] for f in movement]
    cue_counts = Counter(c['kind'] for c in analysis['candidates']) if analysis else Counter()
    return {
        'runId': run.name, 'sourceId': job['sourceId'], 'title': job['title'], 'sourceStart': job['start'],
        'duration': result['duration'], 'frames': len(frames), 'primaryCoverage': result['coverage'],
        'poseCoverage': result['poseCoverage'], 'movementCoverage': analysis['coverage'] if analysis else None,
        'multipleBodyFrames': result['multipleBodyFrames'], 'cutFlags': result['cutFlags'],
        'reviewRequiredFrames': result['reviewRequiredFrames'], 'longestUnassignedGapSeconds': max_gap,
        'groupVisibility': {name: groups[name]/max(1,len(frames)) for name in GROUPS},
        'missingMajorJoints': dict(bad.most_common()),
        'armLegSpeedCorrelation': correlation(arm,leg),
        'medianArmSpeed': statistics.median(arm) if arm else None,
        'medianLegSpeed': statistics.median(leg) if leg else None,
        'candidateEvents': dict(cue_counts),
        'quantitativeReviewTier': 'higher-coverage' if result['poseCoverage'] >= .85 and result['multipleBodyFrames']/max(1,len(frames)) <= .01 and not result['cutFlags'] and not result['reviewRequiredFrames'] else 'needs-inspection',
        'previewUrl': f'http://localhost:3001/pipeline/live?run={run.name}',
        'identityAccuracy': None,
    }


def main():
    p=argparse.ArgumentParser();p.add_argument('--since',required=True);p.add_argument('--out',required=True);args=p.parse_args()
    rows=[]
    for run in ROOT.iterdir():
        if not (run/'result.json').exists(): continue
        job=json.loads((run/'job.json').read_text())
        if job['createdAt'] >= args.since and job.get('trackingMode') == 'solo': rows.append(summarize(run))
    rows.sort(key=lambda r:(r['sourceId'],r['sourceStart']))
    data={'since':args.since,'runs':rows,'totals':{'runs':len(rows),'sources':len({r['sourceId'] for r in rows}),'seconds':sum(r['duration'] for r in rows),'frames':sum(r['frames'] for r in rows),'higherCoverageRuns':sum(r['quantitativeReviewTier']=='higher-coverage' for r in rows)},
          'limits':'Frame-weighted coverage is confidence/visibility, not anatomical or identity accuracy. Movement features require all major joints and use offline centered smoothing. Automatic arrival/hold/transition proposals are not validated music or lighting events. Source A/V offset unverified. No new model trained.'}
    with Path(args.out).open('x') as f:json.dump(data,f,indent=2,allow_nan=False)
    print(json.dumps(data['totals']))


if __name__=='__main__':main()
