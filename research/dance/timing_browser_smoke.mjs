import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/pipeline/live?study=v2');
 await page.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='ready',null,{timeout:30000});
 await page.getByRole('button',{name:'Play music',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('video').currentTime>.8);await page.getByRole('button',{name:'Pause',exact:true}).click();
 assert.equal(await page.getByLabel('Study version').inputValue(),'v2');
 const values={};
 for(const comparison of ['candidate','snap','audio','rms']){
  await page.getByLabel('Timing comparison').selectOption(comparison);values[comparison]=[];
  for(const t of [1,2,3,4,5,6]){
   await page.getByLabel('Seek music and skeleton').fill(String(t));
   await page.waitForFunction(t=>!document.querySelector('video').seeking&&Math.abs(+document.querySelector('canvas').dataset.poseTime-t)<.1,t);
   values[comparison].push(+(await page.locator('.mv-light').getAttribute('data-brightness')));
  }
 }
 assert.notDeepEqual(values.candidate,values.rms);assert.notDeepEqual(values.candidate,values.audio);assert.notDeepEqual(values.candidate,values.snap);
 const timestamp=await page.locator('video').evaluate(v=>v.currentTime);
 await page.getByLabel('Study version').selectOption('v0');assert.equal(await page.locator('video').evaluate(v=>v.currentTime),timestamp,'Version switches retain the passage moment');
 await page.getByLabel('Study version').selectOption('v2');assert.equal(await page.getByLabel('Timing comparison').inputValue(),'candidate');
 await page.getByRole('button',{name:'Light on',exact:true}).click();assert.equal(await page.locator('.mv-light').getAttribute('data-brightness'),'0');
 await page.getByRole('button',{name:'Light off',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/private/tmp/lightflow-v2-mobile.png'});
 assert.deepEqual(errors,[]);
 const failed=await browser.newPage();await failed.route('**/*file=audio.m4a',r=>r.fulfill({status:503,body:'unavailable'}));
 await failed.goto('http://localhost:3001/pipeline/live?study=v2');
 await failed.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='unavailable');
 assert.ok((await failed.locator('.mv-auto-note').innerText()).includes('V2 needs audio'));
 assert.equal(await failed.locator('.mv-light').getAttribute('data-brightness'),'0');
 console.log(JSON.stringify({passed:true,checks:['V2 deep link','four distinct controls','shared clock','version switching','blackout','mobile','audio failure explicit','no browser errors']}));
}finally{await browser.close();}
