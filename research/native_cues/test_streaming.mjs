import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {CueComparison,CueTCN,CuePolicy} from '../../public/cue-runtime.mjs';

const out=process.argv[2];if(!out)throw Error('Pass a prepared new parity directory');
const bundle=JSON.parse(fs.readFileSync(path.join(out,'bundle.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(out,'fixtures.json'),'utf8'));
const floats=name=>{const b=fs.readFileSync(path.join(out,name));return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const quantile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
const report={cases:{},checks:[],physicalLatencyMeasured:false};
let rawExample;
for(const c of fixture.cases){
 const rows=fs.readFileSync(c.raw_csv,'utf8').trim().split('\n').slice(1).map(s=>s.split(',').map(Number));
 rawExample=rows[0];assert.equal(rows.length,c.rows);
 const expectedX=floats(c.key+'_features.f32'),expectedP=floats(c.key+'_prediction.f32');
 const expectedOutput=c.output_fixture?floats(c.key+'_output.f32'):null;
 const runtime=new CueComparison(bundle),timing=[];let featureError=0,predictionError=0,outputError=0,tick=0;
 for(let i=0;i<rows.length;i++){
  const row=rows[i],begin=performance.now(),result=runtime.push(row[0],row.slice(1,9),row.slice(9));
  timing.push(performance.now()-begin);
  if(result.features){
   for(let j=0;j<81;j++)featureError=Math.max(featureError,Math.abs(result.features[j]-expectedX[tick*81+j]));
   for(let j=0;j<4;j++)predictionError=Math.max(predictionError,Math.abs(result.prediction[j]-expectedP[tick*4+j]));
   tick++;
  }
  if(expectedOutput)for(let m=0;m<4;m++)for(let j=0;j<8;j++)outputError=Math.max(outputError,Math.abs(result.output[m][j]-expectedOutput[(i*4+m)*8+j]));
  if(result.predictionAt!==null)assert(result.predictionReadyAt<=row[0]+1e-8);
  assert(result.output.every(v=>Array.from(v).every(Number.isFinite)));
 }
 assert.equal(tick,c.feature_rows);assert.equal(runtime.resets,0);
 assert(featureError<2e-5,`${c.key} features ${featureError}`);
 assert(predictionError<2e-5,`${c.key} prediction ${predictionError}`);
 assert(outputError<2e-5,`${c.key} output ${outputError}`);
 report.cases[c.key]={audioFrames:rows.length,predictions:tick,featureMaxError:featureError,predictionMaxError:predictionError,outputMaxError:expectedOutput?outputError:null,
  computeMs:{p50:quantile(timing,.5),p95:quantile(timing,.95),p99:quantile(timing,.99),max:Math.max(...timing)}};
 console.log('PASS',c.key,'features',featureError,'prediction',predictionError,'output',outputError);
}
report.checks.push('15 recorded clips match Python features and model; two full modulation traces match offline outputs');

const bad=structuredClone(bundle.model);bad.std[0]=0;assert.throws(()=>new CueTCN(bad));
report.checks.push('invalid normalization rejected');
const silence=new CuePolicy(bundle.prior);
for(let i=0;i<100;i++){
 const p=silence.push(i*.02,new Float32Array(8),[1,0,1,0]);assert.equal(p[0],0);assert.equal(p[2],0);assert(p[6]<=1.25);
}
report.checks.push('silence remains dark and mono remains narrow under extreme model output');

let clock=0;const slow=new CueComparison(bundle,()=>clock),values=rawExample.slice(1,9),music=rawExample.slice(9);
let learnedReady=false;
for(let i=1;i<=2200;i++){
 const at=i*.02;clock=at+.055;const r=slow.push(at,values,music);
 if(r.predictionAt!==null)assert(r.predictionReadyAt<=at+1e-8);
 learnedReady||=r.ready;
}
assert(learnedReady);
const reset=slow.push(45,values,music);assert.equal(reset.resets,1);assert.equal(reset.ready,false);
assert.equal(reset.output[1][6],1);
report.checks.push('modeled 55 ms computation never used early; source-clock gap resets context and learned gain');
fs.writeFileSync(path.join(out,'node_parity.json'),JSON.stringify(report,null,2),{flag:'wx'});
console.log('COMPLETE',out);
