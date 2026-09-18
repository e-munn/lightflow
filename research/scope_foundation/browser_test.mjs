import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const out=process.argv[2];if(!out)throw Error('Provide new external evidence directory');await fs.mkdir(out,{recursive:false});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--autoplay-policy=no-user-gesture-required','--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const report={checks:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://127.0.0.1:3001/scope');
 await page.locator('input[type=file]').setInputFiles('public/songs/calabria_-_austin_marc.mp3');
 await page.waitForFunction(()=>document.querySelector('.scope-comparison article:last-child p')?.textContent.includes('Learned 100 ms'),null,{timeout:30000});
 await page.waitForTimeout(3000);
 report.fileTelemetry=await page.getByTestId('telemetry').textContent();
 assert(report.fileTelemetry.includes('2 channels'));report.checks.push('stereo local file and learned inference');
 const counts=()=>page.locator('canvas').evaluateAll(cs=>cs.map(c=>{const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let sum=0;for(let i=0;i<p.length;i+=4)sum+=p[i]+p[i+1]+p[i+2];return sum;}));
 const lit=await counts();assert(lit.every(n=>n>10000));report.checks.push('all three views render');
 await page.screenshot({path:out+'/playing.png'});
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export recent timing'}).click();const download=await downloadPromise;await download.saveAs(out+'/timing.json');
 const trace=JSON.parse(await fs.readFile(out+'/timing.json','utf8'));
 const quantile=(a,q)=>[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*q)];
 report.timing={frames:trace.frames.length,physicalMeasurement:false};
 for(const field of ['sampleToGraphMs','receivedToDrawMs','estimatedAudibleOffsetMs','computeMs']){const a=trace.frames.map(f=>f[field]).filter(Number.isFinite);report.timing[field]={p50:quantile(a,.5),p95:quantile(a,.95)};}
 await page.getByRole('button',{name:'Blackout',exact:true}).click();await page.waitForTimeout(100);assert((await counts()).slice(1).every(n=>n===0));report.checks.push('blackout outputs black');
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(100);assert((await counts()).slice(1).every(n=>n===0));report.checks.push('stop clears output');
 await page.getByRole('button',{name:'Microphone',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]')?.textContent.includes('Live microphone'),null,{timeout:20000});await page.waitForTimeout(3000);report.microphoneTelemetry=await page.getByTestId('telemetry').textContent();assert(report.microphoneTelemetry.includes('audio frames'));report.checks.push('simulated microphone worklet');await page.getByRole('button',{name:'Stop',exact:true}).click();
 // A selected display surface can legitimately contain no audio. Reject and stop its video track.
 await page.evaluate(()=>{const c=document.createElement('canvas');const s=c.captureStream();window.__displayTrack=s.getVideoTracks()[0];navigator.mediaDevices.getDisplayMedia=async()=>s;});
 await page.getByRole('button',{name:'System / tab audio'}).click();await page.getByRole('alert').filter({hasText:'No audio was shared'}).waitFor();assert.equal(await page.evaluate(()=>window.__displayTrack.readyState),'ended');report.checks.push('missing display audio rejects and stops capture');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:out+'/mobile.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);report.checks.push('mobile no overflow');
 // Range endpoint is required to seek full hour-long files without copying them locally.
 const range=await page.request.get('http://127.0.0.1:3001/api/scope-research/forest',{headers:{Range:'bytes=0-99'}});assert.equal(range.status(),206);assert.equal((await range.body()).length,100);report.checks.push('external audio byte ranges');
 assert.deepEqual(report.errors,[]);
}finally{await fs.writeFile(out+'/browser-test.json',JSON.stringify(report,null,2),{flag:'wx'});await browser.close();console.log(JSON.stringify(report,null,2));}
