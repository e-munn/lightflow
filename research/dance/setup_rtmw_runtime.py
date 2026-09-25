"""Fresh RTMW comparison environment and official model assets on SanDisk."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

root=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance')
if not Path('/Volumes/ExtremePro').is_mount():raise RuntimeError('SanDisk required')
config=json.loads(Path(__file__).with_name('runtime.local.json').read_text())
folder=Path(tempfile.mkdtemp(prefix='rtmw-runtime-',dir=root))
env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1',PIP_NO_CACHE_DIR='1')
subprocess.run([config['python'],'-m','venv',str(folder/'venv')],check=True,env=env)
python=folder/'venv/bin/python'
subprocess.run([str(python),'-m','pip','install','--no-compile','numpy','onnxruntime','opencv-python','av','Pillow','tqdm'],check=True,env=env)
subprocess.run([str(python),'-m','pip','install','--no-compile','--no-deps','rtmlib'],check=True,env=env)
urls={
 'detector':'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip',
 'pose':'https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip',
}
assets={}
for name,url in urls.items():
 archive=folder/(name+'.zip')
 print(json.dumps({'stage':'download','asset':name,'folder':str(folder)}),flush=True)
 with urllib.request.urlopen(url,timeout=120) as response,archive.open('xb') as f:shutil.copyfileobj(response,f)
 with zipfile.ZipFile(archive) as bundle:
  files=[n for n in bundle.namelist() if n.endswith('.onnx')]
  if len(files)!=1:raise RuntimeError('Unexpected model archive')
  path=folder/(name+'.onnx')
  with bundle.open(files[0]) as source,path.open('xb') as target:shutil.copyfileobj(source,target)
 assets[name]={'path':str(path),'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
with (folder/'installed.txt').open('x') as f:subprocess.run([str(python),'-m','pip','freeze'],stdout=f,check=True,env=env)
result={'python':str(python),'root':str(folder),'assets':assets}
with (folder/'runtime.json').open('x') as f:json.dump(result,f,indent=2)
# Lightweight pointer for this experiment only; production runtime remains untouched.
with Path(__file__).with_name('rtmw-runtime-2026-09-23.local.json').open('x') as f:json.dump(result,f,indent=2)
print(json.dumps(result),flush=True)
