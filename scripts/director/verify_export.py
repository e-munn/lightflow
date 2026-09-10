"""Numerical parity and inference-time checks; does not measure mic latency."""
import os
os.environ['KMP_DUPLICATE_LIB_OK']='TRUE'
from train_concert import Director,OUT
import numpy as np,torch,onnxruntime as ort,time,json
model=Director();model.load_state_dict(torch.load(OUT/'concert.pt',map_location='cpu',weights_only=True)['model']);model.eval();torch.set_num_threads(1)
s=ort.InferenceSession('public/models/concert.onnx',providers=['CPUExecutionProvider'])
x=np.random.default_rng(42).normal(size=(1,128,96)).astype('float32')
with torch.no_grad():p=model(torch.from_numpy(x)).numpy()
q=s.run(None,{'mel':x})[0];times=[]
for _ in range(100):
 t=time.perf_counter();s.run(None,{'mel':x});times.append((time.perf_counter()-t)*1000)
print(json.dumps({'max_error':float(abs(p-q).max()),'inference_ms_p50':float(np.median(times)),'inference_ms_p95':float(np.percentile(times,95))}))
