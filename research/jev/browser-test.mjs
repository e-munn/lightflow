import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';

const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report={automated:true,realMusicPlayback:true,musicalQualityMeasured:false,physicalLatencyMeasured:false,decisions:[],errors:[],checks:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',async r=>{
    if(new URL(r.url()).pathname==='/api/jev'){
      const body=await r.json().catch(()=>({}));
      report.decisions.push({status:r.status(),choice:body.choice,confidence:body.confidence,roundTripMs:body.roundTripMs,error:body.error});
    }
  });
  await page.goto('http://localhost:3001/scope/jev');
  await page.getByRole('button',{name:'Demo',exact:true}).click();
  await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Live brightness output"]')?.getAttribute('data-level'))>.005,null,{timeout:20000});
  await page.waitForTimeout(26000);
  const levels=[];
  for(let i=0;i<60;i++){
    levels.push(await page.evaluate(()=>({circle:Number(document.querySelector('[aria-label="Circle preview"]').dataset.level),jev:Number(document.querySelector('[aria-label="Jev preview"]').dataset.level)})));
    await page.waitForTimeout(50);
  }
  assert(report.decisions.some(d=>d.status===200),'At least one real Jev decision must complete');
  assert(!report.decisions.some(d=>d.status===429),'Normal request pacing must not trigger the local rate limit');
  assert(!report.decisions.some(d=>d.error?.includes('API key')),'The server must load the configured key');
  report.maxDifference=Math.max(...levels.map(x=>Math.abs(x.circle-x.jev)));
  report.nonzeroCircle=levels.filter(x=>x.circle>0).length;
  report.nonzeroJev=levels.filter(x=>x.jev>0).length;
  assert(report.nonzeroCircle>0&&report.nonzeroJev>0);
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export decisions',exact:true}).click();
  const d=await download,stream=await d.createReadStream(),chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const exported=JSON.parse(Buffer.concat(chunks).toString());
  report.appliedModes=[...new Set(exported.decisions.map(x=>x.appliedMode))];
  report.dispositions=[...new Set(exported.decisions.map(x=>x.disposition))];
  report.browserLatencies=exported.decisions.map(x=>x.browserRoundTripMs);
  assert(exported.decisions.length>2);
  await page.getByRole('button',{name:'Fullscreen ↗',exact:true}).click();
  await page.waitForFunction(()=>!!document.fullscreenElement);
  report.fullscreen=await page.evaluate(()=>{const r=document.fullscreenElement.getBoundingClientRect();return {width:r.width,height:r.height,viewport:[innerWidth,innerHeight]};});
  assert.equal(report.fullscreen.width,report.fullscreen.viewport[0]);assert.equal(report.fullscreen.height,report.fullscreen.viewport[1]);
  await page.keyboard.press('a');assert.equal(await page.getByRole('button',{name:'A · Circle',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('b');assert.equal(await page.getByRole('button',{name:'B · Jev',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('[aria-label="Live brightness output"]').dataset.level==='0.00000');
  await page.keyboard.press('Space');await page.evaluate(()=>document.exitFullscreen());
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  await page.waitForTimeout(100);
  assert.equal(await page.getByLabel('Live brightness output').getAttribute('data-level'),'0.00000');
  const count=report.decisions.length;await page.waitForTimeout(2300);assert.equal(report.decisions.length,count,'Stop must stop API requests');
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'/tmp/lightflow-jev-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1050});await page.screenshot({path:'/tmp/lightflow-jev-desktop.png',fullPage:true});
  assert.equal(report.errors.length,0);
  report.checks=['real audio playback and live TypeSafe decisions','source-linked decision export','full viewport display','A/B keyboard switching','blackout','stop cancels capture and API activity','mobile overflow','no browser exceptions'];
  const path=new URL(`./browser-${Date.now()}.json`,import.meta.url);await fs.writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({report:path.pathname,...report},null,2));
}finally{await browser.close();}
