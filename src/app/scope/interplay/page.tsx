'use client';
import {useEffect,useRef,useState} from 'react';
import {IconButton,useFlashControls} from '@/components/lighting/FlashControls';
import {ArrowDownToLine,AudioLines,BookmarkPlus,ChartNoAxesCombined,Check,ChevronDown,ChevronLeft,ChevronRight,Columns2,FolderOpen,Maximize2,Mic,Minimize2,MonitorUp,MoreHorizontal,Play,Power,RotateCcw,SlidersHorizontal,Square,Sun,X} from 'lucide-react';
import {ScopeAudio,type Source} from '@/lib/scope/audio';
import {ScopeBrightness} from '../../../../public/scope-brightness.mjs';
import {RadialThreshold} from '../../../../public/scope-threshold.mjs';
import {AttitudeBank,defaultAttitudeSettings as engineSettings} from '../../../../public/scope-attitudes.mjs';
import {RECIPES as ATTITUDES,INTERPLAY_VERSION as ATTITUDES_VERSION,InterplayBank,defaultInterplaySettings as defaultAttitudeSettings} from '../../../../public/scope-interplay.mjs';
import '@/components/lighting/flash.css';

type Settings=ReturnType<typeof defaultAttitudeSettings>;
type Sample={rms:number;music:number[];routes:ReturnType<InterplayBank['frame']>['routes'];cues:ReturnType<InterplayBank['frame']>['cues'];styleValues:number[];at:number;sourceSeconds:number|null;values:number[];metrics:ReturnType<AttitudeBank['frame']>['metrics'];computeMs:number;selected:string;displayGain:number;blackout:boolean;pageVisible:boolean};
type Choice={style:string;settings:Settings;source:Record<string,unknown>;at:string;frames:Sample[]};
const FOREST:Source={kind:'url',url:'/api/scope-research/forest',name:'Electric Forest · 31:00',start:1860};
type Panel='recipes'|'tuning'|'scope'|'more'|null;

