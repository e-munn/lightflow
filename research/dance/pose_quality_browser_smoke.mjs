import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/pipeline/pose-quality');
 await page.getByRole('button',{name:'Play music',exact:true}).waitFor();
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play music')?.disabled);
 // Warm-cache navigation can deliver loadeddata before the loading effect.
 await page.reload();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play music')?.disabled&&!!document.querySelector('video'));
 await page.getByRole('button',{name:'Play music',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video').currentTime>.5);await page.getByRole('button',{name:'Pause',exact:true}).click();
 const seek=async t=>{await page.getByLabel('Seek comparison').fill(String(t));await page.waitForFunction(t=>!document.querySelector('video').seeking&&Array.from(document.querySelectorAll('canvas')).every(c=>Math.abs(+c.dataset.poseTime-t)<.1),t);};
 await seek(6);const t=await page.locator('video').evaluate(v=>v.currentTime);
 for(const name of ['1 · Original Full','2 · RTMW','3 · Both']){await page.getByRole('button',{name,exact:true}).click();assert.equal(await page.locator('video').evaluate(v=>v.currentTime),t);}
 const times=await page.locator('canvas').evaluateAll(c=>c.map(e=>e.dataset.poseTime));assert.equal(times[0],times[1]);
 await page.getByRole('button',{name:'Next frame',exact:true}).click();await page.waitForFunction(t=>!document.querySelector('video').seeking&&document.querySelector('video').currentTime>t,t);
 await page.getByLabel('Source video', {exact:true}).uncheck();assert.equal(await page.locator('video').evaluate(v=>getComputedStyle(v).opacity),'0');await page.getByLabel('Source video',{exact:true}).check();
 await seek(12);
 const candidate=page.getByLabel('RTMW skeleton',{exact:true});
 assert.ok(Number(await candidate.getAttribute('data-hand-points'))>0);
 await page.getByLabel('Hand detail',{exact:true}).uncheck();assert.equal(await candidate.getAttribute('data-hand-points'),'0');
 await page.getByLabel('Hand detail',{exact:true}).check();assert.ok(Number(await candidate.getAttribute('data-hand-points'))>0);
 // An ambiguous detection stays blank; no carrying forward an old pose.
 await seek(6.006);assert.equal(await candidate.getAttribute('data-tracked'),'false');assert.equal(await candidate.getAttribute('data-hand-points'),'0');
 assert.equal(await page.getByLabel('Original Full skeleton',{exact:true}).getAttribute('data-tracked'),'true');
 await seek(12);await page.getByRole('button',{name:'2 · RTMW',exact:true}).click();
 await page.screenshot({path:'/private/tmp/lightflow-pose-quality-desktop.png'});
 const choose=async label=>{await page.getByLabel('Dance passage').selectOption({label});await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Play music')?.disabled);await seek(12);};
 // Same source with a different model must also reload successfully.
 await choose('Crave You · Heavy');assert.ok((await page.locator('video').getAttribute('src')).includes('3946f65e'));
 await page.getByRole('button',{name:'2 · Heavy',exact:true}).waitFor();
 await choose('Crave You · RTMW');
 for(const label of ['Beat Killer · RTMW','Feel the Way I Feel · RTMW']){await choose(label);assert.equal(await candidate.getAttribute('data-tracked'),'true');}
 await choose('Beat Killer · RTMW');
 await page.getByRole('button',{name:'Fullscreen comparison',exact:true}).click();assert.ok(await page.evaluate(()=>document.fullscreenElement));await page.getByRole('button',{name:'Fullscreen comparison',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'/private/tmp/lightflow-pose-quality-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['original audio playback','matched timestamps','model switching without clock reset','frame stepping','source video toggle','native hand detail toggle','ambiguous pose remains blank','same-passage model reload','all RTMW passages','fullscreen','mobile fit','no browser errors']}));
}finally{await browser.close();}
