'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type Source} from '@/lib/scope/audio';
import {ScopeBrightness} from '../../../../public/scope-brightness.mjs';
import {RadialThreshold} from '../../../../public/scope-threshold.mjs';
import {AttitudeBank,defaultAttitudeSettings as engineSettings} from '../../../../public/scope-attitudes.mjs';
import {RECIPES as ATTITUDES,INTERPLAY_VERSION as ATTITUDES_VERSION,InterplayBank,defaultInterplaySettings as defaultAttitudeSettings} from '../../../../public/scope-interplay.mjs';
import '../styles/styles.css';
import './interplay.css';

type Settings=ReturnType<typeof defaultAttitudeSettings>;
type Sample={rms:number;music:number[];routes:ReturnType<InterplayBank['frame']>['routes'];cues:ReturnType<InterplayBank['frame']>['cues'];styleValues:number[];at:number;sourceSeconds:number|null;values:number[];metrics:ReturnType<AttitudeBank['frame']>['metrics'];computeMs:number;selected:string;displayGain:number;blackout:boolean;pageVisible:boolean};
type Choice={style:string;settings:Settings;source:Record<string,unknown>;at:string;frames:Sample[]};
const FOREST:Source={kind:'url',url:'/api/scope-research/forest',name:'Electric Forest · 31:00',start:1860};

