"""Install a fresh, isolated runtime on SanDisk. Never mutate an earlier runtime."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import urllib.request

if not Path('/Volumes/ExtremePro').is_mount():
    raise SystemExit('Connect SanDisk ExtremePro first')
root = Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance')
root.mkdir(parents=True, exist_ok=True)
runtime = Path(tempfile.mkdtemp(prefix='runtime-', dir=root))
subprocess.run([sys.executable, '-m', 'venv', str(runtime / 'venv')], check=True)
python = str(runtime / 'venv/bin/python')
subprocess.run([python, '-m', 'pip', 'install', '--no-cache-dir',
                '-r', str(Path(__file__).with_name('requirements.txt'))], check=True)
url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
with urllib.request.urlopen(url) as response, (runtime / 'pose_landmarker_full.task').open('xb') as output:
    output.write(response.read())
config = {'python': python, 'model': str(runtime / 'pose_landmarker_full.task'),
          'ffmpeg': '/Users/elijah/miniconda3/bin/ffmpeg', 'model_url': url}
# Only this machine-local workspace pointer changes. All drive artifacts are retained.
Path(__file__).with_name('runtime.local.json').write_text(json.dumps(config, indent=2))
with (runtime / 'installed.txt').open('x') as output:
    subprocess.run([python, '-m', 'pip', 'freeze'], stdout=output, check=True)
print(json.dumps(config))
