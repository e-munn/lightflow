"""Small CPU/CoreML numerical and latency check; new cache on SanDisk."""
import json,os,tempfile,time
from pathlib import Path
import av,numpy as np,onnxruntime as ort
from rtmlib import RTMPose,YOLOX
config=json.loads(Path(__file__).with_name('rtmw-runtime-2026-09-23.local.json').read_text())
folder=Path(tempfile.mkdtemp(prefix='coreml-check-',dir=Path(config['root'])))
print(json.dumps({'providers':ort.get_available_providers(),'folder':str(folder)}),flush=True)
if 'CoreMLExecutionProvider' not in ort.get_available_providers():raise RuntimeError('CoreML unavailable')
video='/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs/3946f65e-3938-4d38-ae54-4854c937d099/preview.mp4'
with av.open(video) as c:image=next(c.decode(video=0)).to_ndarray(format='bgr24')
results={}
for kind,cls,size in [('detector',YOLOX,(640,640)),('pose',RTMPose,(288,384))]:
 engine=cls(config['assets'][kind]['path'],model_input_size=size,backend='onnxruntime',device='cpu')
 prepared=engine.preprocess(image) if kind=='detector' else engine.preprocess(image,[0,0,image.shape[1],image.shape[0]])
 input_data=np.ascontiguousarray(prepared[0].transpose(2,0,1),dtype=np.float32)[None]
 options=ort.SessionOptions();options.intra_op_num_threads=4;options.inter_op_num_threads=1;options.add_session_config_entry('session.intra_op.allow_spinning','0')
 input_name=engine.session.get_inputs()[0].name
 cpu=ort.InferenceSession(config['assets'][kind]['path'],sess_options=options,providers=['CPUExecutionProvider'])
 baseline=cpu.run(None,{input_name:input_data});del cpu
 cache=folder/kind;cache.mkdir()
 started=time.monotonic()
 accelerated=ort.InferenceSession(config['assets'][kind]['path'],sess_options=options,providers=[('CoreMLExecutionProvider',{'ModelFormat':'MLProgram','MLComputeUnits':'ALL','ModelCacheDirectory':str(cache)}),'CPUExecutionProvider'])
 print(json.dumps({'kind':kind,'compileSeconds':time.monotonic()-started}),flush=True)
 times=[]
 for i in range(4):
  started=time.monotonic();outputs=accelerated.run(None,{input_name:input_data});times.append(time.monotonic()-started)
 diffs=[float(np.max(np.abs(a-b))) for a,b in zip(baseline,outputs)]
 results[kind]={'timings':times,'maxAbsoluteOutputDifferences':diffs,'cache':str(cache)}
 print(json.dumps({kind:results[kind]}),flush=True)
with (folder/'result.json').open('x') as f:json.dump(results,f,indent=2)
