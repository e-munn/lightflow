import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {ScopeFeatures} from '../../public/scope-core.mjs';
import {MusicFeatures} from '../../public/music-features.mjs';
import {AttitudeBank,defaultAttitudeSettings} from '../../public/scope-attitudes.mjs';
const out=process.argv[2];if(!out)throw Error('Fresh external output directory required');fs.mkdirSync(out);
const source='/Volumes/ExtremePro/Movies/Assets/lightflow_research/audio/9-16-26/of_the_trees_electric_forest_-eVk7dh8dO4.m4a';
const start=1882,duration=32,prefix=4,rate=48000,window=960;
// Quantize the preceding and listening interval identically to the delivered WAV.
const decode=spawnSync('ffmpeg',['-v','error','-ss',String(start-prefix),'-i',source,'-t',String(duration+prefix),'-vn','-ar',String(rate),'-ac','2','-f','s16le','pipe:1'],{maxBuffer:50e6});if(decode.status!==0)throw Error(decode.stderr.toString());
const excerptPcm=decode.stdout.subarray(prefix*rate*4),saved=spawnSync('ffmpeg',['-v','error','-f','s16le','-ar',String(rate),'-ac','2','-i','pipe:0','-c:a','pcm_s16le','-n',path.join(out,'forest_31m22.wav')],{input:excerptPcm});if(saved.status!==0)throw Error(saved.stderr.toString());
const roundtrip=spawnSync('ffmpeg',['-v','error','-i',path.join(out,'forest_31m22.wav'),'-f','s16le','pipe:1'],{maxBuffer:20e6});if(roundtrip.status!==0||!roundtrip.stdout.equals(excerptPcm))throw Error('Rendered audio must exactly match the analyzed samples');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:3001/scope-brightness.mjs');
 await page.evaluate(async()=>{const {ScopeBrightness}=await import('/scope-brightness.mjs'),{RadialThreshold}=await import('/scope-threshold.mjs');window.canvas=document.createElement('canvas');window.projector=new ScopeBrightness(window.canvas);window.projector.soft=true;window.radial=new RadialThreshold();window.radial.configure({radius:.33,below:'soft',above:'expand',ratio:3.3,adaptive:false,attackMs:0,releaseMs:0,makeup:1});});
 const features=new ScopeFeatures(rate),music=new MusicFeatures(rate),bank=new AttitudeBank(),settings=defaultAttitudeSettings(),frames=[];let batch=[];
 async function flush(){if(!batch.length)return;const projected=await page.evaluate(rows=>rows.map(row=>{window.projector.frame(row.left,row.right);const x=window.radial.frame(window.canvas.getContext('2d').getImageData(0,0,256,256).data,row.at);return{brightness:x.brightness,coverage:x.coverage,q60:x.q60,outsideFraction:x.outsideFraction};}),batch);
  batch.forEach((row,i)=>{const f={at:row.at,...row.feature,music:row.music},styles=bank.frame(f,projected[i].brightness,settings);if(row.at>prefix)frames.push({time:Number((row.at-prefix).toFixed(5)),...f,styleValues:styles.values,metrics:styles.metrics,scope:projected[i]});});batch=[];
 }
 for(let offset=0,index=0;offset+window*4<=decode.stdout.length;offset+=window*4,index++){
  const left=new Float32Array(window),right=new Float32Array(window);for(let i=0;i<window;i++){left[i]=decode.stdout.readInt16LE(offset+i*4)/32768;right[i]=decode.stdout.readInt16LE(offset+i*4+2)/32768;}
  batch.push({at:(index+1)/50,left:Array.from(left),right:Array.from(right),feature:features.frame(left,right),music:music.frame(left,right)});if(batch.length>=80)await flush();
 }await flush();
 const audio=fs.readFileSync(path.join(out,'forest_31m22.wav'));
 const record={version:'scope-phrase-data-v1',name:'Of The Trees · Electric Forest',source:{path:source,startSeconds:start,durationSeconds:duration,excerptFile:'forest_31m22.wav',excerptSha256:createHash('sha256').update(audio).digest('hex'),pcmMatchesAnalysis:true},fps:50,analysisPrefixSeconds:prefix,provisionalImpactSeconds:15.66,impactProvenance:'Estimated from low-frequency arrival; not a human drop annotation',preferredCircle:settings.circle,unobservedCircleDefaults:{attackMs:0,releaseMs:0,makeup:1},styleSettings:settings,trainedModel:false,frames};
 fs.writeFileSync(path.join(out,'data.json'),JSON.stringify(record),{flag:'wx'});fs.writeFileSync(path.join(out,'prepare-source.mjs'),fs.readFileSync(new URL(import.meta.url)),{flag:'wx'});
 console.log(JSON.stringify({directory:out,frames:frames.length,duration,impact:record.provisionalImpactSeconds,excerptSha256:record.source.excerptSha256,means:Array.from({length:10},(_,i)=>frames.reduce((s,f)=>s+f.styleValues[i],0)/frames.length)}));
}finally{await browser.close();}