export default function SignalInterplay(){
 const [routeLabels,setRouteLabels]=useState<string[]>(ATTITUDES.map(()=>'')),[routeReason,setRouteReason]=useState('Waiting for audio'),[selected,setSelected]=useState(0),[settings,setSettings]=useState<Settings>(defaultAttitudeSettings),[status,setStatus]=useState('Choose audio'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState(false),[level,setLevel]=useState(0),[gain,setGain]=useState(1),[blackout,setBlackout]=useState(false),[showScope,setShowScope]=useState(true),[note,setNote]=useState(''),[canMark,setCanMark]=useState(false);
 const stage=useRef<HTMLDivElement>(null),output=useRef<HTMLDivElement>(null),scopeCanvas=useRef<HTMLCanvasElement>(null),previews=useRef<(HTMLDivElement|null)[]>([]),traces=useRef<(HTMLCanvasElement|null)[]>([]);
 const audio=useRef<ScopeAudio|null>(null),generation=useRef(0),selection=useRef(0),config=useRef(defaultAttitudeSettings()),gainRef=useRef(1),blackRef=useRef(false),lastSource=useRef<Source>(FOREST),sourceIdentity=useRef<Record<string,unknown>>({}),recent=useRef<Sample[]>([]),choices=useRef<Choice[]>([]),revision=useRef(0);
 function choose(index:number){selection.current=index;setSelected(index);setNote('');}
 function full(){stage.current?.requestFullscreen().catch(()=>setError('Fullscreen unavailable in this browser'));}
 function toggleBlackout(){blackRef.current=!blackRef.current;setBlackout(blackRef.current);}
 function stop(){generation.current++;audio.current?.stop();audio.current=null;revision.current++;recent.current=[];setActive(false);setBusy(false);setCanMark(false);setStatus('Stopped');}
 async function start(source:Source){stop();setError('');setBusy(true);lastSource.current=source;sourceIdentity.current=source.kind==='file'?{kind:'file',name:source.file.name,size:source.file.size,lastModified:source.file.lastModified}:{...source};const token=generation.current,engine=new ScopeAudio({forecast:false,musicFeatures:true});audio.current=engine;
  try{await engine.start(source,()=>{if(token===generation.current)stop();});if(token!==generation.current)return;setActive(true);setStatus(source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Microphone':'System audio');}
  catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 function adjust(key:string,value:number){const id=ATTITUDES[selection.current].id;config.current={...config.current,[id]:{...config.current[id],[key]:value}};setSettings(config.current);recent.current=[];setCanMark(false);}
 useEffect(()=>{
  const measure=document.createElement('canvas'),projection=new ScopeBrightness(measure),radial=new RadialThreshold(),bank=new AttitudeBank(),router=new InterplayBank(),styleSettings=engineSettings();projection.soft=true;
  let raf=0,last=-1,lastRevision=-1,lastConfig='',lastStats=0,values=Array(ATTITUDES.length).fill(0),latestRoutes:ReturnType<InterplayBank['frame']>['routes']=[];const history:number[][]=Array.from({length:ATTITUDES.length},()=>[]);
  const key=(event:KeyboardEvent)=>{if(document.fullscreenElement!==stage.current)return;if(event.code==='Space'){event.preventDefault();toggleBlackout();}if(event.code==='ArrowRight'||event.code==='ArrowLeft'){event.preventDefault();choose((selection.current+(event.code==='ArrowRight'?1:ATTITUDES.length-1))%ATTITUDES.length);}};
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
   values.forEach((value,i)=>{const v=blackRef.current?0:Math.round(value*gainRef.current*255),preview=previews.current[i];if(preview){preview.style.backgroundColor=`rgb(${v}, ${v}, ${v})`;preview.dataset.level=value.toFixed(5);}
    const canvas=traces.current[i];if(canvas){const g=canvas.getContext('2d')!;g.clearRect(0,0,canvas.width,canvas.height);g.strokeStyle=i===selection.current?'#b9f3d3':'#60716d';g.lineWidth=1.4;g.beginPath();history[i].forEach((n,j)=>{const x=canvas.width-(history[i].length-1-j)*canvas.width/180,y=canvas.height-2-n*(canvas.height-4);if(j)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();}});
   const value=blackRef.current?0:values[selection.current]*gainRef.current,v=Math.round(value*255);if(output.current){output.current.style.backgroundColor=`rgb(${v}, ${v}, ${v})`;output.current.dataset.level=value.toFixed(5);}
   if(now-lastStats>100){setLevel(value);setRouteLabels(latestRoutes.map(r=>r.mode));setRouteReason(latestRoutes[selection.current]?.reason??'Waiting for audio');setCanMark(!!f&&recent.current.length>=50);lastStats=now;}raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',key);generation.current++;audio.current?.stop();};
 },[]);
 function keep(){choices.current.push({style:ATTITUDES[selection.current].id,settings:structuredClone(config.current),source:{...sourceIdentity.current},at:new Date().toISOString(),frames:recent.current.slice(-250)});setNote(`Saved ${ATTITUDES[selection.current].name} for this moment · export to keep it`);}
 function exportSession(){const record={version:ATTITUDES_VERSION,createdAt:new Date().toISOString(),automated:navigator.webdriver===true,trainedModel:false,physicalLatencyMeasured:false,source:sourceIdentity.current,settings:config.current,selected:ATTITUDES[selection.current].id,displayGain:gainRef.current,frames:recent.current,choices:choices.current};const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lightflow-interplays.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 const current=ATTITUDES[selected];
 return <main className="signal-studio interplay-studio">
  <header className="signal-header"><a href="/">lightflow<span> / interplay</span></a><div><a className="signal-link" href="/scope/phrase">Focused A/B</a><a className="signal-link" href="/scope/styles">Fixed styles</a><button onClick={full}>Fullscreen ↗</button></div></header>
  <div className="signal-source"><p role="status">{busy?'Connecting…':status}</p><button disabled={busy} onClick={()=>start(FOREST)}>Forest</button><label className="signal-file">Open music<input type="file" accept="audio/*,video/mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void start({kind:'file',file});e.target.value='';}}/></label><button disabled={busy} onClick={()=>start({kind:'mic'})}>Mic</button><button disabled={busy} onClick={()=>start({kind:'system'})}>System</button><button disabled={busy||lastSource.current.kind==='mic'||lastSource.current.kind==='system'} onClick={()=>start(lastSource.current)}>Replay</button><button onClick={stop}>Stop</button></div>
  {error&&<p role="alert" className="signal-error">{error}</p>}
  <section ref={stage} className="signal-stage" aria-label="Selected brightness display" onDoubleClick={full}><div ref={output} className="signal-output" aria-label="Live brightness output"/><div className="signal-stage-name"><span>{String(selected+1).padStart(2,'0')} / {current.name}</span><span>{routeLabels[selected]||"—"} · {level.toFixed(3)}</span></div></section>
  <section className="signal-tuning" aria-label="Selected variation controls"><div className="signal-description"><h1>{current.name}</h1><p>{current.description}</p><p className="interplay-reason" data-testid="route-reason">{routeLabels[selected]||"—"} · {routeReason}</p></div>{current.controls.map(c=><label key={current.id+c.key}>{c.label}<span>{c.key==='radius'?`${Math.round(settings[current.id][c.key]*100)}%`:`${Number(settings[current.id][c.key].toFixed(2))}${c.unit?' '+c.unit:''}`}</span><input aria-label={c.label} type="range" min={c.min} max={c.max} step={c.step} value={settings[current.id][c.key]} onChange={e=>adjust(c.key,Number(e.target.value))}/></label>)}<button onClick={()=>{config.current={...config.current,[current.id]:defaultAttitudeSettings()[current.id]};setSettings(config.current);recent.current=[];}}>Reset</button></section>
  <section className="signal-bank" aria-label="Eleven switching recipes">{ATTITUDES.map((style,i)=><button key={style.id} className={selected===i?'selected':''} aria-pressed={selected===i} aria-label={`${i+1}. ${style.name}`} onClick={()=>choose(i)} onDoubleClick={()=>{choose(i);full();}}><div className="signal-mini" ref={node=>{previews.current[i]=node;}} data-testid={`preview-${style.id}`}/><div className="signal-card-title"><span>{String(i+1).padStart(2,'0')}</span>{style.name}<small data-testid={`mode-${style.id}`}>{routeLabels[i]||"—"}</small></div><canvas ref={node=>{traces.current[i]=node;}} width={240} height={26} aria-label={`${style.name} brightness trace`}/></button>)}</section>
  <footer className="signal-footer"><label>Output<input aria-label="Output intensity" type="range" min="0" max="1" step=".01" value={gain} onChange={e=>{gainRef.current=Number(e.target.value);setGain(gainRef.current);}}/>{Math.round(gain*100)}%</label><button onClick={toggleBlackout} aria-pressed={blackout}>{blackout?'Restore':'Blackout'}</button><button onClick={()=>setShowScope(v=>!v)} aria-pressed={showScope}>Scope</button><button disabled={!canMark} onClick={keep}>Keep this moment</button><button disabled={!active&&choices.current.length===0} onClick={exportSession}>Export</button><span>Fullscreen: ← → styles · Space blackout · Esc exit</span></footer>
  {note&&<p className="signal-note" role="status">{note}</p>}
  <section className={`signal-reference${showScope?'':' collapsed'}`} aria-label="Scope reference"><canvas ref={scopeCanvas} width={200} height={200} aria-label="Stereo scope reference"/><div><p>{current.measure}</p><p>Your original interplay plus ten alternatives. Each recipe switches its own modes from the same live audio; one brightness channel is displayed.</p><p>Live routing prototypes, not a trained director. The mode label shows the active response. Listening still needs to establish which switches suit the song.</p></div></section>
 </main>;
}
