import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const temp=mkdtempSync('/private/tmp/lightflow-brightness-browser-');
writeFileSync(temp+'/mapping.mjs',ts.transpileModule(readFileSync('src/lib/pipeline/movement-brightness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {movementBrightness,brightnessAt,BRIGHTNESS_MODES}=await import(pathToFileURL(temp+'/mapping.mjs'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3001/pipeline/live');
 await page.getByRole('button',{name:'Play music',exact:true}).waitFor({timeout:30000});
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 await page.waitForFunction(()=>document.querySelector('.mv-auto-note')?.dataset.audioStatus==='ready',{},{timeout:30000});
 assert.equal(await page.getByRole('button',{name:'Use automatic brightness settings'}).getAttribute('aria-pressed'),'true');
 const run=new URL(page.url()).searchParams.get('run');
 const frames=await(await page.request.get(`http://localhost:3001/api/pipeline?run=${run}&view=frames`)).json();
 const aspect=await page.locator('video').evaluate(v=>v.videoWidth/v.videoHeight);
 const signal=movementBrightness(frames,aspect);
 const seek=async t=>{
  await page.getByLabel('Seek music and skeleton').fill(String(Math.ceil(t*1000)/1000));
  try{await page.waitForFunction(t=>!document.querySelector('video').seeking&&Math.abs(Number(document.querySelector('.mv-skeleton').dataset.poseTime)-t)<.1,t,{timeout:10000});}
  catch(e){console.log(JSON.stringify({seek:t,state:await page.evaluate(()=>({canvas:{...document.querySelector('.mv-skeleton').dataset},light:{...document.querySelector('.mv-light').dataset},video:{time:document.querySelector('video').currentTime,seeking:document.querySelector('video').seeking,paused:document.querySelector('video').paused,ready:document.querySelector('video').readyState},note:document.querySelector('.mv-auto-note').textContent})),errors}));throw e;}
 };
 await page.getByRole('button',{name:'Play music',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('video').currentTime>.5);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 for(const {id,label} of BRIGHTNESS_MODES){
  await page.getByRole('button',{name:`${label} brightness`,exact:true}).click();
  assert.equal(await page.getByRole('button',{name:`${label} brightness`,exact:true}).getAttribute('aria-pressed'),'true');
  for(const t of [1,3,6]){
   await seek(t);
   const shown=await page.locator('.mv-light').evaluate(e=>({value:+e.dataset.brightness,mode:e.dataset.mode,color:getComputedStyle(e).backgroundColor,available:e.dataset.available}));
   const poseTime=+(await page.locator('.mv-skeleton').getAttribute('data-pose-time'));
   const gain=+(await page.getByLabel('Brightness sensitivity').inputValue()),fade=+(await page.getByLabel('Brightness fade').inputValue());
   const expected=brightnessAt(movementBrightness(frames,aspect,fade),poseTime,id,gain);
   assert.equal(shown.mode,id);assert.ok(Math.abs(shown.value-expected.value)<1e-9,`${id} must match its timestamped signal`);
   assert.equal(shown.available,String(expected.available));
   const v=Math.round(expected.value*255);assert.equal(shown.color,`rgb(${v}, ${v}, ${v})`);
  }
 }
 await page.getByRole('button',{name:'Motion brightness',exact:true}).click();
 const autoGain=await page.getByLabel('Brightness sensitivity').inputValue(),autoFade=await page.getByLabel('Brightness fade').inputValue();
 const audioSummary=await page.locator('.mv-auto-note').innerText();
 await page.getByLabel('Brightness sensitivity').fill('1.3');await page.getByLabel('Brightness fade').fill('160');
 assert.equal(await page.getByRole('button',{name:'Use automatic brightness settings'}).getAttribute('aria-pressed'),'false');
 await page.getByRole('button',{name:'Snap brightness',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Use automatic brightness settings'}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Motion brightness',exact:true}).click();
 assert.equal(await page.getByLabel('Brightness sensitivity').inputValue(),'1.3','Manual values are retained per mapping');
 await page.getByRole('button',{name:'Use automatic brightness settings'}).click();
 assert.equal(await page.getByLabel('Brightness sensitivity').inputValue(),autoGain);assert.equal(await page.getByLabel('Brightness fade').inputValue(),autoFade);
 await page.getByLabel('Brightness sensitivity').fill('1.3');await page.getByLabel('Brightness fade').fill('160');
 const bright=signal.find(f=>f.t>1&&f.motion>.95);assert.ok(bright);await seek(bright.t+.03);
 const rect=await page.locator('.mv-light').boundingBox();assert.deepEqual(rect,{x:0,y:0,width:1440,height:1000});
 const value=+(await page.locator('.mv-light').getAttribute('data-brightness'));assert.equal(value,1,'The entire field must reach white');
 await page.screenshot({path:'/private/tmp/lightflow-brightness-desktop.png'});
 await page.getByRole('button',{name:'Skeleton',exact:true}).click();
 assert.equal(await page.locator('.mv-skeleton').evaluate(e=>getComputedStyle(e).opacity),'0');
 assert.equal(+(await page.locator('.mv-light').getAttribute('data-brightness')),value,'Skeleton visibility cannot change the light');
 await page.getByRole('button',{name:'Movement details',exact:true}).click();
 await page.getByLabel('Steadiness',{exact:true}).fill('90');
 assert.equal(+(await page.locator('.mv-light').getAttribute('data-brightness')),value,'Display smoothing cannot change the light');
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await page.getByLabel('Brightness sensitivity').fill('0.25');
 assert.ok(+(await page.locator('.mv-light').getAttribute('data-brightness'))<=.25);
 await page.getByLabel('Brightness sensitivity').fill('1.3');
 await page.getByLabel('Brightness fade').fill('400');
 await seek(3);
 const poseTime=+(await page.locator('.mv-skeleton').getAttribute('data-pose-time'));
 assert.equal(+(await page.locator('.mv-light').getAttribute('data-brightness')),brightnessAt(movementBrightness(frames,aspect,400),poseTime,'motion',1.3).value);
 await page.locator('.movement-studio').focus();await page.keyboard.press('8');
 assert.equal(await page.locator('.mv-light').getAttribute('data-brightness'),'0','Off shortcut must immediately black out');
 await page.keyboard.press('4');assert.equal(await page.locator('.mv-light').getAttribute('data-mode'),'snap');
 await page.getByRole('button',{name:'Fullscreen',exact:true}).click();
 assert.ok(await page.evaluate(()=>!!document.fullscreenElement));
 assert.deepEqual(await page.locator('.mv-light').boundingBox(),{x:0,y:0,width:1440,height:1000});
 await page.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
 await page.getByRole('button',{name:'Skeleton',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 for(const button of await page.locator('.mv-mapping-buttons button').all()){
  const b=await button.boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=390&&b.y+b.height<=844);
 }
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:'/private/tmp/lightflow-brightness-mobile.png'});
 await page.getByRole('button',{name:'Movement details',exact:true}).click();
 const panel=await page.locator('.mv-info').boundingBox();assert.ok(panel.y>=0&&panel.y+panel.height<=844,'Settings must fit on mobile');
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await page.setViewportSize({width:844,height:390});
 await page.getByRole('button',{name:'Movement details',exact:true}).click();
 const landscape=await page.locator('.mv-info').boundingBox();assert.ok(landscape.y>=0&&landscape.y+landscape.height<=390,'Settings must fit in landscape');
 await page.screenshot({path:'/private/tmp/lightflow-brightness-landscape.png'});
 await page.getByRole('button',{name:'Close details',exact:true}).click();
 await page.getByLabel('Study version').selectOption('v0');
 assert.equal(await page.getByLabel('Brightness sensitivity').inputValue(),'1.3');assert.equal(await page.getByLabel('Brightness fade').inputValue(),'160');
 assert.equal(await page.getByLabel('Brightness sensitivity').isDisabled(),true,'V0 must keep its original settings');
 const v0time=+(await page.locator('.mv-skeleton').getAttribute('data-pose-time'));
 assert.ok(Math.abs(+(await page.locator('.mv-light').getAttribute('data-brightness'))-brightnessAt(signal,v0time,'snap',1.3).value)<1e-9);
 await page.goto('http://localhost:3001/pipeline/study');
 await page.getByRole('heading',{name:'Keep the timing. Find the expression.'}).waitFor();
 assert.equal(await page.locator('.study-versions section').count(),4);
 assert.equal(await page.locator('.study-links a').count(),6,'All preserved versions are playable');
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'/private/tmp/lightflow-study-index.png'});
 await page.getByRole('link',{name:'Play Open →',exact:true}).first().click();
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 assert.equal(await page.getByLabel('Study version').inputValue(),'v0');
 assert.equal(await page.getByRole('button',{name:'Open brightness',exact:true}).getAttribute('aria-pressed'),'true');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,audioSummary,autoGain,autoFade,checks:['automatic defaults','audio context loaded','manual overrides per mapping','restore Auto','all mapping buttons','same-timestamp outputs','full viewport white','skeleton toggle','smoothing independent','gain','fade','shortcuts','fullscreen','mobile','landscape','no browser errors']}));
}finally{await browser.close();}
