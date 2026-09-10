'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import Visual from '@/components/director/Visual';
import {SCENES,initialCue,Score} from '@/lib/director/score';
import {DirectorAudio, type Prediction} from '@/lib/director/audio';
import './studio.css';
import {PhrasePlayer} from '@/lib/director/phrases';
export default function Director(){
 const [cue,setCue]=useState(initialCue),[source,setSource]=useState('No audio connected'),[error,setError]=useState(''),[manual,setManual]=useState<number|null>(null),[blackout,setBlackout]=useState(false),[intensity,setIntensity]=useState(.75),[modelState,setModelState]=useState('Model idle'),[latency,setLatency]=useState(0);
 const [offline,setOffline]=useState('');
 const [rawOutput,setRawOutput]=useState(true);
 const stage=useRef<HTMLElement|null>(null);
 const rawLevel=blackout||source==='No audio connected'?0:Math.max(0,Math.min(1,(cue.brightness+cue.accent*.15)*intensity));
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(document.fullscreenElement===stage.current&&event.code==='Space'){event.preventDefault();setBlackout(value=>!value);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 function fullscreen(){stage.current?.requestFullscreen().catch(()=>setError('Fullscreen is unavailable'));}
 useEffect(()=>{if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;let active=true;navigator.serviceWorker.register('/director-sw.js',{scope:'/'}).then(async()=>{await navigator.serviceWorker.ready;if(active)setOffline('Ready offline');}).catch(()=>{if(active)setOffline('Offline cache unavailable');});return()=>{active=false;};},[]);
 const phrasePlayer=useRef<PhrasePlayer|null>(null);
 const reactor=useRef<DirectorAudio|null>(null),score=useRef(new Score()),prediction=useRef<Prediction|null>(null),manualRef=useRef(manual),generation=useRef(0);
 useEffect(()=>{manualRef.current=manual;},[manual]);
 useEffect(()=>{let raf=0,last=0;function tick(now:number){const r=reactor.current;if(r&&now-last>33){last=now;const p=prediction.current;const level=r.level;let controls:number[]|undefined;
 if(r.library&&!phrasePlayer.current)phrasePlayer.current=new PhrasePlayer(r.library);
 if(p){const phrase=p.logits?phrasePlayer.current?.update(r.time,p.logits):undefined;const [value,activity,entropy,hx,hy,coverage]=phrase??p.values;controls=[value,Math.min(1,.15+activity*3),entropy,(Math.atan2(hy-.5,hx-.5)/(2*Math.PI)+1)%1,coverage];}
 setCue(score.current.update(r.time,level,manualRef.current,controls));}raf=requestAnimationFrame(tick);}raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);generation.current++;reactor.current?.stop();};},[]);
 function stop(){generation.current++;reactor.current?.stop();reactor.current=null;prediction.current=null;phrasePlayer.current=null;setSource('No audio connected');setCue(initialCue());score.current=new Score();setModelState('Model idle');setLatency(0);}
 async function start(file?:File){stop();setError('');const token=generation.current;try{const r=new DirectorAudio();reactor.current=r;setModelState('Loading local model…');await r.start(p=>{if(token!==generation.current)return;prediction.current=p;setLatency(p.ms);},s=>{if(token===generation.current)setModelState(s);},file);if(token===generation.current)setSource(file?.name??'Microphone · live');}catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:'Audio could not start');}}}
 return <main className="director-studio"><header className="studio-header"><Link href="/" prefetch={false}>lightflow<span> / director</span></Link><span className="status-dot">LOCAL AUDIO</span><button onClick={fullscreen}>Fullscreen ↗</button></header>
 <section ref={stage} className="studio-stage" onDoubleClick={fullscreen} aria-label="Lighting output">{rawOutput?<div className="raw-light" aria-label="Raw white lighting output" data-level={rawLevel.toFixed(4)} style={{backgroundColor:`rgb(${Math.round(rawLevel*255)}, ${Math.round(rawLevel*255)}, ${Math.round(rawLevel*255)})`}}/>:<><Visual cue={{...cue,brightness:cue.brightness*intensity,accent:cue.accent*intensity}} blackout={blackout}/><div className="stage-caption"><span>LIVE CANVAS / {String(cue.scene+1).padStart(2,'0')}</span><h1>{SCENES[cue.scene]}</h1><p>{cue.reason}</p></div><div className="stage-state">{cue.section}</div></>}</section>
 <section className="studio-controls"><div className="source-controls"><div><span className="eyebrow">INPUT</span><p>{source}</p></div><button className="primary" onClick={()=>start()}>Listen to microphone</button><label className="file-button">Open music<input type="file" accept="audio/*" onChange={e=>{const f=e.target.files?.[0];if(f)void start(f);e.target.value='';}}/></label><button onClick={stop}>Stop</button></div>
 {error&&<p role="alert" className="studio-error">{error}</p>}
 <div className="output-settings" role="group" aria-label="Output mode"><button aria-pressed={rawOutput} className={rawOutput?'selected':''} onClick={()=>setRawOutput(true)}>Raw white light</button><button aria-pressed={!rawOutput} className={!rawOutput?'selected':''} onClick={()=>setRawOutput(false)}>Animations</button><span>Fullscreen: Space for blackout · Esc to exit</span></div>
 <div className="director-settings">{!rawOutput&&<button className={manual===null?'selected':''} onClick={()=>setManual(null)}>Auto direct</button>}<label>Intensity <input type="range" min="0" max="1" step=".01" value={intensity} onChange={e=>setIntensity(+e.target.value)}/></label><button className={blackout?'selected':''} onClick={()=>setBlackout(!blackout)}>{blackout?'Restore output':'Blackout'}</button><span>{offline||"Audio stays on this device"}</span></div>
 {!rawOutput&&<div className="scene-bank">{SCENES.map((name,i)=><button key={name} aria-pressed={manual===i} className={cue.scene===i?'active-scene':''} onClick={()=>{setManual(i);setCue(c=>({...c,previous:c.scene,scene:i,blend:1}));}}><span>{String(i+1).padStart(2,'0')}</span>{name}</button>)}</div>}
 <p className="engine-note">{modelState}{latency>0?` · ${latency.toFixed(1)} ms inference`:""} · Learned lighting phrases; procedural scene arrangement. <a href="https://huggingface.co/datasets/RS2002/RPMC-L2" target="_blank" rel="noreferrer">RPMC-L2 · CC BY 4.0</a></p></section></main>;
}
