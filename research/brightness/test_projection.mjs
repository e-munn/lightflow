import assert from 'node:assert/strict';
import {coverageBrightness,SOFT_KNEE} from '../../public/scope-brightness.mjs';
import {traceMotion} from '../../public/scope-motion.mjs';
assert.equal(coverageBrightness(0,40,true),0);assert.equal(coverageBrightness(NaN,40,true),0);
let previous=-1;for(let i=0;i<=10000;i++){const x=i/10000,b=coverageBrightness(x,40,true);assert(Number.isFinite(b)&&b>=0&&b<=1&&b>previous);previous=b;}
const trainMedian=.8259373085171595/40;assert(Math.abs(coverageBrightness(trainMedian,40,true)-coverageBrightness(trainMedian,40,false))<1e-12);
// A pure pointwise curve has no tail after silence or hidden history.
coverageBrightness(.8,40,true);assert.equal(coverageBrightness(0,40,true),0);
assert.equal(traceMotion([0,0]).brightness,0);assert.equal(traceMotion([Infinity,0]).valid,false);assert.equal(traceMotion([0,1],[0]).valid,false);assert.equal(traceMotion([0,1],[0,1],0).valid,false);
const mono=Array.from({length:960},(_,i)=>.2*Math.SQRT2*Math.sin(2*Math.PI*100*i/48000)),fast=Array.from({length:960},(_,i)=>.2*Math.SQRT2*Math.sin(2*Math.PI*1000*i/48000));assert(traceMotion(fast).brightness>traceMotion(mono).brightness+.3);
console.log('PASS soft curve monotonicity, boundedness, silence, matched training median, invalid data; traversal sensitivity. Musical quality is not established.');
