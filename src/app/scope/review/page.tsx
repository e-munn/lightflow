'use client';
import {useEffect,useRef,useState} from 'react';
import {ScopeAudio,type Source} from '@/lib/scope/audio';
import '../scope.css';
import './review.css';

type Trial={evaluationVersion:2;automated:boolean;visibleOnly:true;interruptedFrames:number;id:string;order:number[];source:string;heardBefore:string;started:string;readySeconds:number;modelHash:string;errors:string[];resets:number;drops:number;model:string};
type RecordRow={trial:Trial;ratings:Record<string,string>;notes:string;finished:string;humanSubmitted:true;physicalTimingMeasured:false};
const METHODS=['direct','learned','instant_context','delayed_model'];
const STORE='lightflow-blind-review-v1';
const QUESTIONS=[['overall','Which feels more musical overall?'],['timing','Which follows accents and changes more precisely?'],['detail','Which preserves small musical details better?'],['phrasing','Which handles builds, quiet moments and phrase changes better?']];
function randomInt(n:number){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]%n;}
export default function Review(){
 const audio=useRef<ScopeAudio|null>(null),generation=useRef(0),panels=useRef<(HTMLCanvasElement|null)[]>([]),trial=useRef<Trial|null>(null),lastAt=useRef<number|null>(null);
 const [status,setStatus]=useState('Choose a song you have not used to tune the model.'),[active,setActive]=useState(false),[busy,setBusy]=useState(false),[finished,setFinished]=useState(false),[seconds,setSeconds]=useState(0),[error,setError]=useState(''),[rows,setRows]=useState<RecordRow[]>([]),[ratings,setRatings]=useState<Record<string,string>>({}),[notes,setNotes]=useState(''),[heard,setHeard]=useState('unfamiliar'),[saved,setSaved]=useState(false),[reveal,setReveal]=useState(false);
 useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(STORE)??'[]');if(Array.isArray(value))setRows(value);}catch{setError('Saved review history could not be read. Export new reviews before leaving.');}},[]);
 function stop(complete=false){generation.current++;audio.current?.stop();audio.current=null;lastAt.current=null;setActive(false);setBusy(false);setFinished(complete);setStatus(complete?'Playback finished. Record your judgment before revealing identities.':'Stopped. Start a new excerpt to compare.');}
 async function start(source:Source){
  document.querySelectorAll<HTMLVideoElement>('.review-videos video').forEach(v=>v.pause());
  stop();setFinished(false);setSaved(false);setReveal(false);setRatings({});setNotes('');setSeconds(0);setError('');setBusy(true);
  const token=generation.current;const comparator=[0,2,3][randomInt(3)],order=randomInt(2)?[1,comparator]:[comparator,1];
  const t:Trial={evaluationVersion:2,automated:navigator.webdriver===true,visibleOnly:true,interruptedFrames:0,id:crypto.randomUUID(),order,source:source.kind==='file'?source.file.name:source.kind==='url'?source.name:source.kind,heardBefore:heard,started:new Date().toISOString(),readySeconds:0,modelHash:'',errors:[],resets:0,drops:0,model:'native-cue-gain-v1'};trial.current=t;
  try{
   const bundle=await fetch('/api/scope-research/cue-model',{cache:'no-store'});if(!bundle.ok)throw Error('The trained model is unavailable. This trial cannot use a fallback.');
   const content=await bundle.json();const bytes=new TextEncoder().encode(JSON.stringify(content.model));t.modelHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(token!==generation.current)return;
   const engine=new ScopeAudio({cueComparison:true});audio.current=engine;
   await engine.start(source,()=>{if(token===generation.current)stop(t.readySeconds>=20);});
   if(token!==generation.current)return;if(engine.modelError)throw Error(engine.modelError);
   setActive(true);setStatus('Listening for context. Both panels stay dark until every comparison is ready.');
  }catch(e){if(token===generation.current){const message=e instanceof Error?e.message:String(e);t.errors.push(message);stop();setError(message);}}
  finally{if(token===generation.current)setBusy(false);}
 }
 useEffect(()=>{
  let raf=0,lastUi=0;
  function tick(now:number){
   // rAF timestamps can predate newly delivered audio messages; sample the clock at use.
   now=performance.now();
   const engine=audio.current,frame=engine?.frame(now),t=trial.current;
   const fresh=frame&&now-frame.received<500;
   const visible=document.visibilityState==='visible'&&panels.current.length===2&&panels.current.every(canvas=>{if(!canvas)return false;const r=canvas.getBoundingClientRect();const area=r.width*r.height;const shown=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));return area>0&&shown/area>=.9;});
   const ready=!!(fresh&&frame.cue?.delayedReady&&t&&!engine?.modelError);
   const eligible=ready&&visible;
   if(engine?.modelError&&t&&!t.errors.includes(engine.modelError)){t.errors.push(engine.modelError);setError(engine.modelError);}
   if(eligible&&frame&&t){
    if(lastAt.current!==null){const step=frame.at-lastAt.current;if(step>0&&step<=.1)t.readySeconds+=step;else if(step>.1)t.interruptedFrames++;}
    lastAt.current=frame.at;t.resets=frame.cue?.resets??0;t.drops=engine?.dropped??0;
   }else lastAt.current=null;
   if(engine&&t){t.resets=frame?.cue?.resets??t.resets;t.drops=engine.dropped;}
   for(let i=0;i<2;i++){
    const canvas=panels.current[i];if(!canvas)continue;const g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;g.fillStyle='#000';g.fillRect(0,0,w,h);
    const value=ready&&frame&&t?frame.cue?.output[t.order[i]]:undefined;if(!value)continue;
    const [intensity,hue,spread,texture,balance]=Array.from(value);
    g.fillStyle=`hsl(${hue*360} 55% ${intensity*75}%)`;g.fillRect(0,0,w,h*.47);
    for(let j=0;j<8;j++){const envelope=Math.exp(-.5*(((j+.5)/8-(.5+balance*.36))/(.1+spread*.55))**2),detail=1-texture*.45+(j%2)*texture*.45;g.fillStyle=`hsl(${hue*360} 55% ${intensity*(.18+.82*envelope)*detail*80}%)`;g.fillRect(j*w/8+5,h*.55,w/8-10,h*.4);}
   }
   if(engine&&t&&now-lastUi>250){lastUi=now;setSeconds(t.readySeconds);setStatus(ready&&!visible?'Keep both views on screen to count comparison time.':ready?`Comparing A and B · ${Math.floor(t.readySeconds)} seconds compared`:`Preparing context · ${Math.max(0,42.5-(frame?.cue?.audioFrames??0)/50).toFixed(1)} seconds remain`);}
   raf=requestAnimationFrame(tick);
  }
  raf=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(raf);generation.current++;audio.current?.stop();};
 },[]);
 function save(){
  const t=trial.current;if(!t||!finished||t.readySeconds<20||t.errors.length||QUESTIONS.some(([key])=>!ratings[key])||saved)return;
  const record:RecordRow={trial:{...t,order:[...t.order],errors:[...t.errors]},ratings:{...ratings},notes,finished:new Date().toISOString(),humanSubmitted:true,physicalTimingMeasured:false};
  const updated=[...rows,record];setRows(updated);setSaved(true);
  try{localStorage.setItem(STORE,JSON.stringify(updated));}catch{setError('Browser storage is unavailable. Export these judgments now to keep them.');}
 }
 function exportRows(){const blob=new Blob([JSON.stringify({version:1,methods:METHODS,modelScope:'Experimental bounded brightness/spread modulation; not complete director',records:rows},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='lightflow-human-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <main className="scope-lab review-lab"><header><a href="/scope/modulation">lightflow / listening review</a><span>VIDEO PREVIEWS & LIVE REVIEW</span></header>
 <section className="review-previews"><p><a href="/scope/brightness">Current experiment: return to the live stereo scope →</a></p><p className="scope-kicker">SUPERSEDED / VOLUME BASELINE</p><h1>One signal. Brightness.</h1><p>One uniform field, driven by one brightness value from 0 to 1. The trace shows that exact signal over time. This first version is a direct audio baseline, not the trained or predictive model.</p><div className="review-videos review-featured"><article><video controls playsInline preload="metadata" aria-label="Single brightness signal" src="/api/scope-research/brightness" onPlay={e=>{stop();document.querySelectorAll<HTMLVideoElement>(".review-videos video").forEach(v=>{if(v!==e.currentTarget)v.pause();});}} onError={()=>setError("Connect ExtremePro to load the new comparison video.")}/><p>Of The Trees · Electric Forest · 60 seconds with original audio. Use the video fullscreen control for a larger view. Judge the timing and expression of brightness alone.</p></article></div></section>
 <details><summary>Previous combined prototype — superseded</summary> <section className="review-previews"><p className="scope-kicker">NEW / COORDINATED PROTOTYPE</p><h2>Previous combined prototype</h2><p>Sustained light, energy-driven builds, accents and moving groups now blend in one view. This is an authored audio-driven prototype, not a trained or predictive model.</p><div className="review-videos review-featured"><article><video controls playsInline preload="metadata" aria-label="Coordinated lighting prototype" src="/api/scope-research/coordinated" onPlay={e=>{stop();document.querySelectorAll<HTMLVideoElement>(".review-videos video").forEach(v=>{if(v!==e.currentTarget)v.pause();});}} onError={()=>setError("Connect ExtremePro to load the new comparison video.")}/><p>Of The Trees · Electric Forest · 60 seconds with original audio. Notice moments that feel connected to the music, or arbitrary. A rough timestamp is enough.</p></article></div></section></details>
 <details><summary>See the four separate behaviors</summary> <section className="review-previews"><p className="scope-kicker">NEW / AUTHORED DIRECTIONS</p><h2>Four separate directions</h2><p>One minute, one song, four different behaviors: sustain, build and release, accent and rest, and spatial transition. These are design proposals, not trained model results. The build uses an authored timing cycle.</p><div className="review-videos review-featured"><article><video controls playsInline preload="metadata" aria-label="Four authored lighting directions" src="/api/scope-research/authoredDirections" onPlay={e=>{stop();document.querySelectorAll<HTMLVideoElement>(".review-videos video").forEach(v=>{if(v!==e.currentTarget)v.pause();});}} onError={()=>setError("Connect ExtremePro to load the new comparison video.")}/><p>Of The Trees · Electric Forest · 60 seconds with original audio. Listen for which behavior fits the music, beyond simply looking different.</p></article></div></section></details>
 <details><summary>Previous model comparisons and results</summary> <section className="review-previews"><p className="scope-kicker">PREVIOUS EXPERIMENT</p><h2>Previous model previews</h2><p>These earlier brightness/spread comparisons did not produce a meaningful visible difference in your review. Retained for reference.</p><div className="review-videos">{[["forestPreview","Of The Trees · Electric Forest"],["jackWhitePreview","Jack White · Pine Knob"]].map(([asset,title])=><article key={asset}><h2>{title}</h2><video controls playsInline preload="metadata" aria-label={title+" comparison video"} src={"/api/scope-research/"+asset} onPlay={e=>{stop();document.querySelectorAll<HTMLVideoElement>(".review-videos video").forEach(v=>{if(v!==e.currentTarget)v.pause();});}} onError={()=>setError("The preview video is unavailable. Check that ExtremePro is connected.")}/><p>60 seconds · original audio · direct / trained / simple / delayed comparison</p></article>)}</div></section>
 </details>
 <div className="scope-intro"><p className="scope-kicker">LISTEN FIRST</p><h2 style={{fontSize:36}}>Try a live A/B comparison</h2><p>The panels below are generated light views, not video players. Click “Use Jack White excerpt” or choose a music file to begin. Two views hear the same audio and use the same renderer. One uses the trained layer; the other is a comparison. Their identities stay hidden until you save your judgment.</p></div>
 <section className="scope-input"><label>How familiar is this music? <select value={heard} disabled={active||busy} onChange={e=>setHeard(e.target.value)}><option value="unfamiliar">Unfamiliar</option><option value="familiar">Familiar</option><option value="previously_tested">Previously used for testing</option></select></label>
 <label className="scope-file">Choose music<input type="file" accept="audio/*,video/mp4" disabled={busy||active} onChange={e=>{const file=e.target.files?.[0];if(file)void start({kind:'file',file});e.target.value='';}}/></label>
 <button disabled={busy||active} onClick={()=>start({kind:'url',url:'/api/scope-research/jackWhite',name:'Jack White · Pine Knob · from 34:00',start:2040})}>Use Jack White excerpt</button>
 <button onClick={()=>stop()} disabled={!active&&!busy}>Stop / discard trial</button>
 <button disabled={!active||seconds<20||!!error} onClick={()=>stop(true)}>Finish excerpt and judge</button></section>
 <p role="status">{status}</p>{error&&<p role="alert" className="scope-error">{error}</p>}
 <section className="scope-comparison review-panels">{['A','B'].map((name,i)=><article key={name}><h2>View {name}</h2><div className="review-canvas"><canvas ref={node=>{panels.current[i]=node;}} width={520} height={280} aria-label={`View ${name}`}/>{!active&&!busy&&<p className="review-placeholder">Choose music above to start this live view</p>}{busy&&<p className="review-placeholder">Loading audio…</p>}</div></article>)}</section>
 <p>Allow 42.5 seconds for context, then keep both views visible while listening to at least 20 seconds of the comparison. Judge subtle details, accents, quiet passages and phrase changes—not just greater brightness. You can stop at any time.</p>
 {finished&&<section className="review-form"><h2>Your judgment</h2>{QUESTIONS.map(([key,label])=><fieldset key={key} disabled={saved}><legend>{label}</legend>{[['A','A'],['B','B'],['tie','No clear difference'],['neither','Neither works well']].map(([value,text])=><label key={value}><input type="radio" name={key} value={value} checked={ratings[key]===value} onChange={()=>setRatings(v=>({...v,[key]:value}))}/>{text}</label>)}</fieldset>)}
 <label>What moment shaped your choice?<textarea value={notes} disabled={saved} onChange={e=>setNotes(e.target.value)} placeholder="For example: missed accent, good quiet detail, or a transition that felt late."/></label>
 <button onClick={save} disabled={saved||QUESTIONS.some(([key])=>!ratings[key])||!!error}>{saved?'Judgment saved':'Save judgment'}</button>
 {saved&&<><button onClick={()=>setReveal(true)}>Reveal identities</button>{reveal&&<p>A: {METHODS[trial.current!.order[0]]} · B: {METHODS[trial.current!.order[1]]}</p>}</>}
 </section>}
 <section className="scope-footer"><div><h2>{rows.length} saved judgments</h2><p>Judgments stay in this browser until exported. Music is not uploaded. Export includes source filename, blinded order, model fingerprint, playback duration and your answers. This does not measure physical latency.</p><button onClick={exportRows} disabled={!rows.length}>Export judgments</button></div><p>This is an experimental candidate. A preference is evidence about this excerpt, not proof of human-level lighting direction. The original stereo-scope comparison remains available.</p></section>
 </main>;
}
