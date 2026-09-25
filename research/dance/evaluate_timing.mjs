import {readFileSync,writeFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {DanceAudio,HOP,RATE} from '../../public/dance-audio.mjs';
const temp=mkdtempSync('/private/tmp/lightflow-timing-eval-'),modules={};
for(const name of ['movement-brightness','brightness-v0','music-context','brightness-timing']){
 const source=readFileSync(`src/lib/pipeline/${name}.ts`,'utf8');
 writeFileSync(`${temp}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 modules[name]=await import(pathToFileURL(`${temp}/${name}.mjs`));
}
const {applyBrightnessFade,movementBrightness,deriveBrightnessDefaults}=modules['movement-brightness'];
const {audioTiming,timingStudy}=modules['brightness-timing'];
const manifest=JSON.parse(readFileSync('research/dance/brightness-study-manifest.json','utf8'));
const reserved=process.argv.includes('--reserved'),root='/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs';
const passages=[];
for(const passage of manifest.passages.filter(p=>reserved?p.split==='reserved':p.split!=='reserved')){
 const dir=`${root}/${passage.runId}`,frameDir=`${dir}/frames`;
 const poses=readdirSync(frameDir).filter(f=>f.endsWith('.json')).sort().flatMap(f=>JSON.parse(readFileSync(`${frameDir}/${f}`,'utf8')));
 const probe=spawnSync('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',`${dir}/preview.mp4`],{encoding:'utf8'});
 if(probe.status!==0)throw Error(probe.stderr);
 const stream=JSON.parse(probe.stdout).streams[0],aspect=stream.width/stream.height;
 const result=spawnSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',`${dir}/audio.m4a`,'-f','f32le','-ac','2','-ar',String(RATE),'pipe:1'],{maxBuffer:64*1024*1024});if(result.status!==0)throw Error(result.stderr.toString());
 const pcm=new DataView(result.stdout.buffer,result.stdout.byteOffset,result.stdout.byteLength),engines=[new DanceAudio(),new DanceAudio()],evidence=[];
 for(let start=0;start+HOP<=result.stdout.byteLength/8;start+=HOP){
  const f=engines.map((e,ch)=>e.step(Float32Array.from({length:HOP},(_,i)=>pcm.getFloat32((start+i)*8+ch*4,true))));
  evidence.push({t:f[0].t,rms:Math.sqrt((f[0].rms**2+f[1].rms**2)/2),flux:(f[0].features[9]+f[1].features[9])/2});
 }
 const music=modules['music-context'].analyzeMusic(evidence),timing=audioTiming(evidence,music),raw=movementBrightness(poses,aspect,0);
 const setting=modules['music-context'].musicBrightnessDefault(deriveBrightnessDefaults(raw).snap,'snap',music);
 passages.push({passage,raw,timing,music,setting});
}
const q=(values,p)=>{const a=values.slice().sort((x,y)=>x-y);return a[Math.floor((a.length-1)*p)]??null;};
const rows=[];
for(let index=0;index<passages.length;index++){
 const {passage,raw,timing,music,setting}=passages[index],end=raw.at(-1).t;
 const study=timingStudy(raw,timing),wrongSource=passages[(index+1)%passages.length];
 const wrong=timingStudy(raw,wrongSource.timing),shifted=timingStudy(raw,{...timing,accents:timing.accents.map(a=>({...a,t:a.t+.7,availableAt:a.availableAt+.7})).filter(a=>a.availableAt<end)});
 const interior=times=>times.filter(t=>t>=1&&t<=end-1);
 const alignment=events=>{
  const e=interior(events),distances=anchors=>anchors.length?e.map(t=>Math.min(...anchors.map(a=>Math.abs(a.t-t)))):[];
  const energy=distances(timing.energyAnchors),spectral=distances(timing.accents);
  const grid=timing.grid?e.map(t=>{const phase=(t-timing.grid.phase)/timing.grid.period;return Math.abs(phase-Math.round(phase))*timing.grid.period;}):[];
  const within=(a,tolerance)=>a.length?a.filter(v=>v<=tolerance).length/a.length:null;
  return {events:e.length,energyWithin120:within(energy,.12),medianEnergyDistanceMs:energy.length?Math.round(q(energy,.5)*1000):null,constructionWithin120:within(spectral,.12),gridWithin80:within(grid,.08)};
 };
 const levels=(frames,gain)=>{
  let total=0,sum=0,saturated=0,isolated=0;
  for(let i=1;i<frames.length-1;i++){
   const f=frames[i],dt=f.t-frames[i-1].t,v=f.snap;
   if(f.t<1||f.t>end-1||v===null||dt<=0||dt>.15)continue;
   const value=Math.min(1,v*gain);total+=dt;sum+=value*dt;if(value>=.98)saturated+=dt;
   if(value>.2&&frames[i-1].snap!==null&&frames[i+1].snap!==null&&frames[i-1].snap*gain<.05&&frames[i+1].snap*gain<.05)isolated++;
  }
  return {validSeconds:+total.toFixed(3),mean:+(sum/Math.max(.001,total)).toFixed(4),saturation:+(saturated/Math.max(.001,total)).toFixed(4),oneFramePulses:isolated};
 };
 const v1=applyBrightnessFade(raw,setting.fade),target=levels(v1,setting.gain).mean;
 const variants={};
 for(const [name,input] of Object.entries({V1:raw,V2:study.v2,V3:study.v3,AudioOnly:study.audio,RMS:study.rms,V0:raw})){
  const frames=applyBrightnessFade(input,name==='V0'?160:setting.fade),gain=name==='V0'?1.3:setting.gain;
  let lo=0,hi=8;for(let n=0;n<20;n++){const mid=(lo+hi)/2;if(levels(frames,mid).mean<target)lo=mid;else hi=mid;}
  const eventTimes=input.filter(f=>f.snap!==null&&f.snap>0).map(f=>f.t);
  variants[name]={gain,fade:name==='V0'?160:setting.fade,...levels(frames,gain),alignment:name==='RMS'?null:alignment(eventTimes),meanMatchedToV1:{gain:+hi.toFixed(4),...levels(frames,hi)}};
 }
 const count=interior(study.original).length;
 const controls={original:count,realAccepted:interior(study.accepted).length,shiftedAccepted:interior(shifted.accepted).length,wrongAccepted:interior(wrong.accepted).length,wrongSourceId:wrongSource.passage.sourceId};
 const retention=count?controls.realAccepted/count:null;
 rows.push({runId:passage.runId,title:passage.title,split:passage.split,music:{...music,timing:undefined},anchors:{spectral:timing.accents.length,energy:timing.energyAnchors.length,grid:timing.grid},retention,controls,variants});
 console.log(JSON.stringify({title:passage.title,retention,controls,V1:variants.V1.alignment,V2:variants.V2.alignment,V3mean:variants.V3.mean}));
}
const report={createdAt:new Date().toISOString(),stage:'V2 support / V3 amplitude-only study',protocol:'research/dance/V2_PROTOCOL.md',caveats:['Energy anchors and phase grids are algorithmic, not beat ground truth.','V3 uses V2 event times by construction; identical timing is not validation of expression.','No human perceptual judgment is available.'],hashes:Object.fromEntries(['movement-brightness','brightness-v0','music-context','brightness-timing'].map(n=>[n,createHash('sha256').update(readFileSync(`src/lib/pipeline/${n}.ts`)).digest('hex')])),rows};
const file=`research/dance/timing-evaluation-${reserved?'reserved':'development'}-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}.json`;
writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(file);
