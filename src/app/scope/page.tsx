'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type Source,type ScopeFrame} from '@/lib/scope/audio';
import {lightSignal} from '../../../public/scope-core.mjs';
import './scope.css';
type Telemetry={frames:number;channels:number;age:number;compute:number;audible:number|null;rms:number;peak:number;forecast:boolean;dropped:number};
export default function ScopeResearch(){
 const [status,setStatus]=useState('Choose music to begin'),[error,setError]=useState(''),[running,setRunning]=useState(false),[busy,setBusy]=useState(false),[blackout,setBlackout]=useState(false),[telemetry,setTelemetry]=useState<Telemetry|null>(null);
 const scope=useRef<HTMLCanvasElement>(null),direct=useRef<HTMLCanvasElement>(null),learned=useRef<HTMLCanvasElement>(null);
 const reactor=useRef<ScopeAudio|null>(null),generation=useRef(0),black=useRef(false),recent=useRef<Record<string,unknown>[]>([]);
 useEffect(()=>{black.current=blackout;},[blackout]);
 function stop(){generation.current++;reactor.current?.stop();reactor.current=null;setRunning(false);setBusy(false);setStatus('Stopped');setTelemetry(null);}
 async function start(input:Source){
  stop();setError('');setBusy(true);setBlackout(false);black.current=false;recent.current=[];
  const token=generation.current,r=new ScopeAudio();reactor.current=r;
  try{await r.start(input,()=>{if(token===generation.current)stop();});if(token!==generation.current)return;
   setRunning(true);setStatus(input.kind==='file'?input.file.name:input.kind==='url'?input.name:input.kind==='mic'?'Live microphone':'Shared system / tab audio');
   if(r.modelError)setError(r.modelError+' — direct signal remains available.');
  }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 useEffect(()=>{
  let raf=0,lastStats=0,lastSequence=-1;
  const paintScope=(frame?:ScopeFrame)=>{
   const c=scope.current;if(!c)return;const g=c.getContext('2d')!;g.fillStyle='#050a0c';g.fillRect(0,0,c.width,c.height);
   const unit=Math.min(c.width,c.height)*.44;g.strokeStyle='#18272a';g.lineWidth=1;
   g.beginPath();g.moveTo(c.width/2-unit,c.height/2);g.lineTo(c.width/2+unit,c.height/2);g.moveTo(c.width/2,c.height/2-unit);g.lineTo(c.width/2,c.height/2+unit);g.stroke();
   if(!frame||black.current)return;g.strokeStyle='#a9ffdf';g.lineWidth=1;g.beginPath();
   for(let i=0;i<frame.left.length;i++){const x=c.width/2+frame.left[i]*1.5*unit,y=c.height/2-frame.right[i]*1.5*unit;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}g.stroke();
  };
  const paintLights=(canvas:HTMLCanvasElement|null,frame:ScopeFrame|undefined,forecast:boolean)=>{
   if(!canvas)return;const g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;
   g.fillStyle='#000';g.fillRect(0,0,w,h);if(!frame||black.current)return;
   const s=lightSignal(frame.values,frame.forecast,forecast,reactor.current?.model?.accepted_channels??[]);
   // Upper surface consumes only intensity and color. Lower strip uses spatial dimensions.
   g.fillStyle=`hsl(${s.hue*360} 55% ${s.intensity*75}%)`;g.fillRect(0,0,w,h*.47);
   for(let i=0;i<8;i++){
    const position=(i+.5)/8,center=.5+s.balance*.36,width=.1+s.spread*.55;
    const envelope=Math.exp(-.5*((position-center)/width)**2);
    const detail=1-s.texture*.45+(i%2)*s.texture*.45;
    const level=s.intensity*(.18+.82*envelope)*detail;
    g.fillStyle=`hsl(${s.hue*360} 55% ${level*80}%)`;g.fillRect(i*w/8+5,h*.55,w/8-10,h*.4);
   }
  };
  function tick(now:number){
   // rAF timestamps can predate newly delivered audio messages; sample the clock at use.
   now=performance.now();
   const r=reactor.current;const candidate=r?.frame(now);
   const frame=candidate&&now-candidate.received<500?candidate:undefined;
   paintScope(frame);paintLights(direct.current,frame,false);paintLights(learned.current,frame,true);
   if(r&&frame){
    const timing=r.timing(frame,now);
    if(frame.sequence!==lastSequence){lastSequence=frame.sequence;recent.current.push({sequence:frame.sequence,at:frame.at,...timing,features:frame.values,forecast:frame.forecast??null});if(recent.current.length>1500)recent.current.shift();}
    if(now-lastStats>250){lastStats=now;setTelemetry({frames:r.frames,channels:frame.channels,age:timing.sampleToGraphMs,compute:frame.computeMs,audible:timing.estimatedAudibleOffsetMs,rms:frame.rms,peak:frame.peak,forecast:!!frame.forecast,dropped:r.dropped});}
   }
   raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);generation.current++;reactor.current?.stop();};
 },[]);
 function exportTrace(){const blob=new Blob([JSON.stringify({version:1,source:status,physicalTimingMeasured:false,frames:recent.current},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lightflow-timing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main className="scope-lab">
  <header><a href="/">lightflow</a><span>RESEARCH / 01</span></header>
  <div className="scope-intro"><p className="scope-kicker">FROM SOUND TO LIGHT</p><h1>Keep the detail.<br/>Learn what comes next.</h1><p>The stereo scope is our reference. Compare its direct light signal with a small learned anticipation layer, listening to the same music.</p></div>
  <section className="scope-input" aria-label="Audio source">
   <button disabled={busy} onClick={()=>start({kind:'mic'})}>Microphone</button>
   <button disabled={busy} onClick={()=>start({kind:'system'})}>System / tab audio</button>
   <label className="scope-file">Open music<input disabled={busy} type="file" accept="audio/*,video/mp4" onChange={e=>{const f=e.target.files?.[0];if(f)void start({kind:'file',file:f});e.target.value='';}}/></label>
   <button disabled={busy} onClick={()=>start({kind:'url',url:'/api/scope-research/forest',name:'Of The Trees · Electric Forest · from 20:00',start:1200})}>Play Electric Forest</button>
   <button disabled={busy} onClick={()=>start({kind:'url',url:'/api/scope-research/jackWhite',name:'Jack White · Pine Knob · from 34:30',start:2070})}>Play Jack White</button>
   <button onClick={stop}>Stop</button>
   <button aria-pressed={blackout} onClick={()=>setBlackout(x=>!x)}>{blackout?'Restore':'Blackout'}</button>
  </section>
  <p role="status" className="scope-status">{busy?'Connecting audio…':status}{running?' · Audio stays on this device':''}</p>
  {error&&<p role="alert" className="scope-error">{error}</p>}
  <section className="scope-comparison">
   <article><div><span>01 / REFERENCE</span><h2>Stereo scope</h2></div><canvas ref={scope} width={520} height={440} aria-label="Stereo scope reference"/><p>Left / right waveform · 20 ms · fixed gain</p></article>
   <article><div><span>02 / BASELINE</span><h2>Direct light signal</h2></div><canvas ref={direct} width={520} height={440} aria-label="Direct lighting output"/><p>Amplitude, spread, texture and balance</p></article>
   <article><div><span>03 / EXPERIMENT</span><h2>With anticipation</h2></div><canvas ref={learned} width={520} height={440} aria-label="Forecast assisted lighting output"/><p>{telemetry?.forecast?'Learned 100 ms forecast · same light mapping':'Forecast begins after 2 seconds of audio'}</p></article>
  </section>
  <section className="scope-footer"><div><h2>A foundation for the director</h2><p>This model forecasts short-term audio changes. The light mapping is procedural; human-level phrasing and choreography remain the next research step.</p><p>Electric Forest and Jack White were held out of training. Jack White is our first rock comparison. Mono inputs retain detail but have no stereo spread.</p></div>
   <div className="scope-metrics" data-testid="telemetry"><span>{telemetry?`${telemetry.channels} channels · ${telemetry.frames} audio frames`:'Waiting for audio'}</span><span>{telemetry?`${telemetry.age.toFixed(1)} ms audio-clock age · ${telemetry.compute.toFixed(2)} ms compute`:''}</span><span>{telemetry?.audible!=null?`${telemetry.audible.toFixed(1)} ms estimated offset from audible sample`:''}</span><span>{telemetry?`RMS ${telemetry.rms.toFixed(4)} · peak ${telemetry.peak.toFixed(3)} · queue overflow ${telemetry.dropped}`:''}</span><small>Software timing estimates. Physical microphone-to-light latency has not been measured.</small><button onClick={exportTrace} disabled={!telemetry}>Export recent timing</button></div>
  </section>
 </main>;
}
