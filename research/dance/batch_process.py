"""Sequential, append-only extraction of registered candidate passages."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import uuid


def write(file, data):
    with file.open('x') as f:
        json.dump(data, f, allow_nan=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('spec')
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    config = json.loads((here / 'runtime.local.json').read_text())
    registry = json.loads((here / 'sources.json').read_text())
    sources = {s['video_id']: s for s in [registry['pilot'], *registry['additional_references']]}
    root = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs')
    if not Path('/Volumes/ExtremePro').is_mount():
        raise RuntimeError('SanDisk is not mounted')
    for spec in json.loads(Path(args.spec).read_text()):
        source = sources[spec['sourceId']]
        run_id = str(uuid.uuid4())
        run = root / run_id
        run.mkdir()
        for sub in ('events', 'frames', 'notes', 'reviews'):
            (run / sub).mkdir()
        job = dict(spec, id=run_id, title=source['title'], trackingMode='solo',
                   sourcePath=str(Path(source['local_directory']) / (source['video_id'] + '.mkv')),
                   createdAt=datetime.now(timezone.utc).isoformat())
        write(run / 'job.json', job)
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONUNBUFFERED='1', MPLCONFIGDIR=str(run / 'mpl-cache'))
        with (run / 'worker.log').open('x') as log:
            worker = subprocess.Popen([config['python'], str(here / 'process.py'), '--run', str(run)], stdout=log, stderr=log, env=env)
            write(run / 'worker.json', {'pid': worker.pid})
            print(json.dumps({'started': run_id, 'source': source['video_id']}), flush=True)
            code = worker.wait()
        if code == 0:
            subprocess.run([config['python'], str(here / 'analyze.py'), '--run', str(run)], check=True, env=env)
            result = json.loads((run / 'result.json').read_text())
            print(json.dumps({'complete': run_id, 'source': source['video_id'], 'coverage': result['poseCoverage'], 'frames': result['frames']}), flush=True)
        else:
            print(json.dumps({'failed': run_id, 'code': code}), flush=True)


if __name__ == '__main__':
    main()
