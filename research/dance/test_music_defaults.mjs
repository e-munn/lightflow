import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {DanceAudio,HOP,RATE} from '../../public/dance-audio.mjs';
const temp=mkdtempSync('/private/tmp/lightflow-music-defaults-');
for(const name of ['music-context','movement-brightness'])writeFileSync(`${temp}/${name}.mjs`,ts.transpileModule(readFileSync(`src/lib/pipeline/${name}.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {analyzeMusic,musicBrightnessDefault}=await import(pathToFileURL(`${temp}/music-context.mjs`));
const {deriveBrightnessDefaults}=await import(pathToFileURL(`${temp}/movement-brightness.mjs`));
const click=bpm=>Array.from({length:1500},(_,i)=>{
 const t=i*.02,period=60/bpm,phase=t%period,distance=Math.min(phase,period-phase),pulse=Math.exp(-((distance/.018)**2));
 return {t,rms:.01+.3*pulse,flux:pulse};
});
const estimates=[];
for(const bpm of [90,120,150]){
 const result=analyzeMusic(click(bpm));estimates.push(result);
 assert.ok(result.bpm!==null&&Math.abs(result.bpm-bpm)<3,`${bpm} BPM clicks: ${JSON.stringify(result)}`);
 assert.equal(result.texture,'percussive');
}
const silent=click(120).map(f=>({...f,rms:0,flux:0}));assert.equal(analyzeMusic(silent).bpm,null);assert.equal(analyzeMusic(silent).texture,'quiet');
const pad=click(120).map(f=>({...f,rms:.2,flux:.0000001}));assert.equal(analyzeMusic(pad).bpm,null);assert.equal(analyzeMusic(pad).texture,'sustained');
let seed=13;const noise=click(120).map(f=>{seed=(seed*1664525+1013904223)>>>0;return {...f,rms:.15,flux:seed/2**32};});
assert.equal(analyzeMusic(noise).bpm,null,'Irregular novelty must not become a confident tempo');
assert.equal(analyzeMusic(click(120).slice(0,200)).bpm,null,'A short sample cannot establish tempo');
const bad=click(120);bad[200].flux=NaN;assert.equal(analyzeMusic(bad).bpm,null);
const base={gain:.9,fade:120,events:10,spacingMs:500,coverage:1,measured:true,reason:'Movement default'};
const fast=musicBrightnessDefault(base,'motion',estimates[2]),slow=musicBrightnessDefault(base,'motion',estimates[0]);
assert.ok(fast.fade<slow.fade,'Faster music needs a shorter time scale');
assert.equal(fast.gain,base.gain,'BPM cannot increase sensitivity');
const punch={...estimates[1],percussiveness:1},smooth={...estimates[1],percussiveness:0};
assert.ok(musicBrightnessDefault(base,'motion',punch).fade<musicBrightnessDefault(base,'motion',smooth).fade,'Sustained texture keeps a longer tail');
assert.ok(musicBrightnessDefault(base,'snap',punch).fade<musicBrightnessDefault(base,'open',punch).fade,'Snap and Open retain distinct roles');
assert.equal(musicBrightnessDefault(base,'motion',{...punch,bpm:null}).fade,120,'Uncertain BPM falls back without invented tempo');
const signals=click(120).map((f,i)=>({t:f.t,index:i,motion:f.flux,arms:f.flux,legs:f.flux,snap:f.flux,stops:f.flux,hold:f.flux,open:f.flux}));
const calibrated=deriveBrightnessDefaults(signals);
assert.equal(calibrated.motion.gain,.9);assert.ok(Math.abs(calibrated.motion.fade-110)<=10);assert.equal(calibrated.motion.measured,true);
const masked=signals.map((f,i)=>i%30<25?{...f,motion:null}:f);
assert.equal(deriveBrightnessDefaults(masked).motion.measured,false,'Poor tracking needs a fallback');
assert.equal(deriveBrightnessDefaults(signals.map(f=>({...f,motion:.001}))).motion.gain,1,'Weak flat noise must not be amplified');

// Exercise the real FFT feature extractor, not just ideal novelty curves.
const engine=new DanceAudio(),features=[];
for(let start=0;start<16*RATE;start+=HOP){
 const chunk=Float32Array.from({length:HOP},(_,i)=>{const t=(start+i)/RATE,phase=t%.5;return .4*Math.exp(-phase/.025)*Math.sin(2*Math.PI*220*t);});
 const f=engine.step(chunk);features.push({t:f.t,rms:f.rms,flux:f.features[9]});
}
const extracted=analyzeMusic(features);assert.ok(Math.abs(extracted.bpm-120)<3,`Extracted 120 BPM: ${JSON.stringify(extracted)}`);
console.log(JSON.stringify({passed:true,syntheticTempos:estimates.map(e=>e.bpm),extractedTempo:extracted.bpm,checks:['tempo','silence','sustained tone','irregular hits','short audio','invalid input','tempo-scaled release','texture-scaled release','mode roles','no tempo-driven gain','uncertain fallback','movement calibration','confidence gating','weak-noise guard','real FFT path']}));
