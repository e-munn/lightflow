import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp=mkdtempSync('/private/tmp/lightflow-smoothing-');
const compiled=ts.transpileModule(readFileSync('src/lib/pipeline/skeleton-smoothing.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
writeFileSync(temp+'/smoothing.mjs',compiled);
const {smoothSkeletonFrames,SkeletonDisplayFilter,DEFAULT_SMOOTHING}=await import(pathToFileURL(temp+'/smoothing.mjs'));
const frame=(i,x=.5)=>({t:i/60,index:i,poses:[Array.from({length:33},()=>[x,.5,0,1])],primary:0,track:1,state:'tracked',speed:null,cut:false,poseUsable:true});
const x=f=>f.poses[0][0][0];
const input=Array.from({length:240},(_,i)=>frame(i,.5+.01*Math.sin(2*Math.PI*15*i/60)));
const before=JSON.stringify(input),settings={...DEFAULT_SMOOTHING,steadiness:75,responsiveness:0};
const filtered=smoothSkeletonFrames(input,settings,16/9);
const energy=rows=>Math.sqrt(rows.slice(60).reduce((sum,f)=>sum+(x(f)-.5)**2,0)/180);
const ratio=energy(filtered)/energy(input);
assert.ok(ratio<.3,`Stationary jitter ratio ${ratio}`);
assert.equal(JSON.stringify(input),before,'Raw observations must be unchanged');
assert.equal(smoothSkeletonFrames(input,{...settings,enabled:false}),input,'Off must be exact raw data');
assert.equal(smoothSkeletonFrames(input,{...settings,steadiness:0}),input,'Zero must be exact raw data');
const step=Array.from({length:90},(_,i)=>frame(i,i<30?.2:.8));
const slow=smoothSkeletonFrames(step,settings),quick=smoothSkeletonFrames(step,{...settings,responsiveness:80});
const arrival=rows=>rows.findIndex(f=>f.index>=30&&x(f)>.74)-30;
assert.ok(arrival(quick)<arrival(slow),'Fast response must reduce step lag');
const gap=[frame(0,.2),frame(1,.3),{...frame(2),primary:null},frame(3,.8)];
assert.equal(x(smoothSkeletonFrames(gap,settings)[3]),.8,'A gap must not carry a stale joint');
const hidden=[frame(0,.2),frame(1,.3),frame(2,.4),frame(3,.8)];hidden[2].poses[0][0][3]=.1;
const visibility=smoothSkeletonFrames(hidden,settings);assert.equal(visibility[2].poses[0][0][3],.1);assert.equal(x(visibility[3]),.8);
for(const change of [{cut:true},{track:2},{t:1},{t:0}]){
 const discontinuity=[frame(0,.2),{...frame(1,.8),...change}];
 assert.equal(x(smoothSkeletonFrames(discontinuity,settings)[1]),.8,'Boundaries must reset');
}
const cache=new SkeletonDisplayFilter();const a=cache.frames(input,settings,16/9);
assert.equal(cache.frames(input,settings,16/9),a,'Redraw must not advance filtering');
const b=cache.frames(step,settings,16/9);assert.equal(x(b[0]),.2,'New source must reset');
assert.deepEqual(smoothSkeletonFrames(input.slice(0,100),settings),smoothSkeletonFrames(input,settings).slice(0,100),'Future frames cannot affect earlier output');
console.log(JSON.stringify({passed:true,syntheticJitterReductionPercent:Math.round((1-ratio)*100),stepLagFrames:{fixed:arrival(slow),adaptive:arrival(quick)},checks:['raw immutable','raw bypass','gaps','joint visibility','cuts','track change','time discontinuity','frame-rate independent cache','source reset','causal prefix']}));
