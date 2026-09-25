import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { DanceAudio, HOP, inferBuffer } from '../../public/dance-audio.mjs';
import { CausalResampler } from '../../public/dance-resample.mjs';
const runtime = JSON.parse(fs.readFileSync(new URL('./runtime.local.json', import.meta.url)));
const python = String.raw`
import json,sys
sys.path.insert(0,'research/dance')
import numpy as np
from audio_features import extract,fit_ridge,predict
n=np.arange(320*90);x=(.15*np.sin(2*np.pi*137*n/16000)*(1+.2*np.sin(n/790))+.03*np.cos(n*.43)).astype(np.float32)
features,t,rms=extract(x)
y=np.c_[.5+.2*np.sin(t),.4+.1*np.cos(t),.3+.1*np.sin(2*t),.5+.1*np.cos(2*t),.3+.2*np.sin(3*t),np.zeros(len(t))]
model=fit_ridge(features,y,.1);model['indices']=list(range(features.shape[1]))
direct=fit_ridge(features,y[:,0:1],.1);direct['indices']=list(range(features.shape[1]))
rmsidx=[8+i*12 for i in range(8)];rmsmodel=fit_ridge(features[:,rmsidx],y[:,0:1],.1);rmsmodel['indices']=rmsidx
def d(v):return v.tolist() if isinstance(v,np.ndarray) else float(v)
print(json.dumps({'audio':x.tolist(),'features':features.tolist(),'rms':rms.tolist(),'predictions':predict(model,features).tolist(),'model':{'warmupSeconds':1.32,'models':{'movement':model,'direct':direct,'rms':rmsmodel}}},default=d))
`;
const fixture = JSON.parse(execFileSync(runtime.python, ['-c', python], { cwd: process.cwd(), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 8e6 }).toString());
const stream = new DanceAudio(fixture.model), samples = Float32Array.from(fixture.audio);
let featureError = 0, predictionError = 0;
for (let i = 0; i < fixture.features.length; i++) {
  const result = stream.step(samples.subarray(i * HOP, (i + 1) * HOP));
  fixture.features[i].forEach((v, j) => { featureError = Math.max(featureError, Math.abs(v - result.features[j])); });
  fixture.predictions[i].forEach((v, j) => { predictionError = Math.max(predictionError, Math.abs(v - result.components[j])); });
}
assert.ok(featureError < 1e-10, `Python/JS feature mismatch ${featureError}`);
assert.ok(predictionError < 1e-10, `Python/JS inference mismatch ${predictionError}`);
const all = inferBuffer(samples, fixture.model), prefix = inferBuffer(samples.subarray(0, HOP * 45), fixture.model);
assert.deepEqual(all.slice(0, prefix.length), prefix, 'No future audio may influence a prefix');
const silence = new DanceAudio(fixture.model).step(new Float32Array(HOP));
assert.equal(silence.movement, 0); assert.equal(silence.direct, 0); assert.equal(silence.silent, true);
const convert = hz => {
  const r = new CausalResampler(48000), result = [];
  for (let i = 0; i < 48000; i++) r.push(Math.sin(2*Math.PI*hz*i/48000), v => result.push(v));
  assert.equal(result.length,16000);
  return Math.sqrt(result.slice(100).reduce((s,v)=>s+v*v,0)/(result.length-100));
};
const passband = convert(1000), alias = convert(12000);
assert.ok(passband > .68 && passband < .73);
assert.ok(alias < passband*.01, 'Above-Nyquist capture audio must not alias into the model bands');
console.log(JSON.stringify({ passed: true, featureError, predictionError, passbandRms:passband, aliasRms:alias, checks: ['Python/JS parity', 'streaming prefix causality', 'explicit silence guard', '48-to-16 kHz antialiasing'] }));
