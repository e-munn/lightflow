import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2];if(!out)throw Error('Provide a new external evidence directory');await fs.mkdir(out,{recursive:false});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const report={checks:[],errors:[],physicalInput:false,physicalLatencyMeasured:false};
const quantile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:3001/scope/modulation');
 const response=await page.request.get('http://127.0.0.1:3001/api/scope-research/cue-model');assert.equal(response.status(),200);assert.equal((await response.json()).experimental,true);
 const exportTrace=async name=>{
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export recent timing'}).click();const download=await event;await download.saveAs(out+'/'+name+'.json');return JSON.parse(await fs.readFile(out+'/'+name+'.json','utf8'));
 };
 const counts=()=>page.locator('canvas').evaluateAll(cs=>cs.map(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0;for(let i=0;i<p.length;i+=4)sum+=p[i]+p[i+1]+p[i+2];return sum;}));
 const inspect=(trace,requireReady)=>{
  assert(trace.frames.length>50);assert.equal(trace.physicalTimingMeasured,false);
  for(const f of trace.frames){
   assert(f.outputs?.length===4);assert(f.outputs.every(a=>a.length===8&&a.every(Number.isFinite)));
   if(f.predictionAt!==null){assert(f.predictionReadyAt<=f.at+1e-8);assert(f.predictionAt+.02<=f.at+1e-8);}
  }
  const active=trace.frames.filter(f=>f.cueReady);
  if(requireReady){assert(active.length>40);assert(active.some(f=>Math.abs(f.outputs[0][0]-f.outputs[1][0])>1e-5));}
  const timing={};
  for(const name of ['computeMs','sampleToGraphMs','receivedToDrawMs','estimatedAudibleOffsetMs']){
   const a=trace.frames.map(f=>f[name]).filter(Number.isFinite);if(a.length)timing[name]={p50:quantile(a,.5),p95:quantile(a,.95),max:Math.max(...a)};
  }
  return {frames:trace.frames.length,learnedReadyFrames:active.length,delayedReadyFrames:trace.frames.filter(f=>f.delayedReady).length,timing};
 };
 await page.locator('input[type=file]').setInputFiles('public/songs/calabria_-_austin_marc.mp3');
 await page.waitForFunction(()=>document.querySelector('[data-testid=cue-telemetry]')?.textContent.includes('Delayed ready'),null,{timeout:65000});
 await page.waitForTimeout(1000);
 const file=await exportTrace('file');report.file=inspect(file,true);assert(report.file.delayedReadyFrames>10);
 assert.equal((await counts()).length,5);assert((await counts()).every(v=>v>10000));
 report.file.telemetry=await page.getByTestId('cue-telemetry').textContent();assert(report.file.telemetry.includes('Queue overflow 0'));
 await page.screenshot({path:out+'/file-playing.png',fullPage:true});report.checks.push('file playback, trained model and delayed control ready; five views render');
 console.log('PASS file comparison');
 await page.getByRole('button',{name:'Blackout',exact:true}).click();await page.waitForTimeout(100);assert((await counts()).slice(1).every(v=>v===0));
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(100);assert((await counts()).slice(1).every(v=>v===0));report.checks.push('blackout and stop clear all light outputs');

 await page.evaluate(()=>{
  window.__captureContexts=[];window.__captureTracks=[];window.__synthMode='mono';
  async function synthetic(){
   const c=new AudioContext({sampleRate:48000});await c.resume();window.__captureContexts.push(c);
   const buffer=c.createBuffer(window.__synthMode==='mono'?1:2,48000*8,48000);
   for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const a=buffer.getChannelData(ch);for(let i=0;i<a.length;i++){const t=i/48000,env=t%1<.5?.22:.015;a[i]=env*Math.sin(2*Math.PI*200*t+ch*Math.PI/2);}
   }
   const s=c.createBufferSource();s.buffer=buffer;s.loop=true;const d=c.createMediaStreamDestination();d.channelCount=buffer.numberOfChannels;
   s.connect(d);s.start();window.__captureTracks.push(...d.stream.getTracks());return d.stream;
  }
  navigator.mediaDevices.getUserMedia=synthetic;navigator.mediaDevices.getDisplayMedia=synthetic;
 });
 await page.getByRole('button',{name:'Microphone',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-testid=cue-telemetry]')?.textContent.includes('Model ready'),null,{timeout:40000});
 await page.waitForTimeout(1500);const mic=await exportTrace('synthetic-mic');report.microphone=inspect(mic,true);
 assert(mic.frames.every(f=>f.estimatedAudibleOffsetMs===null));assert(mic.frames.slice(50).every(f=>f.features[1]<.001));
 assert(Math.max(...mic.frames.map(f=>f.features[0]))-Math.min(...mic.frames.map(f=>f.features[0]))>.4);
 report.checks.push('synthetic non-silent microphone reaches trained inference; mono stays narrow; external timing not mislabeled as audible output');
 await page.getByRole('button',{name:'Stop',exact:true}).click();assert(await page.evaluate(()=>window.__captureTracks.every(t=>t.readyState==='ended')));
 console.log('PASS synthetic microphone');
 await page.evaluate(()=>{window.__synthMode='stereo';});await page.getByRole('button',{name:'System / tab audio',exact:true}).click();
 await page.waitForTimeout(4200);const system=await exportTrace('synthetic-system');report.system=inspect(system,false);
 assert(system.frames.slice(50).every(f=>f.features[1]>.9));assert(system.frames.every(f=>f.estimatedAudibleOffsetMs===null));
 await page.getByRole('button',{name:'Stop',exact:true}).click();assert(await page.evaluate(()=>window.__captureTracks.every(t=>t.readyState==='ended')));
 report.checks.push('synthetic stereo system audio and capture cleanup');
 await page.evaluate(()=>{const c=document.createElement('canvas'),s=c.captureStream();window.__displayTrack=s.getVideoTracks()[0];navigator.mediaDevices.getDisplayMedia=async()=>s;});
 await page.getByRole('button',{name:'System / tab audio',exact:true}).click();await page.getByRole('alert').filter({hasText:'No audio was shared'}).waitFor();assert.equal(await page.evaluate(()=>window.__displayTrack.readyState),'ended');report.checks.push('display without audio rejected and video track stopped');
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.__grant=resolve;});});
 await page.getByRole('button',{name:'Microphone',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.evaluate(()=>{const c=new AudioContext();window.__captureContexts.push(c);const d=c.createMediaStreamDestination();window.__lateTrack=d.stream.getAudioTracks()[0];window.__grant(d.stream);});
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__lateTrack.readyState),'ended');report.checks.push('late capture grant after stop cleaned up');
 await page.evaluate(async()=>{await Promise.all(window.__captureContexts.map(c=>c.close()));});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.checks.push('mobile no horizontal overflow');
 await page.goto('http://127.0.0.1:3001/scope');await page.locator('input[type=file]').setInputFiles('public/songs/calabria_-_austin_marc.mp3');
 await page.waitForFunction(()=>document.querySelector('.scope-comparison article:last-child p')?.textContent.includes('Learned 100 ms'),null,{timeout:20000});
 assert.equal(await page.locator('canvas').count(),3);await page.getByRole('button',{name:'Stop',exact:true}).click();report.checks.push('original scope still uses its separate existing model');
 assert.deepEqual(report.errors,[]);
}finally{
 await fs.writeFile(out+'/browser-test.json',JSON.stringify(report,null,2),{flag:'wx'});await browser.close();console.log(JSON.stringify(report,null,2));
}
