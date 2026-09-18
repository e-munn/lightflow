import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
import {ScopeFeatures,FEATURE_NAMES} from '../../public/scope-core.mjs';
const out=process.argv[2];if(!out)throw Error('Pass fresh external run directory');fs.mkdirSync(out,{recursive:false});
const sources=JSON.parse(fs.readFileSync('research/wide_lights/sources.json')).sources;
const cases=[];for(const name of ['alleycvt','griz','ravenscoon','levity_forest','forest'])for(const start of name==='levity_forest'?[900]:name==='forest'?[600,3000]:[600,1800])cases.push({name,start,duration:120,split:sources[name].split,source:sources[name].source});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{
 const page=await browser.newPage();await page.goto('http://localhost:3001/scope-brightness.mjs');
 await page.evaluate(async()=>{const m=await import('/scope-brightness.mjs');window.projector=new m.ScopeBrightness(document.createElement('canvas'));});
 const synthetic=await page.evaluate(()=>{
  const rows=[];for(const kind of ['silence','mono_sine','quadrature_sine','mono_complex','stereo_complex']){
   const left=[],right=[];for(let i=0;i<960;i++){const a=2*Math.PI*100*i/48000;const l=kind==='silence'?0:kind.includes('complex')?.2*(Math.sin(a)+Math.sin(3*a)):.2*Math.SQRT2*Math.sin(a);left.push(l);right.push(kind==='quadrature_sine'?.2*Math.SQRT2*Math.cos(a):kind==='stereo_complex'?.2*(Math.cos(a)+Math.sin(7*a)):l);}
   rows.push({kind,rms:Math.sqrt(left.reduce((s,v,i)=>s+v*v+right[i]**2,0)/1920),...window.projector.frame(left,right)});
  }
  rows.push({kind:'invalid',...window.projector.frame([NaN],[0])});return rows;
 });
 fs.writeFileSync(path.join(out,'synthetic.json'),JSON.stringify(synthetic,null,2),{flag:'wx'});console.log('SYNTHETIC',JSON.stringify(synthetic));
 fs.writeFileSync(path.join(out,'extract-source.mjs'),fs.readFileSync(new URL(import.meta.url)),{flag:'wx'});
 const reports=[];
 for(const spec of cases){
  const pre=10,dsp=new ScopeFeatures(48000),frameBytes=960*8;let pending=Buffer.alloc(0),batch=[],frames=0;
  const filename=`${spec.name}_${spec.start}.csv`;
  if(process.argv[3]){
   const previous=path.join(process.argv[3],filename);
   if(fs.existsSync(previous)){const lines=fs.readFileSync(previous,'utf8').trim().split('\n');const final=lines.at(-1).split(',');
    if(lines.length===6501&&final.length===12&&Math.abs(Number(final[0])-(spec.start+spec.duration))<1e-5&&lines.slice(1).every(line=>line.split(',').length===12&&line.split(',').every(v=>Number.isFinite(Number(v))))){fs.copyFileSync(previous,path.join(out,filename),fs.constants.COPYFILE_EXCL);reports.push({...spec,filename,frames:6500,prefix:pre,copied_from:previous});console.log('REUSED VERIFIED COMPLETE',filename);continue;}
   }
  }
  const dest=fs.createWriteStream(path.join(out,filename),{flags:'wx'});
  dest.write(['seconds',...FEATURE_NAMES,'brightness','coverage','clipped_fraction'].join(',')+'\n');
  const child=spawn('ffmpeg',['-v','error','-ss',String(spec.start-pre),'-i',spec.source,'-t',String(spec.duration+pre),'-vn','-ac','2','-ar','48000','-f','f32le','pipe:1']);child.stderr.pipe(process.stderr);
  const closed=new Promise(resolve=>child.on('close',resolve));
  async function flush(){if(!batch.length)return;
   const projected=await page.evaluate(batch=>batch.map(row=>window.projector.frame(row.left,row.right)),batch);
   for(let i=0;i<batch.length;i++) {const r=batch[i],p=projected[i];if(!p.valid)throw Error('Invalid raster');dest.write([r.at,...r.features,p.brightness,p.coverage,p.clippedFraction].join(',')+'\n');}batch=[];
  }
  for await(const chunk of child.stdout){const data=Buffer.concat([pending,chunk]);let offset=0;
   for(;offset+frameBytes<=data.length;offset+=frameBytes){const l=new Float32Array(960),r=new Float32Array(960);for(let i=0;i<960;i++){l[i]=data.readFloatLE(offset+i*8);r[i]=data.readFloatLE(offset+i*8+4);}const f=dsp.frame(l,r);frames++;batch.push({at:spec.start-pre+frames/50,left:Array.from(l),right:Array.from(r),features:f.values});if(batch.length>=100)await flush();}
   pending=Buffer.from(data.subarray(offset));
  }
  await flush();if(await closed!==0)throw Error('Decode failed');await new Promise(r=>dest.end(r));reports.push({...spec,filename,frames,prefix:pre});console.log('EXTRACTED',filename,frames);
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:'scope-coverage-v1',browser:browser.version(),cases:reports,synthetic,physicalTimingMeasured:false,targetApproved:false},null,2),{flag:'wx'});
}finally{await browser.close()}
