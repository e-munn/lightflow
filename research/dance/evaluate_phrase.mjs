import {readFileSync,writeFileSync,mkdtempSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {DanceAudio,HOP,RATE} from '../../public/dance-audio.mjs';
const temp=mkdtempSync('/private/tmp/lightflow-phrase-eval-'),modules={};
const names=['brightness-v0','movement-brightness','music-context','brightness-timing','brightness-phrase'];
for(const name of names){
 const source=readFileSync(`src/lib/pipeline/${name}.ts`,'utf8');
 writeFileSync(`${temp}/${name}.mjs`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
 modules[name]=await import(pathToFileURL(`${temp}/${name}.mjs`));
}
const reserved=process.argv.includes('--reserved'),manifest=JSON.parse(readFileSync('research/dance/brightness-study-manifest.json','utf8'));
const lockFile='research/dance/phrase-v3-lock.json';
const hashes=Object.fromEntries(names.map(n=>[n,createHash('sha256').update(readFileSync(`src/lib/pipeline/${n}.ts`)).digest('hex')]));
if(reserved){const lock=JSON.parse(readFileSync(lockFile,'utf8'));for(const n of names)if(hashes[n]!==lock.hashes[n])throw Error(`Frozen candidate changed: ${n}`);}
const root='/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs',passages=[];
for(const passage of manifest.passages.filter(p=>reserved?p.split==='reserved':p.split!=='reserved')){
 const dir=`${root}/${passage.runId}`,frameDir=`${dir}/frames`;
 const poses=readdirSync(frameDir).filter(n=>n.endsWith('.json')).sort().flatMap(n=>JSON.parse(readFileSync(`${frameDir}/${n}`,'utf8')));
 const probe=spawnSync('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',`${dir}/preview.mp4`],{encoding:'utf8'});
 if(probe.status!==0)throw Error(probe.stderr);const stream=JSON.parse(probe.stdout).streams[0];
 const result=spawnSync('/opt/homebrew/bin/ffmpeg',['-v','error','-i',`${dir}/audio.m4a`,'-f','f32le','-ac','2','-ar',String(RATE),'pipe:1'],{maxBuffer:64*1024*1024});
 if(result.status!==0)throw Error(result.stderr.toString());
 const pcm=new DataView(result.stdout.buffer,result.stdout.byteOffset,result.stdout.byteLength),engines=[new DanceAudio(),new DanceAudio()],evidence=[];
 for(let start=0;start+HOP<=result.stdout.byteLength/8;start+=HOP){
  const f=engines.map((e,ch)=>e.step(Float32Array.from({length:HOP},(_,i)=>pcm.getFloat32((start+i)*8+ch*4,true))));
  evidence.push({t:f[0].t,rms:Math.sqrt((f[0].rms**2+f[1].rms**2)/2),flux:(f[0].features[9]+f[1].features[9])/2});
 }
 const music=modules['music-context'].analyzeMusic(evidence),timing=modules['brightness-timing'].audioTiming(evidence,music);
 const raw=modules['brightness-v0'].movementBrightness(poses,stream.width/stream.height,0);
 passages.push({passage,music,timing,raw});
}
const quantile=(values,p)=>{const v=values.slice().sort((a,b)=>a-b);return v[Math.floor((v.length-1)*p)]??null;};
const pearson=(x,y)=>{
 if(x.length<4)return null;const mx=x.reduce((a,b)=>a+b)/x.length,my=y.reduce((a,b)=>a+b)/y.length;
 let cov=0,sx=0,sy=0;for(let i=0;i<x.length;i++){cov+=(x[i]-mx)*(y[i]-my);sx+=(x[i]-mx)**2;sy+=(y[i]-my)**2;}
 return sx*sy>1e-12?cov/Math.sqrt(sx*sy):null;
};
const stats=(frames,gain)=>{
 let valid=0,mean=0,saturated=0,oneFrame=0;
 for(let i=1;i<frames.length-1;i++){
  const f=frames[i],dt=f.t-frames[i-1].t;if(f.open===null||dt<=0||dt>.15||f.reset)continue;
  const v=Math.min(1,f.open*gain);valid+=dt;mean+=v*dt;if(v>=.98)saturated+=dt;
  if(v>.2&&frames[i-1].open!==null&&frames[i+1].open!==null&&frames[i-1].open*gain<.05&&frames[i+1].open*gain<.05)oneFrame++;
 }
 return {validSeconds:+valid.toFixed(3),mean:+(mean/Math.max(.001,valid)).toFixed(4),saturationFraction:+(saturated/Math.max(.001,valid)).toFixed(4),oneFramePulses:oneFrame};
};
const rows=[];
for(const item of passages){
 const {passage,music,timing,raw}=item,group=passages.filter(p=>p.passage.split===passage.split);
 const other=group.length>1?group[(group.indexOf(item)+1)%group.length]:null;
 const study=modules['brightness-phrase'].phraseStudy(raw,timing,music.bpm,other?.raw??[]);
 const base=modules['brightness-phrase'].phraseBaseDefault(study),setting=modules['music-context'].musicBrightnessDefault(base,'open',music);
 const candidate=modules['movement-brightness'].applyBrightnessFade(study.candidate,setting.fade),constant=modules['movement-brightness'].applyBrightnessFade(study.constant,setting.fade),wrong=modules['movement-brightness'].applyBrightnessFade(study.wrong,setting.fade);
 const match=modules['brightness-phrase'].matchBrightness(candidate,constant,setting.gain),wrongMatch=modules['brightness-phrase'].matchBrightness(candidate,wrong,setting.gain);
 const visible=study.events.filter(e=>e.amplitude!==null),shared=visible.filter(e=>e.wrongAmplitude!==null);
 const eventRms=e=>timing.frames[Math.min(timing.frames.length-1,Math.max(0,Math.floor(e.t/.02)-1))]?.rms??0;
 const amplitudes=visible.map(e=>e.amplitude),delays=visible.map(e=>1000*(e.t-e.availableAt));
 const energyDistances=visible.map(e=>timing.energyAnchors.length?Math.min(...timing.energyAnchors.map(a=>Math.abs(a.t-e.t))):Infinity);
 const rowsResult={runId:passage.runId,title:passage.title,split:passage.split,bpm:music.bpm,texture:music.texture,broadAccents:timing.accents.length,strongAccents:study.selected.length,visibleEvents:visible.length,droppedForTracking:study.events.length-visible.length,refractoryMs:Math.round(study.refractory*1000),settings:{gain:setting.gain,fade:setting.fade},amplitude:{p10:quantile(amplitudes,.1),p50:quantile(amplitudes,.5),p90:quantile(amplitudes,.9),successiveMeanChange:amplitudes.length>1?amplitudes.slice(1).reduce((s,v,i)=>s+Math.abs(v-amplitudes[i]),0)/(amplitudes.length-1):null},latency:{confirmationMs:20,displayQuantizationMedianMs:quantile(delays,.5),displayQuantizationMaxMs:Math.max(0,...delays)},energyAnchorProximity:{toleranceMs:120,fraction:visible.length?energyDistances.filter(d=>d<=.12).length/visible.length:null,caveat:'Diagnostic only: RMS anchors are dense and not annotated beats; both variants share timing.'},candidate:stats(candidate,setting.gain),constant:{native:stats(constant,setting.gain),matching:match,matched:stats(constant,match.gain)},wrongMovement:{sourceId:other?.passage.sourceId??null,sharedEvents:shared.length,coverage:visible.length?shared.length/visible.length:0,actualAmplitudeVsAudioRms:pearson(shared.map(e=>e.amplitude),shared.map(eventRms)),wrongAmplitudeVsAudioRms:pearson(shared.map(e=>e.wrongAmplitude),shared.map(eventRms)),matching:wrongMatch,matched:stats(wrong,wrongMatch.gain)}};
 rows.push(rowsResult);console.log(JSON.stringify({title:passage.title,accents:[timing.accents.length,study.selected.length,visible.length],gain:setting.gain,fade:setting.fade,amplitude:rowsResult.amplitude,candidate:rowsResult.candidate,meanMatched:match.matched,wrongCoverage:rowsResult.wrongMovement.coverage}));
}
const file=`research/dance/phrase-evaluation-${reserved?'reserved':'development'}-${new Date().toISOString().replaceAll(':','-').replaceAll('.','-')}.json`;
writeFileSync(file,JSON.stringify({createdAt:new Date().toISOString(),protocol:'research/dance/V3_PROTOCOL.md',hashes,stage:reserved?'Frozen candidate: reserved-source evaluation, do not tune from these results':'Development diagnostics before freezing V3',caveats:['No human perceptual approval.','Timing shared by candidate and constant ablation is not evidence for Open.','No manually annotated beat or source-offset ground truth.','Wrong movement correlating with audio level more/less is not a taste metric.'],rows},null,2)+'\n',{flag:'wx'});
console.log(file);
