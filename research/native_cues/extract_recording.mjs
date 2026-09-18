import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {ScopeFeatures,FEATURE_NAMES} from '../../public/scope-core.mjs';
import {MusicFeatures,MUSIC_FEATURE_NAMES} from '../../public/music-features.mjs';
import {RecordingDSP} from './recording-dsp.mjs';
const [source,destination,startText,durationText,profile]=process.argv.slice(2);
if(!source||!destination||!durationText)throw Error('Usage: source output.csv start duration');
const start=Number(startText),duration=Number(durationText);
if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0)throw Error('Invalid interval');
const output=fs.createWriteStream(destination,{flags:'wx'});
output.write(['seconds',...FEATURE_NAMES,...MUSIC_FEATURE_NAMES].join(',')+'\n');
const sr=48000,dsp=new RecordingDSP(profile,sr),scope=new ScopeFeatures(sr),music=new MusicFeatures(sr),bytes=scope.window*8;
const decoder=spawn('ffmpeg',['-v','error','-ss',String(start),'-i',source,'-t',String(duration),'-vn','-ac','2','-ar',String(sr),'-f','f32le','pipe:1'],{stdio:['ignore','pipe','inherit']});
let pending=Buffer.alloc(0),frame=0;
for await(const chunk of decoder.stdout){
 const data=Buffer.concat([pending,chunk]);let offset=0;
 for(;offset+bytes<=data.length;offset+=bytes){
  const l=new Float32Array(scope.window),r=new Float32Array(scope.window);
  for(let i=0;i<scope.window;i++){l[i]=data.readFloatLE(offset+i*8);r[i]=data.readFloatLE(offset+i*8+4);}
  const [dl,dr]=dsp.frame(l,r);
  const values=[...scope.frame(dl,dr).values,...music.frame(dl,dr)];frame++;
  const line=[(start+frame/50).toFixed(5),...values.map(v=>v.toFixed(7))].join(',')+'\n';
  if(!output.write(line))await new Promise(resolve=>output.once('drain',resolve));
 }
 pending=Buffer.from(data.subarray(offset));
}
const code=await new Promise(resolve=>decoder.exitCode===null?decoder.on('close',resolve):resolve(decoder.exitCode));
if(code!==0)throw Error('Audio decode failed '+code);
await new Promise(resolve=>output.end(resolve));
console.log(JSON.stringify({source,start,duration,frames:frame,features:FEATURE_NAMES.length+MUSIC_FEATURE_NAMES.length}));
