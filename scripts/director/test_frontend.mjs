import {MelStream} from '../../public/director-dsp.js';
import fs from 'node:fs';
const read=p=>{const b=fs.readFileSync(p);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const mel=new MelStream(JSON.parse(fs.readFileSync('public/models/mel-bank.json','utf8')));const audio=read('scripts/director/artifacts/frontend-audio.f32');let result;
for(let i=0;i<audio.length;i+=512)mel.push(audio.subarray(i,i+512),x=>result=x);
const expected=read('scripts/director/artifacts/frontend-expected.f32');let max=0,mean=0;for(let i=0;i<expected.length;i++){const err=Math.abs(result[i]-expected[i]);max=Math.max(max,err);mean+=err/expected.length;}
const report={frames:mel.frames,maxMelError:max,meanMelError:mean,pass:max<.0001};fs.writeFileSync('scripts/director/artifacts/frontend-parity.json',JSON.stringify(report,null,2));console.log(report);if(!report.pass)process.exitCode=1;
