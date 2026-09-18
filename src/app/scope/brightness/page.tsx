'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type Source} from '@/lib/scope/audio';
import '../scope.css';
import MomentReview from './MomentReview';
import type {MomentFrame,MomentSource} from '@/lib/scope/moments';
import {ScopeBrightness} from '../../../../public/scope-brightness.mjs';

export default function ScopeBrightnessPage(){
 const [status,setStatus]=useState('Choose audio'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[value,setValue]=useState(0),[exposure,setExposure]=useState(40),[soft,setSoft]=useState(true),[canMark,setCanMark]=useState(false),[stats,setStats]=useState<{frames:number;age:number;compute:number;channels:number}|null>(null);
 const scope=useRef<HTMLCanvasElement>(null),field=useRef<HTMLCanvasElement>(null),trace=useRef<HTMLCanvasElement>(null),audio=useRef<ScopeAudio|null>(null),generation=useRef(0),gain=useRef(40),softRef=useRef(true),recent=useRef<Record<string,unknown>[]>([]),sourceInfo=useRef<MomentSource|null>(null),observations=useRef<MomentFrame[]>([]);
 useEffect(()=>{gain.current=exposure;softRef.current=soft;},[exposure,soft]);
 function stop(){generation.current++;audio.current?.stop();audio.current=null;setBusy(false);setStatus('Stopped');setStats(null);setCanMark(false);}
 async function start(source:Source){stop();setError('');setBusy(true);recent.current=[];observations.current=[];sourceInfo.current={sessionId:crypto.randomUUID(),kind:source.kind,name:source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Live microphone':'System audio',...(source.kind==='url'?{url:source.url}:{}),...(source.kind==='file'?{size:source.file.size,lastModified:source.file.lastModified}:{})};const token=generation.current;const r=new ScopeAudio({forecast:false});audio.current=r;
 try{await r.start(source,()=>{if(token===generation.current)stop()});if(token!==generation.current)return;setStatus(source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Microphone':'System audio');}
 catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}finally{if(token===generation.current)setBusy(false);}}
 useEffect(()=>{let raf=0,last=-1,lastStats=0;const history:number[]=[];let brightness=0,compute=0;const measure=document.createElement('canvas');const projection=new ScopeBrightness(measure);
 function tick(now:number){
   // rAF timestamps can predate newly delivered audio messages; sample the clock at use.
   now=performance.now();const f=audio.current?.frame(now);
 if(f&&f.sequence!==last){last=f.sequence;projection.exposure=gain.current;projection.soft=softRef.current;const started=performance.now();brightness=projection.frame(f.left,f.right).brightness;compute=performance.now()-started;
 if(audio.current){recent.current.push({at:f.at,sequence:f.sequence,brightness,softCurve:softRef.current,exposure:gain.current,channels:f.channels,projectionMs:compute,...audio.current.timing(f,performance.now())});if(recent.current.length>1500)recent.current.shift();}
 const box=field.current?.getBoundingClientRect();const visibleFraction=box&&box.width>0&&box.height>0?Math.max(0,Math.min(innerWidth,box.right)-Math.max(0,box.left))*Math.max(0,Math.min(innerHeight,box.bottom)-Math.max(0,box.top))/(box.width*box.height):0;
 const engine=audio.current;const sourceSeconds=engine?.media&&engine.context?engine.media.currentTime-(engine.context.currentTime-f.at)*engine.media.playbackRate:null;
 observations.current.push({at:f.at,sourceSeconds,brightness,features:Array.from(f.values),exposure:gain.current,softCurve:softRef.current,visibleFraction:Math.min(1,visibleFraction),pageVisible:document.visibilityState==='visible'});
 while(observations.current.length&&observations.current[0].at<f.at-5)observations.current.shift();
 history.push(brightness);if(history.length>400)history.shift();
 const c=scope.current;if(c){const ctx=c.getContext('2d')!;ctx.imageSmoothingEnabled=false;ctx.drawImage(measure,0,0,c.width,c.height);}}
 if(!f){observations.current=[];brightness=0;history.length=0;last=-1;const c=scope.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height);}
 const c=field.current;if(c){const ctx=c.getContext('2d')!;const v=Math.round(brightness*255);ctx.fillStyle=`rgb(${v} ${v} ${v})`;ctx.fillRect(0,0,c.width,c.height);}
 const t=trace.current;if(t){const ctx=t.getContext('2d')!;ctx.fillStyle='#080e12';ctx.fillRect(0,0,t.width,t.height);ctx.strokeStyle='#a7dbca';ctx.beginPath();history.forEach((v,i)=>{const x=t.width-(history.length-1-i)*t.width/400,y=t.height*(1-v);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y)});ctx.stroke();}
 if(now-lastStats>100){setValue(brightness);setCanMark(!!f&&observations.current.filter(x=>x.pageVisible&&x.visibleFraction>=.5).length>=25);if(f&&audio.current){const timing=audio.current.timing(f,now);setStats({frames:audio.current.frames,age:timing.sampleToGraphMs,compute,channels:f.channels});}else setStats(null);lastStats=now;}raf=requestAnimationFrame(tick);}
 raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);generation.current++;audio.current?.stop();};},[]);
 function exportTiming(){const blob=new Blob([JSON.stringify({version:1,source:status,projection:'scope-coverage-v1',softKnee:.6432430384611177,modelEnabled:false,physicalLatencyMeasured:false,frames:recent.current},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='lightflow-scope-brightness-timing.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main className="scope-lab"><header><a href="/scope">lightflow / stereo scope</a><span>ONE OUTPUT / SCOPE-DERIVED EXPERIMENT</span></header>
 <div className="scope-intro"><h1>Start with the scope.</h1><p>Left: the actual stereo waveform. Right: one brightness value measured from how much of that trace is illuminated. No volume-only envelope, fixture layout or scripted sequence.</p><p>This is an experimental reduction of the scope, not a trained director. Shape cannot be fully preserved in one number.</p></div>
 <p><a href="/scope/threshold" style={{color:'#edbd71'}}>Try the circle threshold experiment →</a></p>
 <section className="scope-input"><button disabled={busy} onClick={()=>start({kind:'url',url:'/api/scope-research/forest',name:'Electric Forest · 31:00',start:1860})}>Play Electric Forest</button><button disabled={busy} onClick={()=>start({kind:'mic'})}>Microphone</button><button disabled={busy} onClick={()=>start({kind:'system'})}>System / tab audio</button><label className="scope-file">Open music<input type="file" accept="audio/*,video/mp4" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void start({kind:'file',file:f});e.target.value='';}}/></label><button onClick={stop}>Stop</button></section>
 <p role="status">{busy?'Connecting…':status}</p>{error&&<p role="alert">{error}</p>}<p data-testid="scope-timing">{stats?`${stats.channels} input channels · ${stats.frames} frames · ${stats.age.toFixed(1)} ms graph age · ${stats.compute.toFixed(2)} ms projection`:"Waiting for fresh audio"}</p>
 <section className="scope-comparison" style={{gridTemplateColumns:'1fr 1fr'}}><article><h2>Stereo scope reference</h2><canvas ref={scope} width={512} height={512} aria-label="Stereo waveform reference"/><p>20 ms of left/right audio · fixed waveform gain</p></article><article><h2>One brightness channel</h2><canvas ref={field} width={512} height={512} aria-label="Scope-derived brightness"/><button onClick={()=>field.current?.requestFullscreen().catch(()=>setError('Fullscreen unavailable'))}>Fullscreen brightness</button><p>Brightness {value.toFixed(3)}</p></article></section>
 <MomentReview enabled={canMark} getContext={()=>({source:sourceInfo.current,frames:observations.current})}/>
 <button onClick={exportTiming} disabled={!stats}>Export recent timing</button><canvas ref={trace} width={1000} height={120} aria-label="Brightness history" style={{width:'100%',height:120}}/>
 <details><summary>Display sensitivity</summary><label><input type="checkbox" checked={soft} onChange={e=>setSoft(e.target.checked)}/> Preserve bright detail</label><br/><label>Display exposure {exposure}<input type="range" min="5" max="100" value={exposure} onChange={e=>setExposure(Number(e.target.value))}/></label><p>The softer curve keeps dense passages from sitting near white. It preserves the scope measurement and adds no temporal smoothing. Uncheck it to use the original response.</p></details><p>The scope remains the reference. This is a direct signal experiment; the tested forecast model is not enabled. Output clears when audio stops or becomes stale.</p>
 </main>;
}
