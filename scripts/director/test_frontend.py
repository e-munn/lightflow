import os
os.environ['NUMBA_CACHE_DIR']='/private/tmp/lightflow-numba'
import numpy as np,librosa,json
from pathlib import Path
out=Path('scripts/director/artifacts');sr=22050;t=np.arange(sr*13)/sr
rng=np.random.default_rng(42)
y=((np.sin(t*2*np.pi*55)*.15+np.sin(t*2*np.pi*440)*.08)*(0.3+0.7*t/t[-1])+rng.normal(0,.002,len(t))).astype('float32')
y[100000:100080]+=.3
bank=librosa.filters.mel(sr=sr,n_fft=2048,n_mels=128);window=np.hanning(2049)[:-1];frames=[]
for end in np.ceil(np.arange(1,105)*sr/8).astype(int):
 power=abs(np.fft.rfft(y[end-2048:end]*window))**2;mel=bank@power;frames.append((np.maximum(-80,10*np.log10(np.maximum(1e-10,mel)))+40)/40)
y.tofile(out/'frontend-audio.f32');np.array(frames[-96:],dtype='float32').T.copy().tofile(out/'frontend-expected.f32')
