import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/pipeline/live?study=v3');
 await page.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='ready',null,{timeout:30000});
 await page.getByRole('button',{name:'Play music',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('video').currentTime>.8);await page.getByRole('button',{name:'Pause',exact:true}).click();
 assert.equal(await page.getByLabel('Study version').inputValue(),'v3');
 assert.equal(await page.getByLabel('Match average brightness').isChecked(),true);
 assert.equal(await page.locator('.mv-light').getAttribute('data-mode'),'open');
 const samples=[];
 for(const t of [1,2,3,4,5,6,7,8,9,10]){
  await page.getByLabel('Seek music and skeleton').fill(String(t));
  await page.waitForFunction(t=>!document.querySelector('video').seeking&&Math.abs(+document.querySelector('canvas').dataset.poseTime-t)<.1,t);
  const time=await page.locator('video').evaluate(v=>v.currentTime);
  await page.getByRole('button',{name:'Open expression',exact:true}).click();
  const candidate=+(await page.locator('.mv-light').getAttribute('data-brightness'));
  await page.getByRole('button',{name:'Constant accents',exact:true}).click();
  const constant=+(await page.locator('.mv-light').getAttribute('data-brightness'));
  assert.equal(await page.locator('video').evaluate(v=>v.currentTime),time,'Comparison changes preserve the clock');
  samples.push({t,candidate,constant});
 }
 assert.ok(samples.filter(s=>Math.abs(s.candidate-s.constant)>.03).length>=3,'Open must visibly modulate the fixed event clock');
 const matched=+(await page.locator('.mv-light').getAttribute('data-brightness'));
 await page.getByLabel('Match average brightness').uncheck();
 const native=+(await page.locator('.mv-light').getAttribute('data-brightness'));
 assert.ok(Math.abs(native-matched)>.001,'Native and matched constant gains must differ');
 await page.getByLabel('Match average brightness').check();
 await page.getByRole('button',{name:'Open expression',exact:true}).click();
 const gain=await page.getByLabel('Brightness sensitivity').inputValue(),fade=await page.getByLabel('Brightness fade').inputValue();
 await page.getByLabel('Brightness sensitivity').fill('0.25');assert.equal(await page.getByLabel('Use automatic brightness settings').getAttribute('aria-pressed'),'false');
 await page.getByLabel('Brightness fade').fill('400');
 await page.getByRole('button',{name:'Constant accents',exact:true}).click();assert.equal(await page.getByLabel('Brightness fade').inputValue(),'400','Shared envelope across comparisons');
 await page.getByLabel('Use automatic brightness settings').click();assert.equal(await page.getByLabel('Brightness sensitivity').inputValue(),gain);assert.equal(await page.getByLabel('Brightness fade').inputValue(),fade);
 await page.getByRole('button',{name:'Skeleton',exact:true}).click();assert.equal(await page.locator('canvas').getAttribute('aria-hidden'),'true');
 const value=await page.locator('.mv-light').getAttribute('data-brightness');
 await page.getByRole('button',{name:'Movement details',exact:true}).click();await page.getByLabel('Steadiness',{exact:true}).fill('90');assert.equal(await page.locator('.mv-light').getAttribute('data-brightness'),value);await page.getByRole('button',{name:'Close details',exact:true}).click();
 const time=await page.locator('video').evaluate(v=>v.currentTime);
 for(const v of ['v0','v1','v2','v3']){await page.getByLabel('Study version').selectOption(v);assert.equal(await page.locator('video').evaluate(v=>v.currentTime),time);}
 assert.equal(await page.getByRole('button',{name:'Open expression',exact:true}).getAttribute('aria-pressed'),'true');
 await page.locator('.movement-studio').focus();await page.keyboard.press('8');assert.equal(await page.locator('.mv-light').getAttribute('data-brightness'),'0');await page.keyboard.press('7');assert.equal(await page.locator('.mv-light').getAttribute('data-mode'),'open');
 assert.deepEqual(await page.locator('.mv-light').boundingBox(),{x:0,y:0,width:1440,height:1000});
 await page.screenshot({path:'/private/tmp/lightflow-v3-desktop.png'});
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const control of await page.locator('.mv-phrase-controls button,.mv-phrase-controls label').all()){
   const b=await control.boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width&&b.y+b.height<=viewport.height,'Comparison controls must fit the viewport');
  }
  await page.screenshot({path:`/private/tmp/lightflow-v3-${viewport.width}.png`});
 }
 await page.goto('http://localhost:3001/pipeline/study');await page.getByRole('link',{name:'Compare Open expression →',exact:true}).waitFor();
 assert.equal(await page.locator('.study-passages a').count(),10);await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/private/tmp/lightflow-study-final.png',fullPage:true});
 await page.locator('.study-passages a').filter({hasText:'The Tuxedo Way'}).click();
 await page.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='ready',null,{timeout:30000});assert.equal(await page.getByLabel('Study version').inputValue(),'v3');assert.ok(page.url().includes('cdcaa625-8176-4ea0-a78f-165593e75179'));
 const failed=await browser.newPage();await failed.route('**/*file=audio.m4a',r=>r.fulfill({status:503,body:'unavailable'}));
 await failed.goto('http://localhost:3001/pipeline/live?study=v3');await failed.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='unavailable');
 assert.ok((await failed.locator('.mv-auto-note').innerText()).includes('V3 needs audio'));assert.equal(await failed.locator('.mv-light').getAttribute('data-brightness'),'0');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,samples,checks:['V3 deep link','distinct amplitudes','common source clock','mean match toggle','shared manual settings','Auto restoration','smoothing independent','all version switches','blackout','viewport/mobile/landscape','10 indexed passages','reserved clip loads','audio failure explicit','no browser errors']}));
}finally{await browser.close();}
