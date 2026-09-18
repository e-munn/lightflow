import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {chromium} from '@playwright/test';
const out=process.argv[2];if(!out)throw Error('Specify fresh output directory');fs.mkdirSync(out);
const previous=JSON.parse(fs.readFileSync('/Volumes/ExtremePro/Code/lightflow/research/brightness_dataset_v3/manifest.json'));
const cases=previous.cases.map(c=>({...c,duration:120}));for(const file of ['ratata.mp3','wheres_your_head_at.m4a'])cases.push({name:file.split('.')[0],source:path.resolve('public/songs',file),start:30,duration:60,split:'probe'});
const conditions=[{name:'original',gain:1,noise:0,echo:0,mono:false},{name:'noisy_stereo',gain:.5,noise:.007,echo:.2,mono:false},{name:'noisy_mono',gain:.5,noise:.007,echo:.2,mono:true}];
const b=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',args:['--mute-audio']});
try{const p=await b.newPage();await p.goto('http://localhost:3001/scope-brightness.mjs');await p.evaluate(async()=>{const {ScopeBrightness}=await import('/scope-brightness.mjs');const {ScopeFeatures}=await import('/scope-core.mjs');window.SB=ScopeBrightness;window.SF=ScopeFeatures;});
 const reports=[];
 for(const c of cases){
  const prefix=10;const decoded=spawnSync('ffmpeg',['-v','error','-ss',String(c.start-prefix),'-i',c.source,'-t',String(c.duration+prefix),'-vn','-ac','2','-ar','48000','-f','f32le','pipe:1'],{maxBuffer:70e6});if(decoded.status!==0)throw Error(String(decoded.stderr));
  const streams=conditions.map(condition=>{const file=`${c.name}_${c.start}_${condition.name}.csv`;const stream=fs.createWriteStream(path.join(out,file),{flags:'wx'});stream.write('seconds,amplitude,spread,texture,balance,bass,air,attack,correlation,observed_brightness,target_brightness\n');return {file,stream};});
  await p.evaluate(conditions=>{window.processors=conditions.map(c=>({c,dsp:new window.SF(48000),scope:new window.SB(document.createElement('canvas')),echoL:new Float32Array(1440),echoR:new Float32Array(1440),pos:0,seed:20260917}));window.processors.forEach(p=>p.scope.soft=true);},conditions);
  let frames=0;const batch=7680*100;
  for(let off=0;off<decoded.stdout.length;off+=batch){const bytes=decoded.stdout.subarray(off,Math.min(off+batch,decoded.stdout.length));const result=await p.evaluate(({encoded,start})=>{
   const raw=atob(encoded),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);const pcm=new Float32Array(bytes.buffer);const rows=[];
   for(let frame=0;frame+1920<=pcm.length;frame+=1920){let reference=0;const columns=[];
    for(const state of window.processors){const {c}=state,l=new Float32Array(960),r=new Float32Array(960);function noise(){state.seed=(1664525*state.seed+1013904223)>>>0;return (state.seed/4294967296*2-1)*Math.sqrt(3)*c.noise;}
     for(let i=0;i<960;i++){let a=pcm[frame+i*2],b=pcm[frame+i*2+1];if(c.mono)a=b=(a+b)/2;
      const na=noise(),nb=c.mono?na:noise();l[i]=c.gain*(a+c.echo*state.echoL[state.pos])+na;r[i]=c.gain*(b+c.echo*state.echoR[state.pos])+nb;state.echoL[state.pos]=a;state.echoR[state.pos]=b;state.pos=(state.pos+1)%1440;}
     const features=state.dsp.frame(l,r).values;const brightness=state.scope.frame(l,r).brightness;if(c.name==='original')reference=brightness;columns.push([...features,brightness]);
    }
    rows.push(columns.map(a=>[...a,reference]));
   }return rows;
  },{encoded:bytes.toString('base64')});
   for(const row of result){frames++;for(let k=0;k<streams.length;k++)streams[k].stream.write([c.start-prefix+frames/50,...row[k]].join(',')+'\n');}
  }
  for(const s of streams)await new Promise(resolve=>s.stream.end(resolve));reports.push({...c,prefix,frames,files:streams.map(s=>s.file)});console.log('EXTRACTED',c.name,c.start,frames,flush=>flush);
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:'scope-restoration-v1',browser:b.version(),conditions,cases:reports,reference:'original recording coverage with soft knee; not human lighting labels'},null,2),{flag:'wx'});
}finally{await b.close()}