export default function SignalInterplay(){
 const [routeLabels,setRouteLabels]=useState<string[]>(ATTITUDES.map(()=>'')),[routeReason,setRouteReason]=useState('Waiting for audio'),[selected,setSelected]=useState(0),[settings,setSettings]=useState<Settings>(defaultAttitudeSettings),[status,setStatus]=useState('Choose audio'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState(false),[level,setLevel]=useState(0),[gain,setGain]=useState(1),[blackout,setBlackout]=useState(false),[note,setNote]=useState(''),[canMark,setCanMark]=useState(false);
 const [panel,setPanel]=useState<Panel>(null);
 const stage=useRef<HTMLElement>(null),fileInput=useRef<HTMLInputElement>(null),output=useRef<HTMLDivElement>(null),scopeCanvas=useRef<HTMLCanvasElement>(null),previews=useRef<(HTMLSpanElement|null)[]>([]),traces=useRef<(HTMLCanvasElement|null)[]>([]);
 const {controlsVisible,isFullscreen}=useFlashControls(stage);
 const audio=useRef<ScopeAudio|null>(null),generation=useRef(0),selection=useRef(0),config=useRef(defaultAttitudeSettings()),gainRef=useRef(1),blackRef=useRef(false),lastSource=useRef<Source>(FOREST),sourceIdentity=useRef<Record<string,unknown>>({}),recent=useRef<Sample[]>([]),choices=useRef<Choice[]>([]),revision=useRef(0);
 function choose(index:number){selection.current=index;setSelected(index);setNote('');}
 function selectRecipe(index:number){choose(index);setPanel(null);document.getElementById('recipe-trigger')?.focus({preventScroll:true});}
 function togglePanel(next:Exclude<Panel,null>){setPanel(previous=>previous===next?null:next);}
 function closePanel(){setPanel(null);stage.current?.focus({preventScroll:true});}
 async function full(){try{if(document.fullscreenElement===stage.current)await document.exitFullscreen();else{await stage.current?.requestFullscreen();stage.current?.focus({preventScroll:true});}}catch{setError('Fullscreen unavailable in this browser');}}
 function toggleBlackout(){blackRef.current=!blackRef.current;setBlackout(blackRef.current);}
 function stop(){generation.current++;audio.current?.stop();audio.current=null;revision.current++;recent.current=[];setActive(false);setBusy(false);setCanMark(false);setStatus('Stopped');}
 async function start(source:Source){stop();setError('');setBusy(true);lastSource.current=source;sourceIdentity.current=source.kind==='file'?{kind:'file',name:source.file.name,size:source.file.size,lastModified:source.file.lastModified}:{...source};const token=generation.current,engine=new ScopeAudio({forecast:false,musicFeatures:true});audio.current=engine;
  try{await engine.start(source,()=>{if(token===generation.current)stop();});if(token!==generation.current)return;setActive(true);setStatus(source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Microphone':'System audio');}
  catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 function adjust(key:string,value:number){const id=ATTITUDES[selection.current].id;config.current={...config.current,[id]:{...config.current[id],[key]:value}};setSettings(config.current);recent.current=[];setCanMark(false);}
 useEffect(()=>{if(!note)return;const timer=setTimeout(()=>setNote(''),5000);return()=>clearTimeout(timer);},[note]);
 useEffect(()=>{
  if(!panel)return;
  const container=document.getElementById(`flash-${panel}`);
  const selector=panel==='recipes'?'button[aria-pressed=true]':panel==='tuning'?'input':'button:not(:disabled)';
  container?.querySelector<HTMLElement>(selector)?.focus({preventScroll:true});
 },[panel]);
 useEffect(()=>{
  const measure=document.createElement('canvas'),projection=new ScopeBrightness(measure),radial=new RadialThreshold(),bank=new AttitudeBank(),router=new InterplayBank(),styleSettings=engineSettings();projection.soft=true;
  let raf=0,last=-1,lastRevision=-1,lastConfig='',lastStats=0,values=Array(ATTITUDES.length).fill(0),latestRoutes:ReturnType<InterplayBank['frame']>['routes']=[];const history:number[][]=Array.from({length:ATTITUDES.length},()=>[]);
  const key=(event:KeyboardEvent)=>{
   const target=event.target as HTMLElement;
   if(event.code==='Escape'){closePanel();return;}
   if(event.metaKey||event.ctrlKey||event.altKey||target.closest('input,select,textarea,[contenteditable]'))return;
   if(event.code==='Space'&&!target.closest('button,a')){event.preventDefault();if(!event.repeat)toggleBlackout();}
   if(event.code==='ArrowRight'||event.code==='ArrowLeft'){event.preventDefault();choose((selection.current+(event.code==='ArrowRight'?1:ATTITUDES.length-1))%ATTITUDES.length);}
   if(event.code==='KeyF'&&!event.repeat){event.preventDefault();void full();}
  };
  window.addEventListener('keydown',key);
  function tick(){
   if(revision.current!==lastRevision){bank.reset();router.reset();radial.reset();last=-1;lastRevision=revision.current;history.forEach(h=>h.length=0);}
   const now=performance.now(),engine=audio.current,f=engine?.frame(now);
   if(f&&f.sequence!==last){last=f.sequence;const began=performance.now(),circle=styleSettings.circle,key=`${circle.radius}:${circle.strength}`;
    if(key!==lastConfig){radial.configure({radius:circle.radius,below:'soft',above:'expand',ratio:circle.strength,adaptive:false,attackMs:0,releaseMs:0,makeup:1});lastConfig=key;}
    const raw=projection.frame(f.left,f.right);
    const radialFrame=raw.valid?radial.frame(measure.getContext('2d')!.getImageData(0,0,256,256).data,f.at):radial.empty(false);
    const result=bank.frame(f,radialFrame.brightness,styleSettings),routed=router.frame(f,result,config.current);values=routed.values;latestRoutes=routed.routes;
    const sample:Sample={rms:f.rms,music:Array.from(f.music??[]),routes:routed.routes,cues:routed.cues,styleValues:result.values,at:f.at,sourceSeconds:engine?.media&&engine.context?engine.media.currentTime-(engine.context.currentTime-f.at)*engine.media.playbackRate:null,values,metrics:result.metrics,computeMs:performance.now()-began,selected:ATTITUDES[selection.current].id,displayGain:gainRef.current,blackout:blackRef.current,pageVisible:document.visibilityState==='visible'};recent.current.push(sample);while(recent.current.length>1500)recent.current.shift();
    values.forEach((v,i)=>{history[i].push(v);if(history[i].length>180)history[i].shift();});
    const canvas=scopeCanvas.current;if(canvas){const g=canvas.getContext('2d')!;g.drawImage(measure,0,0,canvas.width,canvas.height);g.strokeStyle='#b9f3d3';g.lineWidth=1;g.beginPath();g.arc(canvas.width/2,canvas.height/2,circle.radius*canvas.width/2,0,Math.PI*2);g.stroke();}
   }
   if(!f){bank.reset();router.reset();radial.reset();last=-1;values=Array(ATTITUDES.length).fill(0);latestRoutes=[];history.forEach(h=>h.length=0);recent.current=[];const canvas=scopeCanvas.current;canvas?.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);}
   values.forEach((value,i)=>{const v=blackRef.current?0:Math.round(Math.min(1,Math.max(0,value*gainRef.current))*255),preview=previews.current[i];if(preview){preview.style.backgroundColor=`rgb(${v}, ${v}, ${v})`;preview.dataset.level=value.toFixed(5);}
    const canvas=traces.current[i];if(canvas){const g=canvas.getContext('2d')!;g.clearRect(0,0,canvas.width,canvas.height);g.strokeStyle=i===selection.current?'#b9f3d3':'#60716d';g.lineWidth=1.4;g.beginPath();history[i].forEach((n,j)=>{const x=canvas.width-(history[i].length-1-j)*canvas.width/180,y=canvas.height-2-n*(canvas.height-4);if(j)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();}});
   const value=blackRef.current?0:Math.min(1,Math.max(0,values[selection.current]*gainRef.current)),v=Math.round(value*255);if(output.current){output.current.style.backgroundColor=`rgb(${v}, ${v}, ${v})`;output.current.dataset.level=value.toFixed(5);}
   if(now-lastStats>100){setLevel(value);setRouteLabels(latestRoutes.map(r=>r.mode));setRouteReason(latestRoutes[selection.current]?.reason??'Waiting for audio');setCanMark(!!f&&recent.current.length>=50);lastStats=now;}raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',key);generation.current++;audio.current?.stop();};
 },[]);
 function keep(){choices.current.push({style:ATTITUDES[selection.current].id,settings:structuredClone(config.current),source:{...sourceIdentity.current},at:new Date().toISOString(),frames:recent.current.slice(-250)});setNote(`Saved ${ATTITUDES[selection.current].name} for this moment · export to keep it`);}
 function exportSession(){const record={version:ATTITUDES_VERSION,createdAt:new Date().toISOString(),automated:navigator.webdriver===true,trainedModel:false,physicalLatencyMeasured:false,source:sourceIdentity.current,settings:config.current,selected:ATTITUDES[selection.current].id,displayGain:gainRef.current,frames:recent.current,choices:choices.current};const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lightflow-interplays.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const current=ATTITUDES[selected];
 return <main ref={stage} tabIndex={-1} className={`flash-studio${controlsVisible||error?'':' flash-idle'}`}>
  <section className="flash-stage" aria-label="Selected brightness display" onPointerDown={()=>{closePanel();}} onDoubleClick={full}>
   <div ref={output} className="signal-output" aria-label="Live brightness output"/>
  </section>
  <header className="flash-header flash-chrome" data-flash-ui>
   <a className="flash-brand" href="/" title="Lightflow home">lightflow<span> / live</span></a>
   <h1 className="flash-sr-only">{current.name}</h1>
   <div className="flash-status"><span className={`flash-status-dot${active?' is-live':''}`} aria-hidden="true"/><span role="status">{busy?'Connecting…':status}</span><span className="flash-readout" aria-label="Current brightness">{Math.round(level*100)}%</span></div>
  </header>
  {error&&<div className="flash-notice flash-error" data-flash-ui><p role="alert">{error}</p><IconButton label="Dismiss error" onClick={()=>setError('')}><X/></IconButton></div>}
  {note&&<div className="flash-notice flash-note" role="status"><Check aria-hidden="true"/>{note}</div>}
  <div className="flash-controls flash-chrome" data-flash-ui>
   <section id="flash-recipes" className="flash-panel flash-recipes" hidden={panel!=='recipes'} aria-label="Eleven switching recipes">
    <div className="flash-panel-heading"><div><span className="flash-eyebrow">LIVE RESPONSES</span><h2>Find your feel</h2></div><IconButton label="Close styles" onClick={closePanel}><X/></IconButton></div>
    <div className="flash-recipe-grid">{ATTITUDES.map((style,i)=><button type="button" key={style.id} className={`flash-recipe-card${selected===i?' is-selected':''}`} aria-pressed={selected===i} aria-label={`${i+1}. ${style.name}`} title={style.description} onClick={()=>selectRecipe(i)}>
     <div className="flash-card-top"><span className="signal-mini" ref={node=>{previews.current[i]=node;}} data-testid={`preview-${style.id}`}/><span className="flash-card-number">{String(i+1).padStart(2,'0')}</span>{selected===i&&<Check aria-hidden="true"/>}</div>
     <span className="flash-card-name">{style.name}</span><small data-testid={`mode-${style.id}`}>{routeLabels[i]||'Ready'}</small><canvas ref={node=>{traces.current[i]=node;}} width={240} height={26} aria-label={`${style.name} brightness trace`}/>
    </button>)}</div><p className="flash-panel-footnote">Use <kbd>←</kbd> <kbd>→</kbd> to switch while watching.</p>
   </section>
   <section id="flash-tuning" className="flash-panel flash-tuning" hidden={panel!=='tuning'} aria-label="Selected variation controls">
    <div className="flash-panel-heading"><div><span className="flash-eyebrow">FINE TUNE</span><h2>{current.name}</h2></div><IconButton label="Close tuning" onClick={closePanel}><X/></IconButton></div>
    <p className="flash-description">{current.description}</p>
    <p className="flash-route" data-testid="route-reason"><span>{routeLabels[selected]||'Ready'}</span>{routeReason}</p>
    {current.controls.map(c=><label className="flash-parameter" key={current.id+c.key}><span>{c.label}</span><output>{c.key==='radius'?`${Math.round(settings[current.id][c.key]*100)}%`:`${Number(settings[current.id][c.key].toFixed(2))}${c.unit?' '+c.unit:''}`}</output><input aria-label={c.label} type="range" min={c.min} max={c.max} step={c.step} value={settings[current.id][c.key]} onChange={e=>adjust(c.key,Number(e.target.value))}/></label>)}
    <button type="button" className="flash-text-button" onClick={()=>{config.current={...config.current,[current.id]:defaultAttitudeSettings()[current.id]};setSettings(config.current);recent.current=[];setCanMark(false);}}><RotateCcw aria-hidden="true"/>Reset this style</button>
   </section>
   <section id="flash-scope" className="flash-panel flash-scope" hidden={panel!=='scope'} aria-label="Scope reference">
    <div className="flash-panel-heading"><div><span className="flash-eyebrow">AUDIO IN</span><h2>Stereo scope</h2></div><IconButton label="Close scope" onClick={closePanel}><X/></IconButton></div>
    <canvas ref={scopeCanvas} width={200} height={200} aria-label="Stereo scope reference"/>
    <p className="flash-description">{current.measure}</p>
   </section>
   <section id="flash-more" className="flash-panel flash-more" hidden={panel!=='more'} aria-label="More options">
    <div className="flash-panel-heading"><h2>More options</h2><IconButton label="Close options" onClick={closePanel}><X/></IconButton></div>
    <button className="flash-menu-item" disabled={busy} onClick={()=>{setPanel(null);void start(FOREST);}}><Play/><span>Play Forest excerpt<small>Requires the research drive</small></span></button>
    <button className="flash-menu-item" disabled={busy||lastSource.current.kind==='mic'||lastSource.current.kind==='system'} onClick={()=>{setPanel(null);void start(lastSource.current);}}><RotateCcw/><span>Replay audio<small>Restart the current file or excerpt</small></span></button>
    <div className="flash-menu-divider"/>
    <button className="flash-menu-item" disabled={!canMark} onClick={keep}><BookmarkPlus/><span>Keep this moment<small>Mark this response for your review</small></span></button>
    <button className="flash-menu-item" disabled={!active&&choices.current.length===0} onClick={exportSession}><ArrowDownToLine/><span>Export session<small>Save your signals, settings and marks</small></span></button>
    <div className="flash-menu-divider"/>
    <a className="flash-menu-item" href="/scope/styles"><AudioLines/><span>Fixed styles</span></a>
    <a className="flash-menu-item" href="/scope/phrase"><Columns2/><span>Focused A/B comparison</span></a>
    <p className="flash-panel-footnote">Experimental live responses. Audio stays on your device.</p>
   </section>
   <div className="flash-dock" role="group" aria-label="Live lighting controls">
    <div className="flash-sources" role="group" aria-label="Audio input">
     <IconButton label="Microphone" detail="Use your room’s live sound" disabled={busy} aria-pressed={active&&lastSource.current.kind==='mic'} onClick={()=>start({kind:'mic'})}><Mic/></IconButton>
     <IconButton label="System audio" detail="Capture shared tab or system audio" disabled={busy} aria-pressed={active&&lastSource.current.kind==='system'} onClick={()=>start({kind:'system'})}><MonitorUp/></IconButton>
     <IconButton label="Open music" detail="Play an audio file from this device" disabled={busy} onClick={()=>fileInput.current?.click()}><FolderOpen/></IconButton>
     <input ref={fileInput} className="flash-file-input" tabIndex={-1} aria-label="Music file" type="file" accept="audio/*,video/mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void start({kind:'file',file});e.target.value='';}}/>
     <IconButton label="Stop" detail="Stop audio and turn off the light" disabled={!active&&!busy} onClick={stop}><Square/></IconButton>
    </div>
    <div className="flash-recipe-selector" role="group" aria-label="Selected style">
     <IconButton label="Previous style" detail="Left arrow" onClick={()=>choose((selection.current+ATTITUDES.length-1)%ATTITUDES.length)}><ChevronLeft/></IconButton>
     <button id="recipe-trigger" className="flash-recipe-trigger" aria-label={`Choose style: ${current.name}`} title={`${current.name} — ${current.description}`} aria-expanded={panel==='recipes'} aria-controls="flash-recipes" onClick={()=>togglePanel('recipes')}><span><strong>{current.name}</strong><small>{blackout?'Blackout':routeLabels[selected]||'Choose a response'}</small></span><ChevronDown aria-hidden="true"/></button>
     <IconButton label="Next style" detail="Right arrow" onClick={()=>choose((selection.current+1)%ATTITUDES.length)}><ChevronRight/></IconButton>
    </div>
    <label className="flash-brightness" title="Output brightness · boost up to 300%"><Sun aria-hidden="true"/><input aria-label="Output brightness" aria-valuetext={`${Math.round(gain*100)} percent`} type="range" min="0" max="3" step=".05" value={gain} onChange={e=>{gainRef.current=Number(e.target.value);setGain(gainRef.current);}}/><output>{Math.round(gain*100)}%</output></label>
    <div className="flash-actions">
     <IconButton label={blackout?'Restore light':'Blackout'} detail="Space" aria-pressed={blackout} onClick={toggleBlackout}><Power/></IconButton>
     <IconButton label="Tune style" detail="Adjust this response’s two controls" aria-expanded={panel==='tuning'} aria-controls="flash-tuning" onClick={()=>togglePanel('tuning')}><SlidersHorizontal/></IconButton>
     <IconButton label="Show scope" detail="Inspect the incoming stereo signal" aria-expanded={panel==='scope'} aria-controls="flash-scope" onClick={()=>togglePanel('scope')}><ChartNoAxesCombined/></IconButton>
     <IconButton label={isFullscreen?'Exit fullscreen':'Fullscreen'} detail="F · Esc to exit" onClick={full}>{isFullscreen?<Minimize2/>:<Maximize2/>}</IconButton>
     <IconButton label="More options" detail="Replay, save moments and export" aria-expanded={panel==='more'} aria-controls="flash-more" onClick={()=>togglePanel('more')}><MoreHorizontal/></IconButton>
    </div>
   </div>
   <p className="flash-idle-hint">Move or tap to show controls<span>·</span><kbd>Space</kbd> blackout<span>·</span><kbd>←</kbd><kbd>→</kbd> styles</p>
  </div>
 </main>;
}
