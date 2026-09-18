import assert from 'node:assert/strict';
import {buildPhrase,PHRASE_DEFAULTS,phraseIndex,validPhraseSettings} from '../../public/scope-phrase.mjs';
const frames=Array.from({length:1600},(_,i)=>({time:(i+1)/50,rms:.1,scope:{brightness:.15+(i%13)/50},metrics:{onset:i%25===0?.9:.03},values:[.4],styleValues:[0,0,0,0,0,0,.18+(i%7)/50]}));
const p=buildPhrase(frames);assert(p.stats.matched);assert(Math.abs(p.stats.baselineMean-p.stats.shapedMean)<1e-10);assert(p.stats.rmsDifference>.05);assert(p.shaped.every(v=>v>=0&&v<=1));assert.deepEqual(p.baseline,frames.map(f=>f.scope.brightness));
assert(p.modes.every((m,i)=>m===(frames[i].time<PHRASE_DEFAULTS.impact?'grain':'snap')));
assert.equal(phraseIndex(0,1600),-1);assert.equal(phraseIndex(.01999,1600),-1);assert.equal(phraseIndex(.02,1600),0);assert.equal(phraseIndex(.03999,1600),0);assert.equal(phraseIndex(32,1600),1599);assert.equal(phraseIndex(32.01,1600),-1);
const zero=frames.map(f=>({...f,rms:0}));assert(buildPhrase(zero).shaped.every(v=>v===0));
assert(!validPhraseSettings({...PHRASE_DEFAULTS,impact:NaN}));assert(!validPhraseSettings({...PHRASE_DEFAULTS,impact:31}));assert.throws(()=>buildPhrase(frames,{...PHRASE_DEFAULTS,quiet:2}));
const short=buildPhrase(frames,{...PHRASE_DEFAULTS,match:false,decay:30}),long=buildPhrase(frames,{...PHRASE_DEFAULTS,match:false,decay:350});assert(long.shaped[1520]>short.shaped[1520]);
// Editing a later marker changes the marked section, with no effect on A.
const moved=buildPhrase(frames,{...PHRASE_DEFAULTS,impact:20});assert.deepEqual(p.baseline,moved.baseline);assert.equal(moved.modes[800],'grain');assert.equal(p.modes[800],'snap');
console.log(JSON.stringify({passed:true,checks:['exact mean brightness match','baseline preserved','single bounded scalar','silence stays black','explicit marker timing','tail changes decay','invalid settings rejected','sample lookup never reads a future window']}));
