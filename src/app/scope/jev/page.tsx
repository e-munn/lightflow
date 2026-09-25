'use client';

import {useCallback, useEffect, useRef, useState} from 'react';
import {ScopeAudio, type Source} from '@/lib/scope/audio';
import {ScopeBrightness} from '../../../../public/scope-brightness.mjs';
import {RadialThreshold} from '../../../../public/scope-threshold.mjs';
import {AttitudeBank, defaultAttitudeSettings} from '../../../../public/scope-attitudes.mjs';
import {LiveContext, LiveSelector, GestureEngine, JEV_INTERVAL_MS, describeLive} from '../../../../public/jev-live.mjs';
import './jev.css';

type Answer = {choice:string;confidence:number;probabilities:Record<string,number>};
type Decision = {answers:Record<'gesture'|'focus'|'contrast',Answer>;model:string;capturedAt:number;roundTripMs:number;usage:{input_tokens:number;output_tokens:number}};
type Reading = {mode:string;focus:string;contrast:string;level:number;circle:number;fallback:boolean;latency:number|null;requests:number;disposition:string};
const initial:Reading = {mode:'trace',focus:'broad',contrast:'balanced',level:0,circle:0,fallback:true,latency:null,requests:0,disposition:'Choose audio to begin'};
const labels:Record<string,string> = {trace:'Trace',grain:'Grain',strike:'Strike',bloom:'Bloom',carve:'Carve',space:'Space',uncertain:'Uncertain',broad:'Full spectrum',low:'Low',mid:'Mid',high:'High',soft:'Soft',balanced:'Balanced',deep:'Deep'};
const details:Record<string,string> = {trace:'Preserve the detailed scope movement.',grain:'Fine fractured light follows changing texture.',strike:'Exposed attacks become short positive accents.',bloom:'An immediate glow with a connected tail.',carve:'Attacks cut darkness into the glow.',space:'Separated accents leave room for darkness.'};
const freshRuntime = () => ({bank:new AttitudeBank(),gestures:new GestureEngine(),context:new LiveContext(),selector:new LiveSelector(),sequence:-1,values:new GestureEngine().empty(),recentGestures:[] as string[],nextRequest:0,started:performance.now(),requests:0,latency:null as number|null,disposition:'Gathering a quarter-second of context'});
const demo:Source = {kind:'url',url:'/songs/calabria_-_austin_marc.mp3',name:'Calabria · Austin Marc'};

