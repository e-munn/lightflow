import fs from 'node:fs/promises';
import {requestJev} from '../../src/lib/jev/client.mjs';
import {describeSnapshot} from '../../public/jev-context.mjs';
import {fixture} from './fixtures.mjs';

if(!process.env.TYPESAFE_API_KEY)throw Error('Load TYPESAFE_API_KEY from the local environment before running.');
const trials=[];
for(const kind of ['smooth','texture','attacks','arrival','rise']){
  const snapshot=fixture(kind);
  const result=await requestJev(snapshot,{key:process.env.TYPESAFE_API_KEY,timeoutMs:5000});
  trials.push({kind,snapshot,observations:describeSnapshot(snapshot),result});
  console.log(JSON.stringify({synthetic:kind,choice:result.choice,confidence:result.confidence,roundTripMs:result.roundTripMs}));
}
const latencies=trials.map(t=>t.result.roundTripMs).sort((a,b)=>a-b);
const report={recordedAt:new Date().toISOString(),model:'jev-1.13.0',synthetic:true,musicalQualityMeasured:false,physicalLatencyMeasured:false,trials,
  latencyMs:{min:latencies[0],median:latencies[Math.floor(latencies.length/2)],max:latencies.at(-1)},
  totalInputTokens:trials.reduce((sum,t)=>sum+t.result.usage.input_tokens,0)};
const path=new URL(`./audit-${Date.now()}.json`,import.meta.url);
await fs.writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({report:path.pathname,latencyMs:report.latencyMs,totalInputTokens:report.totalInputTokens}));
