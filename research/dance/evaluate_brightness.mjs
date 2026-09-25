/** Read-only source evaluation. Writes a NEW lightweight report only; no media copies.
 * Reserved sources require --reserved after candidate choices are frozen. */
import {readFileSync,writeFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {DanceAudio,HOP,RATE} from '../../public/dance-audio.mjs';
const temp=mkdtempSync('/private/tmp/lightflow-brightness-eval-'),modules={};
for(const name of ['movement-brightness','brightness-v0','music-context']){
 const source=readFileSync(`src/lib/pipeline/${name}.ts`,'utf8');
 writeFileSync(`${temp}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 modules[name]=await import(pathToFileURL(`${temp}/${name}.mjs`));
}
const manifest=JSON.parse(readFileSync('research/dance/brightness-study-manifest.json','utf8'));
const reserved=process.argv.includes('--reserved');
const rows=[],root='/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs';
const quantify=(frames,mode,gain)=>{
 let valid=0,saturated=0,mean=0,rises=0,previous=null,energy=0;
 for(let i=1;i<frames.length;i++){
  const dt=frames[i].t-frames[i-1].t,value=frames[i][mode];
  if(dt<=0||dt>.15||value===null){previous=null;continue;}
  const v=Math.max(0,Math.min(1,value*gain));valid+=dt;mean+=v*dt;energy+=v*v*dt;if(v>=.98)saturated+=dt;
  if(previous!==null&&v-previous>=.15)rises++;previous=v;
 }
 return {validSeconds:+valid.toFixed(3),mean:+(mean/Math.max(.001,valid)).toFixed(4),rms:+Math.sqrt(energy/Math.max(.001,valid)).toFixed(4),saturationFraction:+(saturated/Math.max(.001,valid)).toFixed(4),frameRisesAtLeast015:rises};
};
for(const passage of manifest.passages.filter(p=>reserved?p.split==='reserved':p.split!=='reserved')){
 const directory=`${root}/${passage.runId}`,frameDirectory=`${directory}/frames`;
 const poses=readdirSync(frameDirectory).filter(f=>f.endsWith('.json')).sort().flatMap(f=>JSON.parse(readFileSync(`${frameDirectory}/${f}`,'utf8')));
 const probe=spawnSync('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',`${directory}/preview.mp4`],{encoding:'utf8'});
 if(probe.status!==0)throw Error(probe.stderr);
 const stream=JSON.parse(probe.stdout).streams[0],aspect=stream.width/stream.height;
 const audio=spawnSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',`${directory}/audio.m4a`,'-f','f32le','-ac','2','-ar',String(RATE),'pipe:1'],{maxBuffer:64*1024*1024});
 if(audio.status!==0)throw Error(audio.stderr.toString());
 const pcm=new DataView(audio.stdout.buffer,audio.stdout.byteOffset,audio.stdout.byteLength),engines=[new DanceAudio(),new DanceAudio()],evidence=[];
 for(let start=0;start+HOP<=audio.stdout.byteLength/8;start+=HOP){
  const feature=engines.map((engine,ch)=>engine.step(Float32Array.from({length:HOP},(_,i)=>pcm.getFloat32((start+i)*8+ch*4,true))));
  evidence.push({t:feature[0].t,rms:Math.sqrt((feature[0].rms**2+feature[1].rms**2)/2),flux:(feature[0].features[9]+feature[1].features[9])/2});
 }
 const music=modules['music-context'].analyzeMusic(evidence);
 const cache=new modules['movement-brightness'].MovementBrightnessCache(),defaults=cache.defaults(poses,aspect);
 const baseline=modules['brightness-v0'].movementBrightness(poses,aspect,160),variants=[];
 for(const mode of ['motion','arms','legs','snap','open']){
  const settings=modules['music-context'].musicBrightnessDefault(defaults[mode],mode,music);
  const original=quantify(baseline,mode,1.3),candidateFrames=cache.frames(poses,aspect,settings.fade),candidate=quantify(candidateFrames,mode,settings.gain);
  // Equal mean is a diagnostic, never the sole promotion criterion.
  let low=0,high=8;for(let i=0;i<24;i++){const mid=(low+high)/2;if(quantify(candidateFrames,mode,mid).mean<original.mean)low=mid;else high=mid;}
  variants.push({mode,V0:{gain:1.3,fade:160,...original},V1:{gain:settings.gain,fade:settings.fade,policy:settings.reason,...candidate},V1MeanMatched:{gain:+high.toFixed(4),...quantify(candidateFrames,mode,high)}});
 }
 rows.push({runId:passage.runId,sourceId:passage.sourceId,title:passage.title,split:passage.split,music,variants});
 console.log(JSON.stringify({title:passage.title,bpm:music.bpm,texture:music.texture,motion:variants[0],snap:variants[3]}));
}
const stamp=new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const file=`research/dance/brightness-evaluation-${reserved?'reserved':'development'}-${stamp}.json`;
writeFileSync(file,JSON.stringify({createdAt:new Date().toISOString(),stage:'V1 engineering diagnostics only; no alignment or artistic-quality claim',baselineHash:createHash('sha256').update(readFileSync('src/lib/pipeline/brightness-v0.ts')).digest('hex'),definitions:{saturated:'display level >= 0.98, time-weighted on valid samples',frameRise:'increase >=0.15 in one source frame; not an independently verified beat',meanMatch:'candidate gain adjusted to V0 mean; diagnostic, not production setting'},rows},null,2)+'\n',{flag:'wx'});
console.log(file);
