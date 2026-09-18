import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import fs from 'node:fs';
const dest=process.argv[2];if(!dest)throw Error('Specify fresh report file');
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://localhost:3001/scope/brightness');
 const core=await page.evaluate(async()=>{
  const {ScopeBrightness}=await import('/scope-brightness.mjs');const p=new ScopeBrightness(document.createElement('canvas'));
  const left=Array.from({length:960},(_,i)=>.3*Math.sin(2*Math.PI*i*73/48000));const right=Array.from({length:960},(_,i)=>.3*Math.sin(2*Math.PI*i*173/48000));
  const first=p.frame(left,right),swap=p.frame(right,left),silent=p.frame(Array(960).fill(0)),invalid=p.frame([Infinity],[0]);const a=p.frame(left,right);p.frame(left.map(v=>v*2),right);const b=p.frame(left,right);
  const costs=[];for(let i=0;i<100;i++){const at=performance.now();p.frame(left,right);costs.push(performance.now()-at);}costs.sort((a,b)=>a-b);
  return {first,swap,silent,invalid,historyIndependent:a.brightness===b.brightness,computeP95Ms:costs[94]};
 });
 assert.equal(core.silent.brightness,0);assert.equal(core.invalid.valid,false);assert.equal(core.invalid.brightness,0);assert(core.historyIndependent);assert(Math.abs(core.first.brightness-core.swap.brightness)<.01);
 await page.getByRole('button',{name:'Play Electric Forest'}).click();await page.waitForTimeout(6000);
 const observed=[];for(let i=0;i<15;i++){observed.push(await page.getByLabel('Scope-derived brightness').evaluate(c=>c.getContext('2d').getImageData(0,0,1,1).data[0]));await page.waitForTimeout(100);}
 assert(Math.max(...observed)>Math.min(...observed)+10);
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(100);
 const stopped=await page.getByLabel('Scope-derived brightness').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).every((v,i)=>i%4===3||v===0));assert(stopped);assert.equal(errors.length,0);
 fs.writeFileSync(dest,JSON.stringify({core,observed,stopped,errors,physicalLatencyMeasured:false,musicalQualityMeasured:false},null,2),{flag:'wx'});console.log({passed:true,computeP95Ms:core.computeP95Ms});
}finally{await browser.close()}
