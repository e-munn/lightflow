'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type Source} from '@/lib/scope/audio';
import {ScopeBrightness} from '../../../../public/scope-brightness.mjs';
import {RadialThreshold,THRESHOLD_DEFAULTS,THRESHOLD_VERSION,matchMeanBrightness} from '../../../../public/scope-threshold.mjs';
import '../scope.css';
import './threshold.css';

type Settings=typeof THRESHOLD_DEFAULTS;
type Reading=ReturnType<RadialThreshold['frame']>;
type Sample=Reading&{at:number;sourceSeconds:number|null;computeMs:number;graphAgeMs:number};
type Mark={at:string;verdict:string;source:Record<string,unknown>;session:string;settings:Settings;frames:Sample[]};
const FOREST:Source={kind:'url',url:'/api/scope-research/forest',name:'Electric Forest · 31:00',start:1860};
const ZERO={valid:true,baseline:0,brightness:0,rawBrightness:0,coverage:0,weightedCoverage:0,radius:.35,outsideFraction:0,q60:0};

export default function ThresholdPage(){
 const [settings,setSettings]=useState<Settings>({...THRESHOLD_DEFAULTS}),[reading,setReading]=useState<Reading>(ZERO),[status,setStatus]=useState('Choose music to begin'),[error,setError]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState(false),[matching,setMatching]=useState(false),[matchNote,setMatchNote]=useState(''),[savedMarks,setSavedMarks]=useState<Mark[]>([]),[canMark,setCanMark]=useState(false);
 const scope=useRef<HTMLCanvasElement>(null),baseline=useRef<HTMLCanvasElement>(null),candidate=useRef<HTMLCanvasElement>(null),trace=useRef<HTMLCanvasElement>(null);
 const engine=useRef<ScopeAudio|null>(null),lastSource=useRef<Source>(FOREST),sourceName=useRef(''),sourceIdentity=useRef<Record<string,unknown>>({}),generation=useRef(0),config=useRef({...THRESHOLD_DEFAULTS}),revision=useRef(0),recent=useRef<Sample[]>([]),calibration=useRef<{start:number|null;frames:Sample[]}|null>(null),marks=useRef<Mark[]>([]),session=useRef('');
 function change(patch:Partial<Settings>){const next={...config.current,...patch};config.current=next;revision.current++;setSettings(next);calibration.current=null;setMatching(false);setMatchNote('');recent.current=[];setCanMark(false);}
 function stop(){generation.current++;engine.current?.stop();engine.current=null;revision.current++;recent.current=[];calibration.current=null;setMatching(false);setBusy(false);setActive(false);setCanMark(false);setStatus('Stopped');}
 async function start(source:Source){stop();setError('');setBusy(true);lastSource.current=source;sourceName.current=source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind==='mic'?'Microphone':'System audio';
  sourceIdentity.current=source.kind==='file'?{kind:source.kind,name:source.file.name,size:source.file.size,lastModified:source.file.lastModified}:source;session.current=crypto.randomUUID();
  const token=generation.current,audio=new ScopeAudio({forecast:false});engine.current=audio;
  try{await audio.start(source,()=>{if(token===generation.current)stop();});if(token!==generation.current)return;setActive(true);setStatus(sourceName.current);}
  catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}
  finally{if(token===generation.current)setBusy(false);}
 }
 useEffect(()=>{
  const measure=document.createElement('canvas'),projection=new ScopeBrightness(measure),dynamics=new RadialThreshold();projection.soft=true;
  let raf=0,last=-1,seenRevision=-1,lastStats=0,current:Reading=ZERO;const history:Reading[]=[];
  function tick(){
   if(seenRevision!==revision.current){seenRevision=revision.current;dynamics.configure(config.current);last=-1;history.length=0;current=dynamics.empty(true);}
   const now=performance.now(),audio=engine.current,frame=audio?.frame(now);
   if(frame&&frame.sequence!==last){
    last=frame.sequence;const began=performance.now();const raw=projection.frame(frame.left,frame.right);
    if(!raw.valid)dynamics.reset();
    current=raw.valid?dynamics.frame(measure.getContext('2d')!.getImageData(0,0,256,256).data,frame.at):dynamics.empty(false);
    const sample:Sample={...current,at:frame.at,sourceSeconds:audio?.media&&audio.context?audio.media.currentTime-(audio.context.currentTime-frame.at)*audio.media.playbackRate:null,computeMs:performance.now()-began,graphAgeMs:audio?.timing(frame,performance.now()).sampleToGraphMs??0};
    recent.current.push(sample);while(recent.current.length>1500)recent.current.shift();history.push(current);if(history.length>400)history.shift();
    const collecting=calibration.current;
    if(collecting){collecting.start??=frame.at;collecting.frames.push(sample);if(frame.at-collecting.start>=5){
     const match=matchMeanBrightness(collecting.frames);calibration.current=null;setMatching(false);
     if(match){config.current={...config.current,makeup:match.gain};setSettings(config.current);revision.current++;recent.current=[];setMatchNote(`Fixed gain ${match.gain.toFixed(2)}× from the previous 5 seconds${match.limited?' · unable to fully match; try a smaller circle':''}. Replay to compare.`);}
     else setMatchNote('Too little activity survived the circle. Try a smaller radius and match again.');
    }}
    const canvas=scope.current;if(canvas){const g=canvas.getContext('2d')!;g.drawImage(measure,0,0,canvas.width,canvas.height);g.beginPath();g.arc(canvas.width/2,canvas.height/2,current.radius*canvas.width/2,0,Math.PI*2);g.strokeStyle='#edbd71';g.lineWidth=2;g.stroke();}
   }
   if(!frame){current=dynamics.empty(true);dynamics.reset();history.length=0;last=-1;recent.current=[];const g=scope.current?.getContext('2d');if(g){g.fillStyle='#000';g.fillRect(0,0,512,512);g.beginPath();g.arc(256,256,config.current.radius*256,0,Math.PI*2);g.strokeStyle='#edbd71';g.lineWidth=2;g.stroke();}if(calibration.current){calibration.current=null;setMatching(false);setMatchNote('Matching stopped because fresh audio ended.');}}
   for(const [canvas,value] of [[baseline.current,current.baseline],[candidate.current,current.brightness]] as const){if(canvas){const g=canvas.getContext('2d')!,v=Math.round(value*255);g.fillStyle=`rgb(${v} ${v} ${v})`;g.fillRect(0,0,canvas.width,canvas.height);}}
   const canvas=trace.current;if(canvas){const g=canvas.getContext('2d')!;g.fillStyle='#080d0f';g.fillRect(0,0,canvas.width,canvas.height);for(const [key,color] of [['baseline','#8ca2a0'],['brightness','#edbd71']] as const){g.strokeStyle=color;g.beginPath();history.forEach((v,i)=>{const x=canvas.width-(history.length-1-i)*canvas.width/400,y=(1-v[key])*(canvas.height-10)+5;if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();}}
   if(now-lastStats>100){setReading(current);setCanMark(!!frame&&recent.current.length>=50);lastStats=now;}raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);generation.current++;engine.current?.stop();};
 },[]);
 function mark(verdict:string){const entry={at:new Date().toISOString(),verdict,source:{...sourceIdentity.current},session:session.current,settings:{...config.current},frames:recent.current.slice(-250)};marks.current=[...marks.current,entry];setSavedMarks(marks.current);}
 function exportTrial(){const payload={version:THRESHOLD_VERSION,createdAt:new Date().toISOString(),automated:navigator.webdriver===true,modelEnabled:false,physicalLatencyMeasured:false,session:session.current,source:sourceIdentity.current,settings:config.current,calibration:matchNote,frames:recent.current,marks:marks.current};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='lightflow-circle-trial.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main className="scope-lab threshold-lab">
  <header><a href="/scope/styles">lightflow <span>/ circle</span></a><a className="threshold-nav" href="/scope/styles">10 signal styles ↗</a></header>
  <div className="threshold-intro"><h1>Circle response</h1><p>Adjust the boundary. Compare one brightness signal with its original.</p></div>
  <section className="scope-input"><button disabled={busy} onClick={()=>start(FOREST)}>Play Electric Forest</button><label className="scope-file">Open music<input type="file" accept="audio/*,video/mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void start({kind:'file',file});e.target.value='';}}/></label><button disabled={busy} onClick={()=>start({kind:'mic'})}>Microphone</button><button disabled={busy} onClick={()=>start({kind:'system'})}>System / tab audio</button><button disabled={busy||lastSource.current.kind==='mic'||lastSource.current.kind==='system'} onClick={()=>start(lastSource.current)}>Replay same audio</button><button onClick={stop}>Stop</button></section>
  <p role="status" className="threshold-status">{busy?'Connecting…':status}</p>{error&&<p role="alert">{error}</p>}
  <section className="threshold-views">
   <article><h2>Stereo scope + circle</h2><canvas ref={scope} width={512} height={512} aria-label="Stereo scope with circle threshold"/><p>Radius <strong data-testid="circle-radius">{Math.round(reading.radius*100)}%</strong> · {Math.round(reading.outsideFraction*100)}% of trace light outside</p></article>
   <article><h2>Original brightness</h2><canvas ref={baseline} width={512} height={512} aria-label="Original brightness"/><p data-testid="original-value">{reading.baseline.toFixed(3)}</p></article>
   <article><h2>Circle response</h2><canvas ref={candidate} width={512} height={512} aria-label="Circle response brightness"/><p data-testid="candidate-value">{reading.brightness.toFixed(3)} <button onClick={()=>candidate.current?.requestFullscreen().catch(()=>setError('Fullscreen unavailable'))}>Fullscreen</button></p></article>
  </section>
  <section className="threshold-controls" aria-label="Circle controls">
   <label>Circle radius · {Math.round(settings.radius*100)}%{settings.adaptive?' starting size':''}<input aria-label="Circle radius" type="range" min="3" max="120" step="1" value={settings.radius*100} onChange={e=>change({radius:Number(e.target.value)/100,makeup:1})}/></label>
   <label>Inside the circle<select value={settings.below} onChange={e=>change({below:e.target.value,makeup:1})}><option value="keep">Keep unchanged</option><option value="soft">Fade down gradually</option><option value="cut">Cut completely</option></select></label>
   <label>Outside the circle<select value={settings.above} onChange={e=>change({above:e.target.value,makeup:1})}><option value="keep">Keep unchanged</option><option value="compress">Compress large excursions</option><option value="expand">Emphasize large excursions</option></select></label>
   <label>Strength · {settings.ratio.toFixed(1)}<input aria-label="Dynamics strength" type="range" min="1" max="4" step=".1" value={settings.ratio} onChange={e=>change({ratio:Number(e.target.value),makeup:1})}/></label>
   <label className="threshold-toggle"><input type="checkbox" checked={settings.adaptive} onChange={e=>change({adaptive:e.target.checked,makeup:1})}/>Let the circle follow recent scope size</label>
   <label>Adapt over · {settings.adaptSeconds.toFixed(1)} s<input aria-label="Adaptation time" disabled={!settings.adaptive} type="range" min=".25" max="10" step=".25" value={settings.adaptSeconds} onChange={e=>change({adaptSeconds:Number(e.target.value),makeup:1})}/></label>
  </section>
  <div className="threshold-actions"><button onClick={()=>change({radius:.33,below:'soft',above:'expand',ratio:3.3,adaptive:false})}>Preferred circle · 33 / 3.3</button><button disabled={!active||matching} onClick={()=>{calibration.current={start:null,frames:[]};setMatching(true);setMatchNote('Collecting 5 seconds. The fitted gain will then stay fixed.');}}>Match average brightness</button><button onClick={()=>change({...THRESHOLD_DEFAULTS})}>Reset controls</button><span>{matching?'Matching…':`Output gain ${settings.makeup.toFixed(2)}×`}</span></div>{matchNote&&<p className="threshold-help" role="status">{matchNote}</p>}
  <details className="threshold-details"><summary>Response timing</summary><p>Start at zero to preserve immediate scope detail. Add release only if the boundary flickers too abruptly.</p><label>Attack · {settings.attackMs} ms<input aria-label="Attack time" type="range" min="0" max="200" step="5" value={settings.attackMs} onChange={e=>change({attackMs:Number(e.target.value)})}/></label><label>Release · {settings.releaseMs} ms<input aria-label="Release time" type="range" min="0" max="500" step="10" value={settings.releaseMs} onChange={e=>change({releaseMs:Number(e.target.value)})}/></label></details>
  <canvas ref={trace} width={1200} height={100} aria-label="Original and circle brightness history" className="threshold-trace"/><p className="threshold-help">Gray: original · amber: circle response · last 8 seconds</p>
  <section className="threshold-review" aria-label="Trial notes"><p>Judge specific details: clearer attacks, preserved quiet texture, useful darkness, and a natural release.</p><div className="threshold-actions"><button disabled={!canMark} onClick={()=>mark('clearer_detail')}>Clearer detail</button><button disabled={!canMark} onClick={()=>mark('lost_detail')}>Lost detail</button><button disabled={!canMark} onClick={()=>mark('no_meaningful_difference')}>No meaningful difference</button><button disabled={!canMark&&savedMarks.length===0} onClick={exportTrial}>Export trial</button><span>{savedMarks.length} marks this visit</span></div><p className="threshold-help">Marks keep the preceding five seconds and settings until you leave this page. Export the trial to retain them.</p></section>
  <details className="threshold-details"><summary>How to compare</summary><p>Replay one passage and change one parameter at a time. Try a fixed circle before adaptation. Match average brightness before judging detail. The circle measures distance from the scope center; it does not isolate an instrument. All controls affect light only.</p></details>
 </main>;
}
