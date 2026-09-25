import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
const stats=values=>{const a=values.filter(Number.isFinite).sort((a,b)=>a-b);return {count:a.length,min:a[0],median:a[Math.floor(a.length*.5)],p95:a[Math.min(a.length-1,Math.floor(a.length*.95))],max:a.at(-1)};};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio','--autoplay-policy=no-user-gesture-required']});
const report={version:'jev-live-v2',realMusicPlayback:true,musicalQualityMeasured:false,physicalLatencyMeasured:false,trials:[],errors:[],responses:[]};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',async r=>{if(new URL(r.url()).pathname==='/api/jev'){const b=await r.json().catch(()=>({}));report.responses.push({status:r.status(),roundTripMs:b.roundTripMs,error:b.error});}});
  await page.goto('http://localhost:3001/scope/jev');
  for(const song of process.argv[2]?[process.argv[2]]:['calabria_-_austin_marc.mp3','damn_right_-_audrey_nuna.mp3','mcdonalds.mp3']){
    await page.getByLabel('Choose music',{exact:true}).setInputFiles(new URL(`../../public/songs/${song}`,import.meta.url).pathname);
    await page.waitForFunction(()=>Number(document.querySelector('[aria-label="Live brightness output"]')?.getAttribute('data-level'))>.001,null,{timeout:15000});
    await page.evaluate(()=>{window.jevProbe=[];window.jevProbeTimer=setInterval(()=>window.jevProbe.push({level:Number(document.querySelector('[aria-label="Jev preview"]').dataset.level),mode:document.querySelector('.jev-decision h1').firstChild.textContent.trim()}),20);});
    await page.waitForTimeout(18000);
    const levels=[];for(let i=0;i<30;i++){levels.push(await page.evaluate(()=>({circle:Number(document.querySelector('[aria-label="Circle preview"]').dataset.level),jev:Number(document.querySelector('[aria-label="Jev preview"]').dataset.level)})));await page.waitForTimeout(50);}
    const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export decisions',exact:true}).click();
    const stream=await(await download).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
    const data=JSON.parse(Buffer.concat(chunks).toString()),decisions=data.decisions;
    const probe=await page.evaluate(()=>{clearInterval(window.jevProbeTimer);return window.jevProbe;});
    const activity=Object.fromEntries([...new Set(probe.map(x=>x.mode))].map(mode=>{const a=probe.filter(x=>x.mode===mode).map(x=>x.level);return [mode,{...stats(a),visibleFraction:a.filter(x=>x>.01).length/a.length}];}));
    assert(probe.some(x=>x.level>.05),'The live Jev output must illuminate during the excerpt');
    assert(decisions.length>10,'Actual repeated TypeSafe decisions must complete');
    assert.equal(data.version,'jev-live-v2');
    const applied=decisions.filter(x=>x.disposition==='accepted');
    const trial={song,decisions,brightnessActivity:activity,appliedPlans:[...new Set(applied.map(x=>Object.values(x.appliedPlan).join(':')))],
      appliedGestures:[...new Set(applied.map(x=>x.appliedPlan.gesture))],
      browserRoundTripMs:stats(decisions.map(x=>x.browserRoundTripMs)),controlCadenceMs:stats(decisions.slice(1).map((x,i)=>x.requestedAtMs-decisions[i].requestedAtMs)),
      signalAgeAtReplyMs:stats(decisions.map(x=>x.signalAgeAtReplyMs)),estimatedAudibleOffsetMs:stats(data.softwareTimingSamples.map(x=>x.estimatedAudibleOffsetMs)),
      maxBrightnessDifference:Math.max(...levels.map(x=>Math.abs(x.circle-x.jev))),dispositions:[...new Set(decisions.map(x=>x.disposition))]};
    report.trials.push(trial);console.log(JSON.stringify({...trial,decisions:decisions.length}));
    if(song==='mcdonalds.mp3')await page.screenshot({path:'/tmp/lightflow-jev-v2-active.png',fullPage:true});
    await page.getByRole('button',{name:'Stop',exact:true}).click();await page.waitForTimeout(500);
  }
  assert(report.responses.some(x=>x.status===200));assert(!report.responses.some(x=>x.status===429),'Normal request pacing must not trigger rate limits');
  await page.getByRole('button',{name:'Fullscreen ↗',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);
  const dims=await page.evaluate(()=>{const r=document.fullscreenElement.getBoundingClientRect();return [r.width,r.height,innerWidth,innerHeight];});assert.equal(dims[0],dims[2]);assert.equal(dims[1],dims[3]);
  await page.keyboard.press('a');assert.equal(await page.getByRole('button',{name:'A · Circle',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('b');assert.equal(await page.getByRole('button',{name:'B · Jev',exact:true}).getAttribute('aria-pressed'),'true');
  await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('[aria-label="Live brightness output"]').dataset.level==='0.00000');
  await page.keyboard.press('Space');await page.evaluate(()=>document.exitFullscreen());
  assert.equal(await page.getByLabel('Live brightness output').getAttribute('data-level'),'0.00000');
  const count=report.responses.length;await page.waitForTimeout(2000);assert.equal(report.responses.length,count);
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/lightflow-jev-v2-mobile.png',fullPage:true});
  assert.equal(report.errors.length,0);
  report.checks=['three real excerpts with live API','decision and software timing export','fullscreen fits viewport','A/B keyboard controls','blackout','stop halts requests','mobile fits viewport','no browser exceptions'];
  const path=new URL(`./live-browser-${Date.now()}.json`,import.meta.url);await fs.writeFile(path,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({report:path.pathname,checks:report.checks,responses:report.responses.length,errors:report.responses.filter(x=>x.status!==200)}));
}finally{await browser.close();}
