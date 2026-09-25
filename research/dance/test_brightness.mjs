import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const temp=mkdtempSync('/private/tmp/lightflow-brightness-');
writeFileSync(temp+'/brightness.mjs',ts.transpileModule(readFileSync('src/lib/pipeline/movement-brightness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {movementBrightness,brightnessAt,MovementBrightnessCache,BRIGHTNESS_MODES}=await import(pathToFileURL(temp+'/brightness.mjs'));
const frames=Array.from({length:540},(_,i)=>{
 const t=i/60,p=Array.from({length:33},()=>[.5,.4,0,1]);
 for(const [j,x,y] of [[11,.44,.3],[12,.56,.3],[13,.36,.38],[14,.64,.38],[15,.32,.47],[16,.68,.47],[23,.46,.5],[24,.54,.5],[25,.44,.67],[26,.56,.67],[27,.44,.85],[28,.56,.85]])p[j]=[x,y,0,1];
 if(t>=1&&t<2)for(const j of [13,14,15,16])p[j][0]+=.06*Math.sin(2*Math.PI*3*(t-1));
 if(t>=4&&t<5)for(const j of [25,26,27,28])p[j][0]+=.06*Math.sin(2*Math.PI*3*(t-4));
 if(t>=6)for(const j of [15,16,27,28])p[j][0]+=(j%2?-1:1)*.1*Math.min(1,(t-6)/1.5);
 return {t,index:i,poses:[p],primary:0,track:1,state:'tracked',cut:false,speed:null};
});
const original=JSON.stringify(frames),output=movementBrightness(frames,16/9);
const max=(mode,a,b)=>Math.max(...output.filter(f=>f.t>=a&&f.t<b).map(f=>f[mode]??0));
assert.equal(JSON.stringify(frames),original,'Source poses must remain unchanged');
assert.ok(max('arms',1,2)>.8&&max('legs',1,2)<.001,'Arms must be independent of legs');
assert.ok(max('legs',4,5)>.8&&max('arms',4,5)<.001,'Legs must be independent of arms');
assert.ok(max('snap',1,1.5)>.3,'Starts must produce a snap');
assert.ok(max('stops',2,2.6)>.3,'A confirmed slowdown must produce a stop accent');
assert.ok(max('hold',2.3,3.5)>.8,'A held pose after motion must light up');
assert.equal(max('hold',0,1),0,'Startup stillness must not invent a hold');
assert.ok(max('open',7.6,9)>.5,'Extended pose must produce an open light');
for(const f of output)for(const mode of BRIGHTNESS_MODES.filter(m=>m.id!=='off'))assert.ok(f[mode.id]===null||(f[mode.id]>=0&&f[mode.id]<=1));
const shifted=structuredClone(frames);for(const f of shifted)for(const p of f.poses[0]){p[0]+=.02*Math.sin(f.t*3);p[1]+=.02*Math.cos(f.t*3);}
const translated=movementBrightness(shifted,16/9);
assert.ok(output.every((f,i)=>Math.abs((f.motion??0)-(translated[i].motion??0))<1e-10),'Camera translation should cancel');
const dropout=structuredClone(frames);dropout[165].primary=null;
const masked=movementBrightness(dropout,16/9);assert.equal(masked[165].hold,null);assert.equal(masked[166].hold,null);assert.equal(masked[170].hold,0,'No hold may cross a missing pose');
const missingArm=structuredClone(frames);for(let i=240;i<300;i++)for(const j of [13,14,15,16])missingArm[i].poses[0][j][3]=0;
const partial=movementBrightness(missingArm,16/9);assert.equal(partial[270].arms,null);assert.ok(partial[270].legs>.2);assert.equal(partial[270].stops,null,'Visibility loss cannot become an arrival');
for(const change of [{cut:true},{track:2},{t:10},{t:0}]){
 const altered=structuredClone(frames.slice(0,170));Object.assign(altered[165],change);
 const at=movementBrightness(altered,16/9)[165];assert.equal(at.hold,null);assert.equal(at.snap,null);
}
assert.equal(brightnessAt(output,1.2,'off',3).value,0);
assert.equal(brightnessAt(output,null,'arms',3).value,0);
assert.equal(brightnessAt(output,20,'hold',3).available,false,'Never reuse stale signals');
assert.equal(brightnessAt(output,1.2,'arms',3).value,1,'Sensitivity clamps at white');
const cache=new MovementBrightnessCache(),cached=cache.frames(frames,16/9,160);
assert.equal(cache.frames(frames,16/9,160),cached);assert.notEqual(cache.frames(frames,16/9,400),cached);
assert.ok(movementBrightness(frames,16/9,600)[145].arms>movementBrightness(frames,16/9,40)[145].arms,'Fade changes release duration');
console.log(JSON.stringify({passed:true,checks:['separate limbs','snap','stop','hold after movement','no initial hold','expansion','bounded outputs','immutable data','camera translation','missing pose','independent confidence','boundary reset','seek lookup','sensitivity','fade','cache']}));

// Read-only diagnostics on real passages; missing drive does not fail unit tests.
const root='/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs';
for(const id of ['86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6','89dab10c-317e-4ea4-aa70-beb1b86d0438','35ad6ce5-109d-4431-bf59-7c8936482124']){
 const dir=`${root}/${id}/frames`;if(!existsSync(dir))continue;
 const raw=readdirSync(dir).filter(n=>n.endsWith('.json')).sort().flatMap(n=>JSON.parse(readFileSync(`${dir}/${n}`,'utf8')));
 const result=movementBrightness(raw,16/9),stats={};
 for(const {id:mode} of BRIGHTNESS_MODES.filter(m=>m.id!=='off')){
  const values=result.map(f=>f[mode]).filter(v=>v!==null);
  stats[mode]={coverage:+(values.length/result.length).toFixed(2),mean:+(values.reduce((s,v)=>s+v,0)/values.length).toFixed(2),peak:+Math.max(...values).toFixed(2),brightFrames:values.filter(v=>v>.65).length};
 }
 console.log(JSON.stringify({run:id,stats}));
}
