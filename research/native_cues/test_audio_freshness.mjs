import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
import * as core from '../../public/scope-core.mjs';import * as cue from '../../public/cue-runtime.mjs';
const source=fs.readFileSync('src/lib/scope/audio.ts','utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
const sandbox={exports:{},require:name=>name.includes('scope-core')?core:cue};vm.runInNewContext(js,sandbox);const {ScopeAudio}=sandbox.exports;
function setup({at=10,received=1000,graph=10,audible=10,state='running',file=false}={}){const e=new ScopeAudio();e.context={currentTime:graph,state,getOutputTimestamp:()=>({contextTime:audible,performanceTime:1000}),close:()=>Promise.resolve()};e.isFile=file;e.latest={at,received};return e;}
assert(setup().frame(1000));assert(setup({at:9.8}).frame(1000));
assert.equal(setup({at:9.7,received:1000}).frame(1000),undefined);
assert.equal(setup().frame(1251),undefined);
assert.equal(setup({state:'suspended'}).frame(1000),undefined);
assert.equal(setup({state:'closed'}).frame(1000),undefined);
assert.equal(setup().frame(999),undefined);assert.equal(setup().frame(NaN),undefined);
assert(setup({at:9.6,graph:10,audible:9.6,file:true}).frame(1000));
assert.equal(setup({at:9.3,graph:10,audible:9.6,file:true}).frame(1000),undefined);
// A long output buffer is legitimate when the selected frame is audible now.
assert(setup({at:9.6,received:600,graph:10,audible:9.6,file:true}).frame(1000));
assert.equal(setup({at:9.3,received:600,graph:10,audible:9.6,file:true}).frame(1000),undefined);
assert.equal(setup({at:9.6,received:200,graph:10,audible:9.6,file:true}).frame(1000),undefined);
assert.equal(setup({at:10,received:600,graph:10,audible:10,file:false}).frame(1000),undefined);
const q=setup();q.latest=undefined;q.queue=[{at:9.5,received:1000},{at:10,received:1000},{at:10.02,received:1000}];assert.equal(q.frame(1000).at,10);assert.equal(q.queue.length,1);
q.stop();assert.equal(q.frame(1000),undefined);
console.log('PASS fresh external/file audio, delayed delivery, graph freeze, suspended/closed context, invalid clock, queued future frames, stop');
