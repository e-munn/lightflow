import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {ScopeFeatures,FEATURE_NAMES,VERSION} from '../../public/scope-core.mjs';
const [source,destination]=process.argv.slice(2);
if(!source||!destination)throw Error('Usage: node extract.mjs source output.csv');
const output=fs.createWriteStream(destination,{flags:'wx'});
output.write(['seconds',...FEATURE_NAMES].join(',')+'\n');
const sr=48000,dsp=new ScopeFeatures(sr),bytes=dsp.window*2*4;
const decoder=spawn('ffmpeg',['-v','error','-i',source,'-vn','-ac','2','-ar',String(sr),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','inherit']});
let pending=Buffer.alloc(0),frame=0;
for await(const chunk of decoder.stdout){
  const data=Buffer.concat([pending,chunk]);let offset=0;
  for(;offset+bytes<=data.length;offset+=bytes){
    const l=new Float32Array(dsp.window),r=new Float32Array(dsp.window);
    for(let i=0;i<dsp.window;i++){l[i]=data.readFloatLE(offset+i*8);r[i]=data.readFloatLE(offset+i*8+4);}
    const f=dsp.frame(l,r);frame++;
    const line=[(frame*dsp.window/sr).toFixed(5),...f.values.map(v=>v.toFixed(7))].join(',')+'\n';
    if(!output.write(line))await new Promise(resolve=>output.once('drain',resolve));
  }
  pending=Buffer.from(data.subarray(offset));
}
const status=await new Promise(resolve=>decoder.exitCode===null?decoder.on('close',resolve):resolve(decoder.exitCode));
if(status!==0)throw Error('Decode failed '+status);
await new Promise(resolve=>output.end(resolve));
console.log(JSON.stringify({version:VERSION,source,destination,frames:frame,seconds:frame/50}));
