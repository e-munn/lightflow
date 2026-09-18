import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ScopeFeatures,FeatureHistory,predict,lightSignal} from '../../public/scope-core.mjs';
const n=960,l=Float32Array.from({length:n},(_,i)=>.2*Math.sin(2*Math.PI*200*i/48000));
const q=Float32Array.from({length:n},(_,i)=>.2*Math.cos(2*Math.PI*200*i/48000));
const mono=new ScopeFeatures().frame(l,l),quad=new ScopeFeatures().frame(l,q);
assert(mono.values[1]<1e-5);assert(quad.values[1]>.999);assert(Math.abs(mono.values[0]-quad.values[0])<1e-7);
const silence=new ScopeFeatures().frame(new Float32Array(n));assert(silence.values.every(v=>v===0));
const inverted=new ScopeFeatures().frame(l,l.map(v=>-v));assert(inverted.values[7]<-.999);assert(inverted.values[1]<1e-5);
assert(mono.values[4]>.1&&mono.values[4]<.8);
const a=new ScopeFeatures(),b=new ScopeFeatures();
for(let i=0;i<20;i++)assert.deepEqual(a.frame(l,q),b.frame(l,q));
function sequence(altered){const dsp=new ScopeFeatures();return Array.from({length:40},(_,i)=>dsp.frame(altered&&i>=20?l.map(v=>v*3):l,q));}
assert.deepEqual(sequence(false).slice(0,20),sequence(true).slice(0,20));
const h=new FeatureHistory();for(let i=0;i<101;i++)h.push(Array(8).fill(i));assert(h.ready);assert.equal(h.input()[0],100);assert.equal(h.input().at(-1),0);
const base=lightSignal(mono.values,Array(8).fill(1),false,Array(8).fill(true));
const rejected=lightSignal(mono.values,Array(8).fill(1),true,Array(8).fill(false));assert.equal(base.intensity,rejected.intensity);
// Use saved PyTorch cases to verify actual exported inference when supplied.
if(process.argv[2]){
 const dir=process.argv[2],model=JSON.parse(fs.readFileSync(dir+'/model.json')),cases=JSON.parse(fs.readFileSync(dir+'/parity_cases.json'));
 let error=0;cases.inputs.forEach((x,i)=>predict(model,x).forEach((v,j)=>error=Math.max(error,Math.abs(v-cases.expected[i][j]))));
 assert(error<1e-5);console.log('PyTorch / shared JS max error',error);
}
console.log('PASS: mono/phase/silence, amplitude invariance, history order, rejected forecast gating');
