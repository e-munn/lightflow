import ts from 'typescript';import fs from 'node:fs';import vm from 'node:vm';
function module(file){const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);return context.exports;}
const {PhrasePlayer}=module('src/lib/director/phrases.ts');const {Score}=module('src/lib/director/score.ts');
const library=JSON.parse(fs.readFileSync('public/models/phrases.json','utf8'));const reports=[];
const stats=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return {std:Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length),range:Math.max(...values)-Math.min(...values)};};
for(const slug of ['damn_right_-_audrey_nuna','calabria_-_austin_marc','mcdonalds']){
 const trace=JSON.parse(fs.readFileSync(`scripts/director/artifacts/${slug}-trace.json`,'utf8'));const player=new PhrasePlayer(library);const phraseScore=new Score(),descriptorScore=new Score();const brightness=[],baseline=[],frames=[];let maxJump=0,changes=0,lastScene=1;
 for(let frame=4;frame<trace.values.length/8*30;frame++){
  const time=frame/30,index=Math.min(trace.values.length-1,Math.max(0,Math.floor(time*8)-1));
  const selected=player.update(time,trace.logits[index]);const map=([value,activity,entropy,hx,hy,coverage])=>[value,Math.min(1,.15+activity*3),entropy,(Math.atan2(hy-.5,hx-.5)/(2*Math.PI)+1)%1,coverage];
  const p=phraseScore.update(time,trace.levels[index],null,map(selected));const b=descriptorScore.update(time,trace.levels[index],null,map(trace.values[index]));
  if(time>12){if(brightness.length)maxJump=Math.max(maxJump,Math.abs(p.brightness-brightness.at(-1)));brightness.push(p.brightness);baseline.push(b.brightness);if(p.scene!==lastScene)changes++;lastScene=p.scene;}
  frames.push({...p,time,phrase:player.phrase});
 }
 reports.push({track:slug,phraseBrightness:stats(brightness),descriptorBrightness:stats(baseline),maxFrameJump:maxJump,sceneChanges:changes});
 fs.writeFileSync(`scripts/director/artifacts/${slug}-phrase-performance.json`,JSON.stringify(frames));
}
fs.writeFileSync('scripts/director/artifacts/phrase-output-evaluation.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2));
