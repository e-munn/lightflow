'use client';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {Activity,AudioLines,Check,ChevronDown,ChevronLeft,ChevronRight,FolderOpen,Gauge,Lightbulb,Maximize2,Mic,Minimize2,MoreHorizontal,Power,Sparkles,Square,Sun,Waves,X} from 'lucide-react';
import Visual from '@/components/director/Visual';
import {IconButton,useFlashControls} from '@/components/lighting/FlashControls';
import {SCENES,initialCue,Score} from '@/lib/director/score';
import {DirectorAudio,type Prediction} from '@/lib/director/audio';
import {PhrasePlayer} from '@/lib/director/phrases';
import {RESPONSE_MODES,type ResponseMode} from '@/lib/director/response';
import '@/components/lighting/flash.css';
import './studio.css';

type Panel='looks'|'response'|'more'|null;
export default function Director(){
 const [cue,setCue]=useState(initialCue),[source,setSource]=useState('No audio connected'),[error,setError]=useState(''),[manual,setManual]=useState<number|null>(null),[blackout,setBlackout]=useState(false),[intensity,setIntensity]=useState(1.5),[modelState,setModelState]=useState('Model idle'),[latency,setLatency]=useState(0);
 const [offline,setOffline]=useState(''),[rawOutput,setRawOutput]=useState(true),[panel,setPanel]=useState<Panel>(null),[busy,setBusy]=useState(false),[response,setResponse]=useState<ResponseMode>('fast');
 const studio=useRef<HTMLElement>(null),fileInput=useRef<HTMLInputElement>(null),responseRef=useRef<ResponseMode>('fast'),rawRef=useRef(true);
 const {controlsVisible,isFullscreen}=useFlashControls(studio);
 const phrasePlayer=useRef<PhrasePlayer|null>(null),reactor=useRef<DirectorAudio|null>(null),score=useRef(new Score()),prediction=useRef<Prediction|null>(null),manualRef=useRef<number|null>(null),generation=useRef(0);
 const active=source!=='No audio connected';
 const modelIssue=modelState.startsWith('Model unavailable:');
 const rawLevel=blackout||!active?0:Math.max(0,Math.min(1,(cue.brightness+cue.accent*.15)*intensity));
 const responseConfig=RESPONSE_MODES[response];
 function closePanel(){setPanel(null);studio.current?.focus({preventScroll:true});}
 function togglePanel(next:Exclude<Panel,null>){setPanel(previous=>previous===next?null:next);}
 function setOutput(raw:boolean){rawRef.current=raw;setRawOutput(raw);}
 function selectScene(index:number){manualRef.current=index;setManual(index);setOutput(false);setCue(current=>({...current,previous:current.scene,scene:index,blend:1}));}
 function selectAutomatic(){manualRef.current=null;setManual(null);setOutput(false);}
 function changeResponse(value:ResponseMode){responseRef.current=value;setResponse(value);}
 async function fullscreen(){
  try{if(document.fullscreenElement===studio.current)await document.exitFullscreen();else{await studio.current?.requestFullscreen();studio.current?.focus({preventScroll:true});}}
  catch{setError('Fullscreen is unavailable');}
 }
 useEffect(()=>{
  if(!panel)return;
  const container=document.getElementById(`director-${panel}`);
  container?.querySelector<HTMLElement>('button[aria-pressed=true],button:not(:disabled)')?.focus({preventScroll:true});
 },[panel]);
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   const target=event.target as HTMLElement;
   if(event.code==='Escape'){closePanel();return;}
   if(event.metaKey||event.ctrlKey||event.altKey||target.closest('input,select,textarea,[contenteditable]'))return;
   if(event.code==='Space'&&!target.closest('button,a')){event.preventDefault();if(!event.repeat)setBlackout(value=>!value);}
   if(event.code==='KeyF'&&!event.repeat){event.preventDefault();void fullscreen();}
   if(!rawRef.current&&(event.code==='ArrowLeft'||event.code==='ArrowRight')){event.preventDefault();selectScene(((manualRef.current??score.current.cue.scene)+(event.code==='ArrowRight'?1:SCENES.length-1))%SCENES.length);}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[]);
 useEffect(()=>{
  if(process.env.NODE_ENV!=='production'||!('serviceWorker' in navigator))return;
  let mounted=true;
  navigator.serviceWorker.register('/director-sw.js',{scope:'/'}).then(async()=>{await navigator.serviceWorker.ready;if(mounted)setOffline('Ready offline');}).catch(()=>{if(mounted)setOffline('Offline cache unavailable');});
  return()=>{mounted=false;};
 },[]);
 useEffect(()=>{
  let raf=0,last=0;
  function tick(now:number){
   const r=reactor.current,mode=RESPONSE_MODES[responseRef.current];
   if(r&&now-last>(responseRef.current==='original'?33:16)){
    last=now;r.setLevelWindow(mode.levelSamples);
    const p=prediction.current,level=r.level;let controls:number[]|undefined;
    if(r.library&&!phrasePlayer.current)phrasePlayer.current=new PhrasePlayer(r.library);
    if(p){
     const phrase=p.logits?phrasePlayer.current?.update(r.time,p.logits,{...mode,predictionAt:p.at}):undefined;
     const [value,activity,entropy,hx,hy,coverage]=phrase??p.values;
     controls=[value,Math.min(1,.15+activity*3),entropy,(Math.atan2(hy-.5,hx-.5)/(2*Math.PI)+1)%1,coverage];
    }
    setCue(score.current.update(r.time,level,manualRef.current,controls,mode.brightnessSeconds));
   }
   raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);generation.current++;reactor.current?.stop();};
 },[]);
 function stop(){generation.current++;reactor.current?.stop();reactor.current=null;prediction.current=null;phrasePlayer.current=null;setSource('No audio connected');setCue(initialCue());score.current=new Score();setModelState('Model idle');setLatency(0);setBusy(false);}
 async function start(file?:File){
  stop();setError('');setBusy(true);const token=generation.current;
  try{
   const r=new DirectorAudio();reactor.current=r;setModelState('Loading local model…');
   await r.start(p=>{if(token!==generation.current)return;prediction.current=p;setLatency(p.ms);},state=>{if(token===generation.current)setModelState(state);},file);
   if(token===generation.current)setSource(file?.name??'Microphone · live');
  }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:'Audio could not start');}}
  finally{if(token===generation.current)setBusy(false);}
 }
 return <main ref={studio} tabIndex={-1} className={`flash-studio director-studio${controlsVisible||error||modelIssue?'':' flash-idle'}`}>
  <section className="flash-stage studio-stage" onPointerDown={closePanel} onDoubleClick={fullscreen} aria-label="Lighting output">
   {rawOutput?<div className="raw-light" aria-label="Raw white lighting output" data-level={rawLevel.toFixed(4)} style={{backgroundColor:`rgb(${Math.round(rawLevel*255)}, ${Math.round(rawLevel*255)}, ${Math.round(rawLevel*255)})`}}/>:<Visual cue={{...cue,brightness:cue.brightness*intensity,accent:cue.accent*intensity}} blackout={blackout||!active}/>}
  </section>
  <header className="flash-header flash-chrome" data-flash-ui>
   <Link className="flash-brand" href="/" prefetch={false} title="Lightflow home">lightflow<span> / director</span></Link>
   <h1 className="flash-sr-only">{rawOutput?'Raw white light':SCENES[cue.scene]}</h1>
   <div className="flash-status"><span className={`flash-status-dot${active?' is-live':''}`} aria-hidden="true"/><span role="status">{busy?'Connecting…':active?source:'Choose audio'}</span><span className="flash-readout">{rawOutput?`${Math.round(rawLevel*100)}%`:cue.section}</span></div>
  </header>
  {(error||modelIssue)&&<div className="flash-notice flash-error" data-flash-ui><p role="alert" title={modelIssue?modelState:undefined}>{error||'The AI model could not load. Using basic audio response. Restart audio to try again.'}</p>{error&&<IconButton label="Dismiss error" onClick={()=>setError('')}><X/></IconButton>}</div>}
  <div className="flash-controls flash-chrome" data-flash-ui>
   <section id="director-looks" className="flash-panel flash-recipes director-looks" hidden={panel!=='looks'} aria-label="Output and scenes">
    <div className="flash-panel-heading"><div><span className="flash-eyebrow">THE LOOK</span><h2>Light & motion</h2></div><IconButton label="Close scenes" onClick={closePanel}><X/></IconButton></div>
    <div className="director-mode-switch" role="group" aria-label="Output mode">
     <button aria-pressed={rawOutput} onClick={()=>setOutput(true)}><Lightbulb/><span>Raw white light<small>A single full-screen flash</small></span>{rawOutput&&<Check/>}</button>
     <button aria-pressed={!rawOutput} onClick={()=>setOutput(false)}><Waves/><span>Animations<small>Color, shape and movement</small></span>{!rawOutput&&<Check/>}</button>
    </div>
    <div className="director-scene-heading"><span className="flash-eyebrow">ANIMATED SCENES</span><button className="flash-text-button" aria-pressed={!rawOutput&&manual===null} onClick={selectAutomatic}><Sparkles/>Auto direct</button></div>
    <div className="flash-recipe-grid scene-bank" role="group" aria-label="Scenes">{SCENES.map((name,i)=><button className={`flash-recipe-card${!rawOutput&&cue.scene===i?' is-selected':''}`} key={name} aria-pressed={!rawOutput&&manual===i} aria-label={`${i+1}. ${name}`} onClick={()=>{selectScene(i);closePanel();}}><span className="flash-card-top"><span className="flash-card-number">{String(i+1).padStart(2,'0')}</span>{!rawOutput&&cue.scene===i&&<Check/>}</span><span className="flash-card-name">{name}</span></button>)}</div>
    <p className="flash-panel-footnote"><kbd>←</kbd> <kbd>→</kbd> switch scenes. Auto direct lets the director choose.</p>
   </section>
   <section id="director-response" className="flash-panel director-response" hidden={panel!=='response'} aria-label="Response speed settings">
    <div className="flash-panel-heading"><div><span className="flash-eyebrow">FEEL THE HIT</span><h2>Response speed</h2></div><IconButton label="Close response settings" onClick={closePanel}><X/></IconButton></div>
    <div className="director-response-options" role="group" aria-label="Response speed">{(Object.keys(RESPONSE_MODES) as ResponseMode[]).map(key=><button key={key} aria-pressed={response===key} onClick={()=>changeResponse(key)}>{RESPONSE_MODES[key].label}</button>)}</div>
    <p className="flash-description">{responseConfig.description}</p>
    <dl className="director-timing"><div><dt>Brightness smoothing</dt><dd>{Math.round(responseConfig.brightnessSeconds*1000)} ms</dd></div><div><dt>Pattern crossfade</dt><dd>{Math.round(responseConfig.blendSeconds*1000)} ms</dd></div></dl>
    <p className="flash-panel-footnote">Fast and Balanced can change patterns early when two model predictions agree. Original waits for each two-second pattern to finish.</p>
    <p className="flash-panel-footnote">These settings shape the response; they don’t measure microphone-to-screen delay.</p>
   </section>
   <section id="director-more" className="flash-panel flash-more" hidden={panel!=='more'} aria-label="Director details">
    <div className="flash-panel-heading"><h2>Director</h2><IconButton label="Close details" onClick={closePanel}><X/></IconButton></div>
    <div className="director-model-info"><Activity aria-hidden="true"/><div><p className="engine-note">{modelState}{latency>0?` · ${latency.toFixed(1)} ms inference`:''}</p><p>{offline||'Audio stays on this device'}</p></div></div>
    <div className="flash-menu-divider"/>
    <Link className="flash-menu-item" href="/scope/interplay" prefetch={false}><AudioLines/><span>Scope interplay<small>Explore the signal-driven responses</small></span></Link>
    <a className="flash-menu-item" href="https://huggingface.co/datasets/RS2002/RPMC-L2" target="_blank" rel="noreferrer"><Activity/><span>RPMC-L2 · CC BY 4.0<small>Concert lighting training data</small></span></a>
    <p className="flash-panel-footnote">Learned lighting patterns with programmed scene arrangement.</p>
   </section>
   <div className="flash-dock" role="group" aria-label="Director controls">
    <div className="flash-sources" role="group" aria-label="Audio input">
     <IconButton label="Listen to microphone" detail="Use your room’s live sound" disabled={busy} aria-pressed={source==='Microphone · live'} onClick={()=>start()}><Mic/></IconButton>
     <IconButton label="Open music" detail="Play a file from this device" disabled={busy} onClick={()=>fileInput.current?.click()}><FolderOpen/></IconButton>
     <input ref={fileInput} className="flash-file-input" tabIndex={-1} aria-label="Music file" type="file" accept="audio/*" onChange={e=>{const file=e.target.files?.[0];if(file)void start(file);e.target.value='';}}/>
     <IconButton label="Stop" detail="Stop audio and turn off the light" disabled={!active&&!busy} onClick={stop}><Square/></IconButton>
    </div>
    <div className="flash-recipe-selector" role="group" aria-label="Current output">
     <IconButton label="Previous scene" detail={rawOutput?'Choose Animations to change scenes':'Left arrow'} disabled={rawOutput} onClick={()=>selectScene((cue.scene+SCENES.length-1)%SCENES.length)}><ChevronLeft/></IconButton>
     <button className="flash-recipe-trigger" aria-label="Choose output and scene" aria-expanded={panel==='looks'} aria-controls="director-looks" onClick={()=>togglePanel('looks')}><span><strong>{rawOutput?'Raw white light':SCENES[cue.scene]}</strong><small>{blackout?'Blackout':rawOutput?'Learned lighting':manual===null?'Auto direct':'Manual scene'}</small></span><ChevronDown aria-hidden="true"/></button>
     <IconButton label="Next scene" detail={rawOutput?'Choose Animations to change scenes':'Right arrow'} disabled={rawOutput} onClick={()=>selectScene((cue.scene+1)%SCENES.length)}><ChevronRight/></IconButton>
    </div>
    <label className="flash-brightness" title="Output brightness · boost up to 300%"><Sun aria-hidden="true"/><input aria-label="Output brightness" type="range" min="0" max="3" step=".05" value={intensity} aria-valuetext={`${Math.round(intensity*100)} percent`} onChange={e=>setIntensity(+e.target.value)}/><output>{Math.round(intensity*100)}%</output></label>
    <div className="flash-actions">
     <IconButton label={blackout?'Restore light':'Blackout'} detail="Space" aria-pressed={blackout} onClick={()=>setBlackout(value=>!value)}><Power/></IconButton>
     <IconButton label="Response speed" detail={`${responseConfig.label} · adjust how quickly the light reacts`} aria-expanded={panel==='response'} aria-controls="director-response" onClick={()=>togglePanel('response')}><Gauge/></IconButton>
     <IconButton label={isFullscreen?'Exit fullscreen':'Fullscreen'} detail="F · Esc to exit" onClick={fullscreen}>{isFullscreen?<Minimize2/>:<Maximize2/>}</IconButton>
     <IconButton label="More options" detail="Model status and research" aria-expanded={panel==='more'} aria-controls="director-more" onClick={()=>togglePanel('more')}><MoreHorizontal/></IconButton>
    </div>
   </div>
   <p className="flash-idle-hint">Move or tap to show controls<span>·</span><kbd>Space</kbd> blackout<span>·</span><kbd>F</kbd> fullscreen</p>
  </div>
 </main>;
}
