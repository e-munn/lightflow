const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixturePreview,behaviorFromCue,validatePatch}=require('/tmp/lightflow-fixture-adapter-test/scope/fixtureAdapter.js');
const {RIG}=require('/tmp/lightflow-fixture-adapter-test/fixtures.js');
const signal=behaviorFromCue([.8,.5,.8,.2,0,.3],1000);validatePatch();
const p=fixturePreview(signal,1020);assert(p.valid);assert.equal(p.universe.length,128);assert.equal(Object.keys(p.states).length,4);
for(const s of Object.values(p.states))assert(s.dim>0&&s.dim<=.8);
for(const f of RIG.filter(f=>f.active!==false)){
 const a=f.addr-1;if(f.kind==='spot160'){assert.equal(p.universe[a+8],5);assert.equal(p.universe[a+9],0);assert.equal(p.universe[a+10],0);assert.equal(p.states[f.id].pan,.5);}
 if(f.kind==='shockerPanel'){assert.equal(p.universe[a+1],0);assert.equal(p.universe[a+5],0);assert.equal(p.universe[a+6],0);assert.equal(p.universe[a+7],0);}
}
for(const bad of [null,{...signal,intensity:NaN},{...signal,sampleTimeMs:2000},{...signal,sampleTimeMs:0}]){
 const b=fixturePreview(bad,1020);assert(!b.valid);assert(Object.values(b.states).every(s=>s.dim===0));assert.equal(b.universe[24],0);assert.equal(b.universe[35],0);assert.equal(b.universe[0],0);assert.equal(b.universe[8],0);
}
assert(Object.values(fixturePreview({...signal,intensity:0},1020).states).every(s=>s.dim===0));
assert.throws(()=>validatePatch([{...RIG[1],addr:1},{...RIG[2],addr:1}]),/Overlapping/);
assert.throws(()=>validatePatch([{...RIG[1],addr:127}]),/exceeds/);
assert.throws(()=>validatePatch([{...RIG[1],cal:{dimGamma:0}}]),/gamma/);
const input=JSON.parse(fs.readFileSync('/Volumes/ExtremePro/Code/lightflow/research/native_cues/browser_streaming_v1/file.json'));
let frames=0,maxJump=0,last;
for(const f of input.frames){const v=f.outputs?.[1];if(!v)continue;const q=fixturePreview(behaviorFromCue(v,f.at*1000),f.at*1000);assert(q.valid);assert(Array.from(q.universe).every(x=>Number.isInteger(x)&&x>=0&&x<=255));if(last)maxJump=Math.max(maxJump,Math.abs(q.universe[0]-last[0]));last=q.universe;frames++;}
assert.equal(frames,1500);console.log(JSON.stringify({passed:true,traceFrames:frames,largestShockerDimmerStep:maxJump,hardwareTransmission:false,checks:['patch overlap/bounds/calibration','nonfinite/future/stale/missing fail dark','zero intensity stays dark','strobe/programs/control zero','parked moving heads','saved learned-output trace maps to bounded channel bytes']}));
