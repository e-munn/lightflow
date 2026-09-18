import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2];await fs.mkdir(out,{recursive:false});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
const report={checks:[],errors:[],physicalInput:false};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:3001/scope');
 await page.evaluate(()=>{
  window.__captureContexts=[];window.__captureTracks=[];window.__synthMode='mono';
  async function synthetic(){
   const c=new AudioContext({sampleRate:48000});await c.resume();window.__captureContexts.push(c);
   const buffer=c.createBuffer(window.__synthMode==='mono'?1:2,48000*8,48000);
   for(let ch=0;ch<buffer.numberOfChannels;ch++){
    const a=buffer.getChannelData(ch);for(let i=0;i<a.length;i++){
     const t=i/48000,env=t%1<.5?.22:.015;
     a[i]=env*Math.sin(2*Math.PI*200*t+ch*Math.PI/2);
    }
   }
   const s=c.createBufferSource();s.buffer=buffer;s.loop=true;
   const destination=c.createMediaStreamDestination();destination.channelCount=buffer.numberOfChannels;
   s.connect(destination);s.start();window.__captureTracks.push(...destination.stream.getTracks());
   return destination.stream;
  }
  navigator.mediaDevices.getUserMedia=synthetic;
  navigator.mediaDevices.getDisplayMedia=synthetic;
 });
 const exportTrace=async(name)=>{
  const p=page.waitForEvent('download');await page.getByRole('button',{name:'Export recent timing'}).click();const d=await p;await d.saveAs(out+'/'+name+'.json');return JSON.parse(await fs.readFile(out+'/'+name+'.json','utf8'));
 };
 for(const kind of ['mono','stereo']){
  await page.evaluate(kind=>{window.__synthMode=kind;},kind);
  await page.getByRole('button',{name:kind==='mono'?'Microphone':'System / tab audio',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Audio stays on this device'),null,{timeout:20000});
  await page.waitForTimeout(4200);const trace=await exportTrace(kind);
  const frames=trace.frames.slice(50);assert(frames.length>70);
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const spread=mean(frames.map(f=>f.features[1]));
  if(kind==='mono')assert(spread<.001);else assert(spread>.9);
  const level=frames.map(f=>f.features[0]);assert(Math.max(...level)-Math.min(...level)>.4);
  assert(frames.every(f=>f.estimatedAudibleOffsetMs===null));
  const ages=frames.map(f=>f.sampleToGraphMs).sort((a,b)=>a-b);
  report[kind]={frames:frames.length,meanSpread:spread,amplitudeRange:[Math.min(...level),Math.max(...level)],softwareAgeP50:ages[Math.floor(ages.length*.5)],softwareAgeP95:ages[Math.floor(ages.length*.95)]};
  report.checks.push(kind+' non-silent input, waveform geometry, dynamic amplitude, correct timing labels');
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  assert(await page.evaluate(()=>window.__captureTracks.every(t=>t.readyState==='ended')));
 }
 // Stop while an asynchronous capture request is pending, then grant it.
 await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.__grant=resolve;});});
 await page.getByRole('button',{name:'Microphone',exact:true}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();
 await page.evaluate(()=>{const c=new AudioContext();window.__captureContexts.push(c);const d=c.createMediaStreamDestination();window.__lateTrack=d.stream.getAudioTracks()[0];window.__grant(d.stream);});
 await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__lateTrack.readyState),'ended');report.checks.push('late permission grant after stop cleans up track');
 await page.evaluate(async()=>{await Promise.all(window.__captureContexts.map(c=>c.close()));});
 assert.deepEqual(report.errors,[]);
}finally{await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2),{flag:'wx'});await browser.close();console.log(JSON.stringify(report,null,2));}
