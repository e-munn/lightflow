"""Model-only Full/Heavy comparison. All SanDisk outputs are new/exclusive."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import uuid
import zipfile

HERE = Path(__file__).resolve().parent
ROOT = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance')
RUNS = ROOT / 'runs'
SOURCES = [
    ('89dab10c-317e-4ea4-aa70-beb1b86d0438', 'Beat Killer', 'clean popping'),
    ('3946f65e-3938-4d38-ae54-4854c937d099', 'Crave You', 'missing arm joints'),
    ('32e7239a-1f50-486a-82ee-afd3ac8875ed', 'Feel the Way I Feel', 'duplicate proposals'),
]
URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'


def save(path, value):
    with path.open('x') as f:
        json.dump(value, f, indent=2, allow_nan=False)


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        while block := f.read(1024 * 1024):
            h.update(block)
    return h.hexdigest()


def protected_hashes(run):
    paths = [run / n for n in ('job.json', 'result.json', 'preview.mp4', 'audio.m4a', 'waveform.json')]
    paths += sorted((run / 'frames').glob('*.json'))
    return {str(p.relative_to(run)): digest(p) for p in paths}


def main():
    if not Path('/Volumes/ExtremePro').is_mount():
        raise RuntimeError('SanDisk is not mounted')
    config = json.loads((HERE / 'runtime.local.json').read_text())
    study = Path(tempfile.mkdtemp(prefix='pose-quality-20260923-', dir=ROOT))
    model = study / 'pose_landmarker_heavy.task'
    print(json.dumps({'study': str(study), 'stage': 'download'}), flush=True)
    with urllib.request.urlopen(URL, timeout=120) as response, model.open('xb') as output:
        shutil.copyfileobj(response, output)
    with zipfile.ZipFile(model) as bundle:
        if bundle.testzip() is not None or len(bundle.namelist()) < 2:
            raise ValueError('Invalid model bundle')
    save(study / 'model.json', {'url': URL, 'bytes': model.stat().st_size, 'sha256': digest(model)})
    rows = []
    for original_id, title, reason in SOURCES:
        original = RUNS / original_id
        before = protected_hashes(original)
        old_job = json.loads((original / 'job.json').read_text())
        new_id = str(uuid.uuid4())
        run = RUNS / new_id
        run.mkdir()
        for sub in ('events', 'frames', 'notes', 'reviews'):
            (run / sub).mkdir()
        job = {**old_job, 'id': new_id, 'title': old_job['title'] + ' · Heavy comparison',
               'createdAt': datetime.now(timezone.utc).isoformat(), 'comparisonSourceRun': original_id,
               'poseModel': 'MediaPipe Pose Landmarker Heavy'}
        save(run / 'job.json', job)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1', MPLCONFIGDIR=str(run / 'mpl-cache'))
        with (run / 'worker.log').open('x') as log:
            worker = subprocess.Popen([config['python'], str(HERE / 'process.py'), '--run', str(run),
                                       '--model-path', str(model), '--model-label', 'MediaPipe Pose Landmarker Heavy',
                                       '--replay-from', original_id], stdout=log, stderr=log, env=env)
            save(run / 'worker.json', {'pid': worker.pid})
            print(json.dumps({'started': new_id, 'original': original_id, 'title': title}), flush=True)
            code = worker.wait()
        if protected_hashes(original) != before:
            raise RuntimeError('Original artifacts changed during comparison')
        row = {'baseline': original_id, 'candidate': new_id, 'title': title, 'reason': reason, 'exitCode': code,
               'baselineProtectedHashes': before}
        if code == 0:
            result = json.loads((run / 'result.json').read_text())
            baseline = json.loads((original / 'result.json').read_text())
            identical = all(digest(run / n) == before[n] for n in ('preview.mp4', 'audio.m4a', 'waveform.json'))
            if not identical:
                raise RuntimeError('Comparison media are not byte-identical')
            row.update({'baselineResult': baseline, 'candidateResult': result, 'identicalMedia': identical})
            print(json.dumps({'complete': new_id, 'title': title, 'coverageBefore': baseline['poseCoverage'],
                              'coverageAfter': result['poseCoverage'], 'seconds': result['extractionSeconds']}), flush=True)
        else:
            print(json.dumps({'failed': new_id, 'exitCode': code, 'log': str(run / 'worker.log')}), flush=True)
        rows.append(row)
        save(study / f'comparison-{len(rows):02d}.json', row)
    report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'studyDirectory': str(study),
              'policy': 'Only model weights changed; identical video/audio, timestamps, thresholds, multi-body detection and strict identity gate. No smoothing or interpolation.',
              'model': {'url': URL, 'sha256': digest(model)}, 'rows': rows}
    save(study / 'comparison.json', report)
    destination = HERE / ('pose-quality-benchmark-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    save(destination, report)
    print(json.dumps({'report': str(destination), 'study': str(study)}), flush=True)


if __name__ == '__main__':
    main()
