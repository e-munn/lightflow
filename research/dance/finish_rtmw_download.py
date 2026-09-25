"""Retain a partial model download; finish into exclusively new files."""
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,os,shutil,subprocess,tempfile,urllib.request,zipfile
from pathlib import Path
root=Path('/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/rtmw-runtime-w574orm4')
folder=Path(tempfile.mkdtemp(prefix='completed-transfer-',dir=root))
url='https://download.openmmlab.com/mmpose/v1/projects/rtmw/onnx_sdk/rtmw-dw-x-l_simcc-cocktail14_270e-384x288_20231122.zip'
source=root/'pose.zip';offset=source.stat().st_size
head=urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=30);size=int(head.headers['Content-Length'])
chunk=(size-offset+3)//4
ranges=[(offset+i*chunk,min(size-1,offset+(i+1)*chunk-1)) for i in range(4) if offset+i*chunk<size]
def download(item):
 i,(start,end)=item;target=folder/f'part-{i}.bin'
 response=urllib.request.urlopen(urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}'}),timeout=120)
 if response.status!=206 or response.headers.get('Content-Range')!=f'bytes {start}-{end}/{size}':raise RuntimeError('Server did not honor byte range')
 with response,target.open('xb') as output:shutil.copyfileobj(response,output)
 if target.stat().st_size!=end-start+1:raise RuntimeError('Incomplete range')
 print(json.dumps({'part':i,'bytes':target.stat().st_size}),flush=True);return target
print(json.dumps({'resumeOffset':offset,'size':size,'folder':str(folder)}),flush=True)
with ThreadPoolExecutor(max_workers=4) as pool:parts=list(pool.map(download,enumerate(ranges)))
archive=folder/'complete.zip'
with archive.open('xb') as output:
 with source.open('rb') as incoming:shutil.copyfileobj(incoming,output)
 for part in parts:
  with part.open('rb') as incoming:shutil.copyfileobj(incoming,output)
if archive.stat().st_size!=size:raise RuntimeError('Unexpected archive size')
with zipfile.ZipFile(archive) as bundle:
 if bundle.testzip() is not None:raise RuntimeError('Archive CRC failed')
 files=[f for f in bundle.namelist() if f.endswith('.onnx')]
 if len(files)!=1:raise RuntimeError('Unexpected ONNX archive')
 model=folder/'pose.onnx'
 with bundle.open(files[0]) as incoming,model.open('xb') as output:shutil.copyfileobj(incoming,output)
config={'python':str(root/'venv/bin/python'),'root':str(root),'assets':{'detector':{'path':str(root/'detector.onnx'),'url':'https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_m_8xb8-300e_humanart-c2c7a14a.zip','sha256':hashlib.sha256((root/'detector.onnx').read_bytes()).hexdigest()},'pose':{'path':str(model),'url':url,'sha256':hashlib.sha256(model.read_bytes()).hexdigest()}}}
with (folder/'runtime.json').open('x') as f:json.dump(config,f,indent=2)
with (folder/'installed.txt').open('x') as f:subprocess.run([config['python'],'-m','pip','freeze'],stdout=f,check=True,env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'))
with Path(__file__).with_name('rtmw-runtime-2026-09-23.local.json').open('x') as f:json.dump(config,f,indent=2)
print(json.dumps({'runtime':str(folder/'runtime.json')}),flush=True)
