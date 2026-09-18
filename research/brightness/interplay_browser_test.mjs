import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {RECIPES,InterplayBank} from '../../public/scope-interplay.mjs';
const out=process.argv[2];if(!out)throw Error('Fresh external directory required');await fs.mkdir(out);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report={automated:true,musicalQualityMeasured:false,physicalLatencyMeasured:false,errors:[],checks:[]};
try {
 const page=await browser.newPage({viewport:{width:1440,height:1060}});
 page.on('pageerror',e=>report.errors.push(e.message));
 await page.goto('http://localhost:3001/scope/interplay');
 const bank=page.getByRole('region',{name:'Eleven switching recipes'});
 assert.equal(await bank.getByRole('button').count(),11);
 await page.getByRole('button',{name:'Forest',exact:true}).click();
 await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Live brightness output"]')?.getAttribute('data-level'))>.01,null,{timeout:20000});
 await page.waitForTimeout(14000);
 await fs.writeFile(out+'/desktop.png',await page.screenshot({fullPage:true}),{flag:'wx'});
 // Export a complete, unchanged-settings prefix before the 30 second review buffer rolls.
 await page.getByRole('button',{name:'Keep this moment',exact:true}).click();
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();
 const download=await event,stream=await download.createReadStream(),chunks=[];
 for await(const chunk of stream)chunks.push(chunk);
 const bytes=Buffer.concat(chunks),data=JSON.parse(bytes.toString());
 await fs.writeFile(out+'/automated-interplays.json',bytes,{flag:'wx'});
 assert(data.automated);assert.equal(data.trainedModel,false);assert.equal(data.choices.length,1);assert(data.frames.length>200);
 const replay=new InterplayBank();let maxError=0;
 for(const frame of data.frames){
  assert.equal(frame.values.length,11);assert(frame.values.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  const result=replay.frame(frame,{valid:true,values:frame.styleValues,metrics:frame.metrics},data.settings);
  result.values.forEach((v,i)=>maxError=Math.max(maxError,Math.abs(v-frame.values[i])));
  assert.deepEqual(result.routes.map(r=>r.mode),frame.routes.map(r=>r.mode));
 }
 assert(maxError<1e-9,`Replay error ${maxError}`);report.replayMaximumError=maxError;
 report.frames=data.frames.length;report.routes=RECIPES.map((r,i)=>({recipe:r.id,modes:[...new Set(data.frames.map(f=>f.routes[i]?.mode).filter(Boolean))],transitions:data.frames.at(-1).routes[i].transitions,min:Math.min(...data.frames.map(f=>f.values[i])),max:Math.max(...data.frames.map(f=>f.values[i]))}));
 assert(report.routes.some(r=>r.transitions>0));
 const cost=data.frames.map(f=>f.computeMs).sort((a,b)=>a-b);report.mainThreadComputeP95Ms=cost[Math.floor(cost.length*.95)];
 for(const [i,recipe] of RECIPES.entries()){
  await bank.getByRole('button',{name:`${i+1}. ${recipe.name}`,exact:true}).click();
  assert.equal(await page.getByRole('heading',{level:1}).textContent(),recipe.name);
  assert.equal(await page.getByRole('region',{name:'Selected variation controls'}).getByRole('slider').count(),2);
 }
 await page.getByRole('button',{name:'Fullscreen ↗',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
 report.fullscreen=await page.evaluate(()=>{const e=document.fullscreenElement,r=e.getBoundingClientRect(),o=e.querySelector('.signal-output').getBoundingClientRect();return{width:r.width,height:r.height,outputWidth:o.width,outputHeight:o.height,viewport:[innerWidth,innerHeight],captionHidden:getComputedStyle(e.querySelector('.signal-stage-name')).display==='none'};});
 assert.equal(report.fullscreen.width,report.fullscreen.viewport[0]);assert.equal(report.fullscreen.height,report.fullscreen.viewport[1]);assert.equal(report.fullscreen.outputWidth,report.fullscreen.width);assert.equal(report.fullscreen.outputHeight,report.fullscreen.height);assert(report.fullscreen.captionHidden);
 await page.keyboard.press('ArrowRight');await page.waitForTimeout(100);assert.equal(await bank.getByRole('button',{name:'1. Your interplay',exact:true}).getAttribute('aria-pressed'),'true');
 await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('[aria-label="Live brightness output"]')?.getAttribute('data-level')==='0.00000');await page.keyboard.press('Space');await page.evaluate(()=>document.exitFullscreen());
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(100);
 assert(await page.evaluate(()=>[...document.querySelectorAll('.signal-mini'),document.querySelector('.signal-output')].every(e=>getComputedStyle(e).backgroundColor==='rgb(0, 0, 0)')));
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await fs.writeFile(out+'/mobile.png',await page.screenshot({fullPage:true}),{flag:'wx'});
 assert.equal(report.errors.length,0);
 report.checks=['eleven independently selectable recipes with two controls each','real Forest audio routes live','bounded outputs','exact causal replay from exported signal and style outputs','fullscreen fills viewport','fullscreen keyboard wraps eleven recipes and blackouts','source-linked choice export','stop blackout','mobile overflow','no browser exceptions'];
 await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));
}finally{await browser.close();}
