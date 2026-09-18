import assert from 'node:assert/strict';
import {RadialThreshold,radialWeight,matchMeanBrightness} from '../../public/scope-threshold.mjs';
const pixels=new Uint8ClampedArray(256*256*4);
// Two separated luminous regions, inside and outside a radius of .4.
for(let y=122;y<134;y++)for(let x=144;x<158;x++)pixels[(y*256+x)*4]=255;
for(let y=122;y<134;y++)for(let x=208;x<222;x++)pixels[(y*256+x)*4]=255;
function evaluate(settings,p=pixels){const d=new RadialThreshold();d.configure({radius:.4,...settings});return d.frame(p,0);}
const raw=evaluate({below:'keep',above:'keep'}),soft=evaluate({below:'soft'}),cut=evaluate({below:'cut'}),compressed=evaluate({below:'keep',above:'compress'}),expanded=evaluate({below:'keep',above:'expand'});
assert.equal(raw.baseline,raw.brightness);
assert(cut.brightness<soft.brightness&&soft.brightness<raw.brightness);
assert(compressed.brightness<raw.brightness&&expanded.brightness>raw.brightness);
assert.equal(evaluate({ratio:1,above:'expand'}).brightness,raw.brightness);
assert(evaluate({radius:.8,below:'cut'}).brightness<=cut.brightness);
assert.equal(radialWeight(.4,.4,'soft','expand',3),1);
const d=new RadialThreshold();d.configure({radius:.2,adaptive:true,adaptSeconds:3,releaseMs:500});
const first=d.frame(pixels,0);assert.equal(first.radius,.2);const second=d.frame(pixels,.02);assert(second.radius>.2&&second.radius<.21);
const silence=d.frame(new Uint8ClampedArray(pixels.length),.04);assert.equal(silence.brightness,0);
const gap=d.frame(pixels,1);assert.equal(gap.radius,.2);
assert.equal(d.frame([NaN],1.02).valid,false);
const a=new RadialThreshold(),b=new RadialThreshold();a.configure({adaptive:true});b.configure({adaptive:true});
for(let i=0;i<100;i++)assert.deepEqual(a.frame(pixels,i*.02),b.frame(pixels,i*.02));
const calibration=Array.from({length:250},(_,i)=>{const p=pixels.map((v,k)=>k%4===0?v*(.3+.7*(1+Math.sin(i/13))/2):v);return evaluate({below:'soft'},p);});
const matched=matchMeanBrightness(calibration);assert(matched);assert(Math.abs(matched.referenceMean-matched.matchedMean)<1e-10);assert(matched.gain>1&&!matched.limited);
assert.equal(matchMeanBrightness(calibration.map(r=>({...r,weightedCoverage:0}))),null);
assert.throws(()=>d.configure({radius:NaN}));
console.log(JSON.stringify({passed:true,raw:raw.brightness,soft:soft.brightness,cut:cut.brightness,compressed:compressed.brightness,expanded:expanded.brightness,matched,checks:['bypass identity','separated inside/outside response','bounded weighting and output','ratio-one identity','threshold monotonicity','previous-context-only adaptation','silence and gap reset','invalid input','deterministic identical prefix','frozen mean matching']},null,2));
