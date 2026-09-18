import assert from 'node:assert/strict';
import {ScopeFeatures} from '../../public/scope-core.mjs';
import {MusicFeatures} from '../../public/music-features.mjs';
import {ATTITUDES,AttitudeBank,defaultAttitudeSettings} from '../../public/scope-attitudes.mjs';
function run(kind,settings=defaultAttitudeSettings()){
 const scope=new ScopeFeatures(),music=new MusicFeatures(),bank=new AttitudeBank(),rows=[];let seed=4235;
 for(let k=0;k<200;k++){
  const left=new Float32Array(960),right=new Float32Array(960),hz=kind==='bass'?100:kind==='air'?7000:1000;
  for(let i=0;i<960;i++){const t=(k*960+i)/48000,phase=kind==='rise'?2*Math.PI*(100*t+600*t*t):2*Math.PI*hz*t;seed=(1664525*seed+1013904223)>>>0;left[i]=kind==='noise'?(seed/4294967296*2-1)*Math.sqrt(3)*.15:Math.SQRT2*.15*Math.sin(phase);right[i]=kind==='wide'?Math.SQRT2*.15*Math.cos(2*Math.PI*hz*t):left[i];}
  const frame={at:k*.02,...scope.frame(left,right),music:music.frame(left,right)};const result=bank.frame(frame,.5,settings);assert(result.values.every(x=>Number.isFinite(x)&&x>=0&&x<=1));rows.push(result.values);
 }
 return rows;
}
const tests=Object.fromEntries(['bass','mid','air','noise','wide'].map(k=>[k,run(k)]));
const last=k=>tests[k].at(-1);
// Identical RMS and identical scope-brightness input isolate the extra measures.
assert(last('bass')[1]>last('air')[1]*2,'Weight distinguishes bass at equal energy');
assert(last('air')[3]>last('bass')[3]*2,'Air distinguishes treble at equal energy');
assert(last('mid')[4]>last('bass')[4]*1.3,'Sustain responds to midrange body');
assert(last('wide')[5]>last('mid')[5]*2,'Width distinguishes stereo geometry');
assert(last('noise')[6]>last('bass')[6]*2,'Grain distinguishes roughness');
assert(tests.mid[0][9]<last('mid')[9]-.1,'Breathe dips on onset then recovers');
assert(tests.mid[0][2]>last('mid')[2]+.1,'Snap decays while steady tone continues');
assert(tests.mid[0][7]>last('mid')[7]+.1,'Space leaves darkness between onsets');
assert(run('rise').at(-1)[8]>last('mid')[8]+.1,'Swell responds to spectral rise at essentially constant energy');
const changed=defaultAttitudeSettings();changed.weight.drive=.2;assert(run('bass',changed).at(-1)[1]<last('bass')[1]-.1);
assert.deepEqual(run('noise'),tests.noise,'Deterministic prefixes');
const bank=new AttitudeBank(),frame={at:0,rms:.1,values:[.5,.2,.2,0,.2,.1,.8,.8],music:Array(16).fill(.5)};bank.frame(frame,.5);assert(bank.frame({...frame,at:.02,rms:0},.5).values.every(x=>x===0));assert.equal(bank.frame({...frame,music:[NaN]},.5).valid,false);
assert.equal(ATTITUDES.length,10);assert.equal(new Set(ATTITUDES.map(x=>x.id)).size,10);
console.log(JSON.stringify({passed:true,equalEnergyOutputs:Object.fromEntries(Object.keys(tests).map(k=>[k,last(k)])),checks:['ten unique alternatives','bass / treble / mids / width / roughness at equal energy','distinct onset and release timing','tweak changes target response','bounded finite output','deterministic prefixes','silence and invalid input blackout']},null,2));