export default function JevExperiment() {
  const [active,setActive]=useState(false),[busy,setBusy]=useState(false),[sourceName,setSourceName]=useState('Choose music or a live input');
  const [display,setDisplay]=useState<'jev'|'circle'>('jev'),[gain,setGain]=useState(.7),[blackout,setBlackout]=useState(false);
  const [reading,setReading]=useState<Reading>(initial),[decision,setDecision]=useState<Decision|null>(null),[error,setError]=useState('');
  const [observations,setObservations]=useState<Record<string,string>>({}),[exportable,setExportable]=useState(false);
  const audio=useRef<ScopeAudio|null>(null),generation=useRef(0),runtime=useRef<ReturnType<typeof freshRuntime>|null>(null);
  const stage=useRef<HTMLDivElement>(null),output=useRef<HTMLDivElement>(null),circlePreview=useRef<HTMLDivElement>(null),jevPreview=useRef<HTMLDivElement>(null),scope=useRef<HTMLCanvasElement>(null);
  const pending=useRef<AbortController|null>(null),displayRef=useRef<'jev'|'circle'>('jev'),gainRef=useRef(.7),blackRef=useRef(false);
  const history=useRef<Record<string,unknown>[]>([]);
  const timings=useRef<ReturnType<ScopeAudio['timing']>[]>([]);

  const stop=useCallback(()=>{
    generation.current++; pending.current?.abort(); pending.current=null;
    audio.current?.stop(); audio.current=null; runtime.current=null;
    setActive(false);setBusy(false);setReading(initial);
    for(const element of [output.current,circlePreview.current,jevPreview.current]){
      if(element){element.style.backgroundColor='#000';element.dataset.level='0.00000';}
    }
  },[]);
  async function start(source:Source){
    stop();const token=generation.current;setBusy(true);setError('');setDecision(null);setObservations({});
    history.current=[];timings.current=[];setExportable(false);
    const engine=new ScopeAudio({forecast:false,musicFeatures:true});audio.current=engine;
    runtime.current=freshRuntime();
    try{
      await engine.start(source,stop);
      if(token!==generation.current){engine.stop();return;}
      setSourceName(source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Microphone':'Shared audio');
      setActive(true);
    }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:'Could not start audio.');}}
    finally{if(token===generation.current)setBusy(false);}
  }
  function switchDisplay(value:'jev'|'circle'){displayRef.current=value;setDisplay(value);}
  function toggleBlackout(){blackRef.current=!blackRef.current;setBlackout(blackRef.current);}
  function fullscreen(){stage.current?.requestFullscreen().catch(()=>setError('Fullscreen is unavailable in this browser.'));}
  function exportDecisions(){
    const blob=new Blob([JSON.stringify({version:'jev-live-v2',model:'jev-1.13.0',synthetic:false,musicalQualityValidated:false,physicalLatencyMeasured:false,decisions:history.current,softwareTimingSamples:timings.current},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`lightflow-jev-${Date.now()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  useEffect(()=>{
    if(!scope.current)return;
    const projection=new ScopeBrightness(scope.current),threshold=new RadialThreshold(),settings=defaultAttitudeSettings();
    threshold.configure({radius:.33,below:'soft',above:'expand',ratio:3.3,adaptive:false});
    let raf=0,lastUi=0;
    const paint=(element:HTMLDivElement|null,value:number)=>{if(element){element.style.backgroundColor=`rgb(${Math.round(value*255)} ${Math.round(value*255)} ${Math.round(value*255)})`;element.dataset.level=value.toFixed(5);}};
    async function ask(snapshot:NonNullable<ReturnType<LiveContext['snapshot']>>,r:ReturnType<typeof freshRuntime>){
      const token=generation.current,controller=new AbortController();pending.current=controller;
      const sent=performance.now();r.requests++;r.nextRequest=sent+JEV_INTERVAL_MS;
      const context=describeLive(snapshot);setObservations(context.current);
      try{
        const response=await fetch('/api/jev',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(snapshot),signal:controller.signal});
        const body=await response.json();
        if(token!==generation.current||runtime.current!==r)return;
        if(!response.ok){r.nextRequest=performance.now()+(response.status===429?3000:2000);throw Error(body.error||'Jev is unavailable.');}
        const d=body as Decision;const current=audio.current?.frame(performance.now());
        r.latency=Math.round(performance.now()-sent);
        r.disposition=current&&d.capturedAt===snapshot.at?r.selector.accept(d,snapshot.at,current.at):'stale';
        setDecision(d);setError('');
        if(r.disposition==='accepted'){r.recentGestures.push(r.selector.mode);r.recentGestures=r.recentGestures.slice(-6);}
        history.current.push({snapshot,observations:context.current,decision:d,requestedAtMs:sent-r.started,browserRoundTripMs:r.latency,signalAgeAtReplyMs:current?Math.round((current.at-snapshot.at)*1000):null,disposition:r.disposition,appliedPlan:{...r.selector.plan}});
        // A session is capped at ten minutes / about 1,200 requests.
        if(history.current.length>1300)history.current.shift();setExportable(true);
      }catch(e){
        if(token===generation.current&&!controller.signal.aborted){r.disposition='unavailable';setError(e instanceof Error?e.message:'Jev is unavailable.');}
      }finally{
        if(pending.current===controller){
          pending.current=null;
          // Coalesce fresh observations; never queue old audio behind a request.
          r.nextRequest=Math.max(r.nextRequest,performance.now()+250);
        }
      }
    }
    function draw(now:number){
      const r=runtime.current,frame=audio.current?.frame(now);
      if(r&&now-r.started>600000){stop();setSourceName('Ten-minute session finished. Choose audio to continue.');raf=requestAnimationFrame(draw);return;}
      if(r&&frame&&document.visibilityState==='visible'){
        if(frame.sequence!==r.sequence){
          r.sequence=frame.sequence;
          const projected=projection.frame(frame.left,frame.right);
          const pixels=projection.context.getImageData(0,0,256,256).data;
          const circle=projected.valid?threshold.frame(pixels,frame.at).brightness:0;
          const result=r.bank.frame(frame,circle,settings);
          if(result.valid){
            r.values=r.gestures.frame(frame,result.metrics,circle);
            r.context.push(frame,result.metrics);
          }else{r.values=r.gestures.empty();r.gestures.reset();r.context.reset();}
          if(frame.rms<1e-7){r.selector.reset();r.context.reset();r.recentGestures=[];pending.current?.abort();pending.current=null;}
          const snapshot=r.context.snapshot(r.recentGestures);
          if(snapshot&&frame.rms>1e-5&&!pending.current&&now>=r.nextRequest)void ask(snapshot,r);
          if(frame.sequence%5===0&&audio.current){timings.current.push(audio.current.timing(frame,performance.now()));if(timings.current.length>6000)timings.current.shift();}
        }
        const routed=r.selector.frame(r.values,frame.at),factor=blackRef.current?0:gainRef.current;
        const level=(displayRef.current==='jev'?routed.value:r.values.circle)*factor;
        paint(output.current,level);paint(circlePreview.current,r.values.circle*factor);paint(jevPreview.current,routed.value*factor);
        if(now-lastUi>150){
          lastUi=now;setReading({mode:routed.mode,focus:routed.focus,contrast:routed.contrast,level,circle:r.values.circle,fallback:routed.fallback,latency:r.latency,requests:r.requests,disposition:r.disposition});
        }
      }else{
        paint(output.current,0);paint(circlePreview.current,0);paint(jevPreview.current,0);
        if(r){
          r.context.reset();r.bank.reset();r.gestures.reset();r.selector.reset();r.recentGestures=[];r.values=r.gestures.empty();threshold.reset();
          if(now-lastUi>150){lastUi=now;setReading({...initial,latency:r.latency,requests:r.requests,disposition:'Waiting for fresh audio'});}
        }
      }
      raf=requestAnimationFrame(draw);
    }
    const onKey=(e:KeyboardEvent)=>{
      if(!document.fullscreenElement)return;
      if(e.code==='Space'){e.preventDefault();blackRef.current=!blackRef.current;setBlackout(blackRef.current);}
      if(e.key.toLowerCase()==='a'){displayRef.current='circle';setDisplay('circle');}
      if(e.key.toLowerCase()==='b'){displayRef.current='jev';setDisplay('jev');}
    };
    const onVisibility=()=>{if(document.visibilityState!=='visible'){pending.current?.abort();pending.current=null;}};
    document.addEventListener('keydown',onKey);document.addEventListener('visibilitychange',onVisibility);
    raf=requestAnimationFrame(draw);
    return()=>{
      cancelAnimationFrame(raf);document.removeEventListener('keydown',onKey);document.removeEventListener('visibilitychange',onVisibility);
      generation.current++;pending.current?.abort();audio.current?.stop();audio.current=null;
    };
  },[stop]);

  return <main className="jev-studio">
    <header><a href="/scope/styles">lightflow <span>/ jev</span></a><span className="jev-tag">Context experiment</span></header>
    <div className="jev-source"><span>{sourceName}</span><button disabled={busy} onClick={()=>void start(demo)}>Demo</button><label className="jev-file">Choose music<input aria-label="Choose music" type="file" accept="audio/*,video/*" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void start({kind:'file',file});e.target.value='';}}/></label><button disabled={busy} onClick={()=>void start({kind:'mic'})}>Mic</button><button disabled={busy} onClick={()=>void start({kind:'system'})}>System</button><button disabled={!active&&!busy} onClick={stop}>Stop</button></div>
    {error&&<p className="jev-error" role="alert">{error}</p>}
    <section className="jev-stage" ref={stage} aria-label="Brightness stage" onDoubleClick={fullscreen}>
      <div ref={output} className="jev-output" aria-label="Live brightness output" data-level="0.00000"/>
      <div className="jev-caption"><span>{display==='circle'?'Circle reference':`Jev / ${labels[reading.mode]} · ${labels[reading.focus]} · ${labels[reading.contrast]}`}</span><span>{reading.level.toFixed(3)}</span></div>
    </section>
    <div className="jev-controls"><div className="jev-switch" aria-label="Display comparison"><button aria-pressed={display==='circle'} onClick={()=>switchDisplay('circle')}>A · Circle</button><button aria-pressed={display==='jev'} onClick={()=>switchDisplay('jev')}>B · Jev</button></div><label>Brightness<input aria-label="Brightness" type="range" min="0" max="1" step=".01" value={gain} onChange={e=>{gainRef.current=Number(e.target.value);setGain(gainRef.current);}}/>{Math.round(gain*100)}%</label><button aria-pressed={blackout} onClick={toggleBlackout}>{blackout?'Restore':'Blackout'}</button><button onClick={fullscreen}>Fullscreen ↗</button></div>
    <section className="jev-readout" aria-label="Live decision">
      <div className="jev-decision"><p className="jev-eyebrow">{reading.fallback?'Scope gesture fallback':"Jev’s current choice"}</p><h1>{labels[reading.mode]} <small>{labels[reading.focus]} · {labels[reading.contrast]}</small></h1><p>{details[reading.mode]}</p><p className="jev-status" role="status">{!active?busy?'Starting audio…':'Ready when you are':reading.disposition==='accepted'?'Decision applied':reading.disposition==='uncertain'?'No clear choice · retaining the previous response briefly':reading.disposition==='stale'?'Late response ignored':reading.disposition==='unavailable'?'Decision unavailable':reading.disposition}</p></div>
      <div className="jev-mini"><div ref={circlePreview} aria-label="Circle preview"/><span>Circle</span></div><div className="jev-mini"><div ref={jevPreview} aria-label="Jev preview"/><span>Jev</span></div><canvas ref={scope} aria-label="Stereo scope reference"/>
    </section>
    <footer><span>{reading.latency===null?'Live audio drives each gesture':`${reading.latency} ms last control request · local audio updates every 20 ms`}</span><button disabled={!exportable} onClick={exportDecisions}>Export decisions</button></footer>
    <details className="jev-evidence"><summary>What Jev sees</summary><p>Audio stays in this browser. Measured summaries go to TypeSafe at up to two updates per second: the latest quarter-second, two seconds of phrase context, and earlier trends. Jev chooses a gesture, frequency focus, and contrast together. Each session stops after ten minutes.</p><dl>{Object.entries(observations).map(([key,value])=><div key={key}><dt>{key.replace(/[A-Z]/g,c=>' '+c.toLowerCase())}</dt><dd>{value}</dd></div>)}</dl>{decision&&<p>{Object.entries(decision.answers).map(([key,a])=>`${key}: ${labels[a.choice]} (${Math.round(a.confidence*100)}%)`).join(' · ')}. Confidence is the model’s certainty, not measured musical quality.</p>}<p>Current audio drives the light while Jev is thinking. A 60 ms transition connects new choices; late decisions are discarded. Network time is only part of the time needed to recognize a changed passage. This experiment does not predict future audio.</p><p>Fullscreen: A for Circle · B for Jev · Space for blackout · Esc to exit.</p></details>
  </main>;
}
