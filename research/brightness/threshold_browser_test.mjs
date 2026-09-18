import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const out=process.argv[2];if(!out)throw Error('Provide a fresh external report directory');await fs.mkdir(out);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report={automated:true,physicalLatencyMeasured:false,musicalQualityMeasured:false,checks:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1150}});page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://localhost:3001/scope/threshold');
 report.synthetic=await page.evaluate(async()=>{
  const {ScopeBrightness}=await import('/scope-brightness.mjs'),{RadialThreshold}=await import('/scope-threshold.mjs');
  const canvas=document.createElement('canvas'),scope=new ScopeBrightness(canvas);scope.soft=true;
  const left=Array.from({length:960},(_,i)=>.42*Math.sin(2*Math.PI*113*i/48000)),right=Array.from({length:960},(_,i)=>.38*Math.sin(2*Math.PI*271*i/48000));
  const direct=scope.frame(left,right),pixels=canvas.getContext('2d').getImageData(0,0,256,256).data,results={};
  for(const [name,settings] of [['bypass',{below:'keep'}],['soft',{below:'soft'}],['cut',{below:'cut'}],['compress',{below:'keep',above:'compress'}],['expand',{below:'keep',above:'expand'}]]){const d=new RadialThreshold();d.configure(settings);results[name]=d.frame(pixels,0);}
  const d=new RadialThreshold(),cost=[];for(let i=0;i<150;i++){const start=performance.now();scope.frame(left,right);d.frame(canvas.getContext('2d').getImageData(0,0,256,256).data,i*.02);cost.push(performance.now()-start);}cost.sort((a,b)=>a-b);
  return {direct,results,projectionAndThresholdP95Ms:cost[Math.floor(cost.length*.95)]};
 });
 const r=report.synthetic.results;assert(Math.abs(r.bypass.brightness-report.synthetic.direct.brightness)<1e-10);
 assert(r.cut.brightness<r.soft.brightness&&r.soft.brightness<r.bypass.brightness);assert(r.compress.brightness<r.bypass.brightness&&r.expand.brightness>r.bypass.brightness);
 report.checks.push('existing raster unchanged by overlay; bypass equals original; all radial modes differ on identical audio');
 await page.getByRole('button',{name:'Play Electric Forest',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('[data-testid=original-value]')?.textContent)>.1,null,{timeout:20000});
 const observed=[];for(let i=0;i<20;i++){observed.push(await page.evaluate(()=>{const canvas=[...document.querySelectorAll('canvas')];return [canvas[1],canvas[2]].map(c=>c.getContext('2d').getImageData(0,0,1,1).data[0]);}));await page.waitForTimeout(100);}
 assert(observed.some(([a,b])=>Math.abs(a-b)>3));report.observed=observed;
 await fs.writeFile(out+'/desktop.png',await page.screenshot({fullPage:true}),{flag:'wx'});
 await page.getByLabel('Inside the circle').selectOption('keep');await page.waitForTimeout(400);
 assert(await page.evaluate(()=>{const c=[...document.querySelectorAll('canvas')];return c[1].getContext('2d').getImageData(0,0,1,1).data[0]===c[2].getContext('2d').getImageData(0,0,1,1).data[0];}));
 await page.getByLabel('Inside the circle').selectOption('soft');
 await page.getByRole('button',{name:'Match average brightness',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('Replay to compare.'),null,{timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Clearer detail'&&!b.disabled));
 await page.getByRole('button',{name:'Clearer detail',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export trial',exact:true}).click();const downloaded=await download;const stream=await downloaded.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks);await fs.writeFile(out+'/automated-trial.json',bytes,{flag:'wx'});
 const trial=JSON.parse(bytes.toString());assert(trial.automated);assert(!trial.modelEnabled);assert.equal(trial.marks.length,1);assert(trial.settings.makeup>1);assert(trial.marks[0].frames.length>=50);assert(trial.marks[0].source.url.endsWith('/forest'));assert(trial.marks[0].frames.every(f=>f.sourceSeconds>=1860));report.matchedGain=trial.settings.makeup;
 report.checks.push('real file playback shows different output; bypass identical; mean matching freezes a fixed gain; exported automated marks retain settings/source/time');
 await page.getByLabel('Let the circle follow recent scope size').check();await page.waitForTimeout(2000);report.adaptiveRadius=await page.getByTestId('circle-radius').textContent();assert.notEqual(report.adaptiveRadius,'35%');
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(100);
 assert(await page.evaluate(()=>[...document.querySelectorAll('canvas')].slice(1,3).every(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data).every((v,i)=>i%4===3||v===0))));
 assert(await page.getByRole('button',{name:'Clearer detail',exact:true}).isDisabled());report.checks.push('adaptive circle moves; stop clears both brightness fields and disables marking');
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await fs.writeFile(out+'/mobile.png',await page.screenshot({fullPage:true}),{flag:'wx'});
 assert.equal(report.errors.length,0);report.checks.push('mobile layout has no horizontal overflow; no browser exceptions');
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
}finally{await browser.close();}
