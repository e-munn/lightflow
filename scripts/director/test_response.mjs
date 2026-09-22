// Synthetic software timing checks. These do not measure microphone-to-photon latency.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
function load(file){const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);return context.exports;}
const {PhrasePlayer}=load('src/lib/director/phrases.ts');
const {Score}=load('src/lib/director/score.ts');
const {RESPONSE_MODES}=load('src/lib/director/response.ts');
const library={duration:2,prior:[.5,.5],prototypes:[Array.from({length:4},()=>Array(7).fill(.1)),Array.from({length:4},()=>Array(7).fill(.9))]};
const prefer=i=>i===0?[8,-8]:[-8,8];
function switchDelay(mode,changeAt){
 const player=new PhrasePlayer(library);let previous;let maxJump=0;
 for(let frame=0;frame<=360;frame++){
  const time=frame/120,predictionAt=Math.floor((time+1e-9)*8)/8;
  const output=player.update(time,prefer(predictionAt<changeAt?0:1),{...RESPONSE_MODES[mode],predictionAt});
  assert(output.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  if(previous)maxJump=Math.max(maxJump,...output.map((v,i)=>Math.abs(v-previous[i])));
  previous=output;
  if(player.phrase===1)return {delaySeconds:+(time-changeAt).toFixed(4),maxJump};
 }
 throw Error('No change');
}
const probes=[.05,.5,1,1.9].map(changeAt=>({changeAt,fast:switchDelay('fast',changeAt).delaySeconds,original:switchDelay('original',changeAt).delaySeconds}));
for(const p of probes){assert(p.fast<=.251,JSON.stringify(p));assert(p.fast<=p.original+.001,JSON.stringify(p));}
// Repeated renders of one fresh prediction must not count as independent agreement.
const repeated=new PhrasePlayer(library);repeated.update(0,prefer(0),{...RESPONSE_MODES.fast,predictionAt:0});
for(let i=1;i<100;i++)repeated.update(i/100,prefer(1),{...RESPONSE_MODES.fast,predictionAt:.125});
assert.equal(repeated.phrase,0,'One prediction was counted more than once');
repeated.update(1,prefer(1),{...RESPONSE_MODES.fast,predictionAt:1});assert.equal(repeated.phrase,1);
// Alternating candidates and weak preferences retain the current phrase.
for(const weak of [false,true]){
 const player=new PhrasePlayer(library);player.update(0,prefer(0),{...RESPONSE_MODES.fast,predictionAt:0});
 for(let i=1;i<16;i++){player.update(i/8,weak?[0,.1]:prefer(i%2),{...RESPONSE_MODES.fast,predictionAt:i/8});assert.equal(player.phrase,0);}
}
// A sustained winner does not restart the same pattern on every prediction.
const steady=new PhrasePlayer(library);for(let i=0;i<32;i++)assert(steady.update(i/8,prefer(0),{...RESPONSE_MODES.fast,predictionAt:i/8}).every(v=>Math.abs(v-.1)<1e-10));
// At an interruption the output starts at the previous value, then approaches the new pattern.
const smooth=new PhrasePlayer(library);smooth.update(0,prefer(0),{...RESPONSE_MODES.fast,predictionAt:0});smooth.update(.125,prefer(1),{...RESPONSE_MODES.fast,predictionAt:.125});
assert.equal(smooth.update(.25,prefer(1),{...RESPONSE_MODES.fast,predictionAt:.25})[0],.1);
const middle=smooth.update(.29,prefer(1),{...RESPONSE_MODES.fast,predictionAt:.25})[0];assert(middle>.1&&middle<.9);
assert(Math.abs(smooth.update(.34,prefer(1),{...RESPONSE_MODES.fast,predictionAt:.25})[0]-.9)<1e-9);
assert.equal(smooth.update(NaN,prefer(1)),undefined);
// Measure only the brightness envelope's 63% step response, at a fixed synthetic sample rate.
function envelope(mode){const score=new Score();score.cue.brightness=0;for(let i=1;i<120;i++){const t=i/120;const c=score.update(t,.2,null,[1,.3,.4,.5,.5],mode.brightnessSeconds);if(c.brightness>=1-Math.exp(-1))return t;}throw Error('No envelope response');}
const fastEnvelope=envelope(RESPONSE_MODES.fast),originalEnvelope=envelope(RESPONSE_MODES.original);
assert(fastEnvelope<.06);assert(originalEnvelope>=.19);
console.log(JSON.stringify({passed:true,probes,brightness63PercentSeconds:{fast:fastEnvelope,original:originalEnvelope},checks:['original timing preserved','two fresh predictions required','weak and oscillating changes rejected','stable patterns retained','continuous bounded joins','faster brightness step response'],physicalLatencyMeasured:false},null,2));
