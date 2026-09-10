import ts from 'typescript';import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const context={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/director/gestures.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
const {GestureTransport}=context.exports;const transport=new GestureTransport();
const cue={id:'authored-1',at:1,duration:4,scene:1,action:'bloom',direction:0,strength:.8,color:.5,provenance:'authored',reason:'Open on the new phrase'};
transport.play(cue);assert.equal(transport.sample(0).progress,0);assert.equal(transport.sample(3).progress,.5);assert.equal(transport.sample(6).progress,1);
transport.play({...cue,id:'hold',at:6,action:'hold'});const before=transport.sample(6).motionTime;for(let t=6;t<10;t+=1/60)assert.equal(transport.sample(t).motionTime,before);
assert.throws(()=>transport.play({...cue,duration:0}));console.log('Cue timing and intentional holds pass.');
