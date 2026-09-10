import ts from 'typescript';import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const source=fs.readFileSync('src/lib/director/phrases.ts','utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const context={exports:{}};vm.runInNewContext(js,context);const {PhrasePlayer}=context.exports;
const library=JSON.parse(fs.readFileSync('public/models/phrases.json','utf8'));
const player=new PhrasePlayer(library);const logits=library.prior.map(x=>Math.log(Math.max(x,1e-8)));let previous;let maxJump=0,span=Array(7).fill(0),min=Array(7).fill(1),max=Array(7).fill(0);
for(let i=0;i<60*30;i++){const values=player.update(i/30,logits);assert(values.every(v=>Number.isFinite(v)&&v>=0&&v<=1));if(previous)maxJump=Math.max(maxJump,...values.map((v,j)=>Math.abs(v-previous[j])));values.forEach((v,j)=>{min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);});previous=values;}
span=max.map((v,j)=>v-min[j]);assert(maxJump<.1,'Phrase transition jumps');assert(span[0]>.02,'Learned phrases have no brightness expression');assert.equal(player.update(61,[NaN]),undefined);
const report={maxFrameJump:maxJump,controlRanges:span};fs.writeFileSync('scripts/director/artifacts/phrase-player-test.json',JSON.stringify(report,null,2));console.log(report);
