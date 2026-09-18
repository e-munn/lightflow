'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type ScopeFrame,type Source} from '@/lib/scope/audio';
import {behaviorFromCue,fixturePreview,type FixturePreview} from '@/lib/scope/fixtureAdapter';
import {lightSignal} from '../../../../public/scope-core.mjs';
import '../scope.css';
import './modulation.css';

type Stats={frames:number;contextFrames:number;channels:number;ready:boolean;delayedReady:boolean;compute:number;age:number;audible:number|null;dropped:number;resets:number};
const names=['Direct scope signal','With learned modulation','With simple audio control','With delayed-model control'];
export default function LiveModulation(){
 const [rig,setRig]=useState<FixturePreview|null>(null);
 const [status,setStatus]=useState('Choose music to begin'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[blackout,setBlackout]=useState(false),[stats,setStats]=useState<Stats|null>(null);
 const scope=useRef<HTMLCanvasElement>(null),canvases=useRef<(HTMLCanvasElement|null)[]>([]),audio=useRef<ScopeAudio|null>(null);
 const generation=useRef(0),black=useRef(false),recent=useRef<Record<string,unknown>[]>([]);
 useEffect(()=>{black.current=blackout;},[blackout]);
 function stop(){generation.current++;audio.current?.stop();audio.current=null;setBusy(false);setStats(null);setStatus('Stopped');}
 async function start(source:Source){
  stop();setBusy(true);setError('');setBlackout(false);black.current=false;recent.current=[];
  const token=generation.current,engine=new ScopeAudio({cueComparison:true});audio.current=engine;
  try{
   await engine.start(source,()=>{if(token===generation.current)stop();});
   if(token!==generation.current)return;
   setStatus(source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Live microphone':'Shared system / tab audio');
   if(engine.modelError)setError(engine.modelError+' — direct output remains available.');
  }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 useEffect(()=>{
  let raf=0,lastStats=0,lastRig=0,lastSequence=-1;
  function drawScope(frame?:ScopeFrame){
   const canvas=scope.current;if(!canvas)return;const g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,unit=Math.min(w,h)*.44;
   g.fillStyle='#050a0c';g.fillRect(0,0,w,h);g.strokeStyle='#18272a';g.lineWidth=1;g.beginPath();g.moveTo(w/2-unit,h/2);g.lineTo(w/2+unit,h/2);g.moveTo(w/2,h/2-unit);g.lineTo(w/2,h/2+unit);g.stroke();
   if(!frame||black.current)return;g.strokeStyle='#a9ffdf';g.beginPath();
   for(let i=0;i<frame.left.length;i++){const x=w/2+frame.left[i]*1.5*unit,y=h/2-frame.right[i]*1.5*unit;if(i)g.lineTo(x,y);else g.moveTo(x,y);}g.stroke();
  }
  function drawLights(canvas:HTMLCanvasElement|null,values?:ArrayLike<number>){
   if(!canvas)return;const g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;g.fillStyle='#000';g.fillRect(0,0,w,h);
   if(!values||black.current)return;const [intensity,hue,spread,texture,balance]=Array.from(values);
   g.fillStyle=`hsl(${hue*360} 55% ${intensity*75}%)`;g.fillRect(0,0,w,h*.47);
   for(let i=0;i<8;i++){
    const envelope=Math.exp(-.5*(((i+.5)/8-(.5+balance*.36))/(.1+spread*.55))**2),detail=1-texture*.45+(i%2)*texture*.45;
    g.fillStyle=`hsl(${hue*360} 55% ${intensity*(.18+.82*envelope)*detail*80}%)`;g.fillRect(i*w/8+5,h*.55,w/8-10,h*.4);
   }
  }
  function tick(now:number){
   // rAF timestamps can predate newly delivered audio messages; sample the clock at use.
   now=performance.now();
   const engine=audio.current,candidate=engine?.frame(now),frame=candidate&&now-candidate.received<500?candidate:undefined;
   drawScope(frame);
   if(now-lastRig>250){lastRig=now;const values=black.current?undefined:frame?.cue?.output[1];setRig(fixturePreview(values?behaviorFromCue(values,frame!.received):null,now));}
   const direct=frame?lightSignal(frame.values,undefined,false,[]):null;
   const fallback=direct?[direct.intensity,direct.hue,direct.spread,direct.texture,direct.balance,direct.accent,1,1]:undefined;
   for(let i=0;i<4;i++)drawLights(canvases.current[i],frame?.cue?.output[i]??fallback);
   if(engine&&frame){
    const timing=engine.timing(frame,now),cue=frame.cue;
    if(frame.sequence!==lastSequence){
     lastSequence=frame.sequence;recent.current.push({sequence:frame.sequence,at:frame.at,...timing,channels:frame.channels,
      features:frame.values,cueReady:cue?.ready??false,delayedReady:cue?.delayedReady??false,predictionAt:cue?.predictionAt??null,
      predictionReadyAt:cue?.predictionReadyAt??null,outputs:cue?.output.map(v=>Array.from(v))??null,resets:cue?.resets??0});
     if(recent.current.length>1500)recent.current.shift();
    }
    if(now-lastStats>250){
     lastStats=now;setStats({frames:engine.frames,contextFrames:cue?.audioFrames??0,channels:frame.channels,ready:cue?.ready??false,delayedReady:cue?.delayedReady??false,
      compute:frame.computeMs,age:timing.sampleToGraphMs,audible:timing.estimatedAudibleOffsetMs,dropped:engine.dropped,resets:cue?.resets??0});
     if(engine.modelError)setError(engine.modelError+' — direct output remains available.');
    }
   }
   raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);generation.current++;audio.current?.stop();};
 },[]);
 function exportTrace(){
  const blob=new Blob([JSON.stringify({version:1,source:status,model:'native-cue-gain-v1',experimental:true,physicalTimingMeasured:false,
   outputNames:['intensity','hue','spread','texture','balance','accent','gain','spread_gain'],methods:['direct','learned','instant_context','delayed_model'],frames:recent.current},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lightflow-live-modulation-timing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const remaining=(seconds:number)=>Math.max(0,seconds-(stats?.contextFrames??0)/50).toFixed(1);
 return <main className="scope-lab cue-lab">
  <header><a href="/scope">lightflow / scope</a><span>EXPERIMENTAL LIVE COMPARISON</span></header>
  <div className="scope-intro"><p className="scope-kicker">THE TRAINED MODEL, LISTENING LIVE</p><h1>Keep the detail.<br/>Compare the expression.</h1><p>Every panel hears the same music. Compare the direct scope signal with a trained brightness-and-spread layer, a simple control, and delayed predictions.</p></div>
  <section className="scope-input" aria-label="Audio source">
   <button disabled={busy} onClick={()=>start({kind:'mic'})}>Microphone</button>
   <button disabled={busy} onClick={()=>start({kind:'system'})}>System / tab audio</button>
   <label className="scope-file">Open music<input type="file" accept="audio/*,video/mp4" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void start({kind:'file',file:f});e.target.value='';}}/></label>
   <button disabled={busy} onClick={()=>start({kind:'url',url:'/api/scope-research/forest',name:'Of The Trees · Electric Forest · from 30:00',start:1800})}>Play Electric Forest</button>
   <button disabled={busy} onClick={()=>start({kind:'url',url:'/api/scope-research/jackWhite',name:'Jack White · Pine Knob · from 34:00',start:2040})}>Play Jack White</button>
   <button onClick={stop}>Stop</button><button aria-pressed={blackout} onClick={()=>setBlackout(v=>!v)}>{blackout?'Restore':'Blackout'}</button>
  </section>
  <p className="scope-status" role="status">{busy?'Connecting audio and loading trained model…':status}</p>
  {error&&<p className="scope-error" role="alert">{error}</p>}
  <section className="cue-reference">
   <article><h2>Stereo scope / reference</h2><canvas ref={scope} width={520} height={300} aria-label="Stereo scope reference"/><p>20 ms window · fixed gain 1.5 · no persistence</p></article>
   <div><h2>{stats?.ready?'Trained modulation is active':'Direct response starts immediately'}</h2>
    <p>{stats?.ready?'The learned layer can gently change brightness and spatial spread. The fast measured detail remains in every panel.':`The trained layer needs 25.5 seconds of past audio. ${stats?`${remaining(25.5)} seconds of context remain.`:'Choose a source to start.'}`}</p>
    <p>{stats?.delayedReady?'The delayed control is active too. Only its learned input is 17 seconds late; its direct audio stays current.':`The delayed control needs 42.5 seconds of context${stats?` (${remaining(42.5)} seconds remain)` : ''}.`}</p>
    <p className="cue-caution">Research candidate: this model has not yet beaten the simple control on Of The Trees. A trained model is available; better musical judgment is still unproven.</p>
   </div>
  </section>
  <section className="scope-comparison cue-lights">
   {names.map((name,i)=><article key={name}><div><span>{['REFERENCE','TRAINED CANDIDATE','SIMPLE CONTROL','DELAYED CONTROL'][i]}</span><h2>{name}</h2></div>
    <canvas ref={node=>{canvases.current[i]=node;}} width={520} height={280} aria-label={name}/>
    <p>{i===0?'Immediate amplitude, stereo breadth and texture':i===3?(stats?.delayedReady?'Delayed model · correct fast audio':'Direct signal while delayed context fills'):(stats?.ready?'Same renderer · bounded brightness and spread':'Direct signal while model context fills')}</p>
   </article>)}
  </section>
  <section aria-label="Fixture dry run" style={{margin:'32px 0',padding:'20px',border:'1px solid #34534a',borderRadius:8}}><h2>Fixture mapping · dry run</h2><p>{rig?.valid?'Signal available':'No current signal — dimmers closed'}. No hardware connection is made. RGB fixtures follow hue; moving heads remain parked with white color and no strobe.</p><div style={{display:'flex',gap:24,flexWrap:'wrap'}}>{rig&&Object.entries(rig.states).map(([id,state])=><div key={id}><strong>{id}</strong><p>Dimmer {Math.round(state.dim*100)}%</p><meter min={0} max={1} value={state.dim} aria-label={id+' dimmer'}/></div>)}</div><details><summary>Mapped channel values</summary><p style={{overflowWrap:'anywhere'}}>{rig?Array.from(rig.universe.slice(0,38)).map((v,i)=>`${i+1}:${v}`).join(' · '):'Waiting for signal'}</p></details></section>
  <section className="scope-footer"><div><h2>Judge the music, not just the movement</h2><p><a href="/scope/review">Try a blinded listening comparison</a></p><p>Compare subtle details, strong accents, quiet moments and changes of phrase. More movement alone does not mean better lighting. Color follows the same direct audio mapping in every panel.</p><p>Audio stays on this device. No DMX fixtures are controlled. The original scope comparison remains available through the link above.</p></div>
   <div className="scope-metrics" data-testid="cue-telemetry"><span>{stats?`${stats.channels} channels · ${stats.frames} audio frames`:'Waiting for audio'}</span>
    <span>{stats?`${stats.ready?'Model ready':'Model warming'} · ${stats.delayedReady?'Delayed ready':'Delayed warming'}`:''}</span>
    <span>{stats?`${stats.compute.toFixed(2)} ms compute · ${stats.age.toFixed(1)} ms audio-clock age`:''}</span>
    <span>{stats?.audible!=null?`${stats.audible.toFixed(1)} ms estimated offset from audible sample`:''}</span>
    <span>{stats?`Queue overflow ${stats.dropped} · context resets ${stats.resets}`:''}</span>
    <small>Software timing only. Physical microphone-to-light latency has not been measured.</small><button disabled={!stats} onClick={exportTrace}>Export recent timing</button>
   </div>
  </section>
 </main>;
}
