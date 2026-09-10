import { chromium } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('scripts/director/artifacts',{recursive:true});
// A deterministic test device; never opens the real microphone.
const sampleRate=44100,sampleCount=sampleRate*20;
const wave=Buffer.alloc(44+sampleCount*2);
wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(sampleRate,24);wave.writeUInt32LE(sampleRate*2,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(sampleCount*2,40);
for(let i=0;i<sampleCount;i++){const t=i/sampleRate;const v=Math.sin(2*Math.PI*110*t)*(.2+.15*Math.sin(2*Math.PI*2*t))+Math.sin(2*Math.PI*440*t)*.1;wave.writeInt16LE(Math.round(v*32767),44+i*2);}
await fs.writeFile('scripts/director/artifacts/fake-mic.wav',wave);
const chromePath=process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined);
const browser=await chromium.launch({headless:true,executablePath:chromePath,args:['--autoplay-policy=no-user-gesture-required','--mute-audio','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${path.resolve('scripts/director/artifacts/fake-mic.wav')}`]});
try {
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
page.on('pageerror',e=>errors.push(e.message));
page.on('requestfailed',r=>console.log('REQUEST FAILED',r.url(),r.failure()));
page.on('console',m=>{if(m.type()==='error')console.log('BROWSER ERROR',m.text(),m.location());});page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text()+" "+JSON.stringify(msg.location()));});
await page.goto(process.env.DIRECTOR_URL||'http://localhost:3001/director');await page.getByRole('button',{name:'Animations',exact:true}).click();await page.waitForTimeout(1000);
await page.screenshot({path:'scripts/director/artifacts/studio.png'});
for(const name of ['ASCII Waves','AI Blob','Black Hole','Pixel Sculpt','Aurora','Silk','Particles','Light Tunnel','Liquid Metal','Prism']){await page.getByRole('button',{name:new RegExp(name+'$')}).click();await page.waitForTimeout(200);await page.locator('canvas').screenshot({style:'.stage-caption,.stage-state{visibility:hidden}',path:`scripts/director/artifacts/scene-${name.replaceAll(' ','-')}.png`});if(await page.locator('h1').textContent()!==name)throw Error('Scene failed '+name);}
await page.locator('input[type=file]').setInputFiles('public/songs/damn_right_-_audrey_nuna.mp3');
await page.waitForFunction(()=>document.querySelector('.engine-note')?.textContent?.includes('ms inference'),null,{timeout:60000});
await page.waitForTimeout(5000);const model=await page.locator('.engine-note').textContent();
await page.screenshot({path:'scripts/director/artifacts/studio-playing.png'});
await page.getByRole('button',{name:'Blackout',exact:true}).click();await page.waitForTimeout(100);await page.locator('canvas').screenshot({style:'.stage-caption,.stage-state{visibility:hidden}',path:'scripts/director/artifacts/blackout.png'});
await page.getByRole('button',{name:'Restore output'}).click();await page.getByRole('button',{name:'Stop',exact:true}).click();
await page.setViewportSize({width:390,height:844});await page.screenshot({path:'scripts/director/artifacts/mobile.png'});
await page.waitForFunction(()=>document.body.textContent.includes('Ready offline'),null,{timeout:60000});
await page.context().setOffline(true);await page.reload();await page.locator('input[type=file]').setInputFiles('public/songs/calabria_-_austin_marc.mp3');await page.waitForFunction(()=>document.querySelector('.engine-note')?.textContent?.includes('ms inference'),null,{timeout:60000});const offlineModel=await page.locator('.engine-note').textContent();
await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Listen to microphone',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.engine-note')?.textContent?.includes('ms inference'),null,{timeout:60000});const microphoneModel=await page.locator('.engine-note').textContent();
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
await fs.writeFile('scripts/director/artifacts/browser-smoke.json',JSON.stringify({model,offlineModel,microphoneModel,errors,overflow},null,2));
if(errors.length||overflow)throw Error(JSON.stringify({errors,overflow}));console.log(model);

} finally {await browser.close();}
