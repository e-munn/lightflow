'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {PhraseData} from '@/lib/scope/phrase';
import {buildPhrase,phraseIndex,PHRASE_DEFAULTS,PHRASE_VERSION} from '../../../../public/scope-phrase.mjs';
import '../styles/styles.css';
import './phrase.css';

const clock=(t:number)=>`${Math.floor(t/60)}:${(t%60).toFixed(1).padStart(4,'0')}`;
export default function PhraseComparison(){
 const [data,setData]=useState<PhraseData|null>(null),[settings,setSettings]=useState({...PHRASE_DEFAULTS}),[time,setTime]=useState(0),[playing,setPlaying]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(1),[blackout,setBlackout]=useState(false),[coverage,setCoverage]=useState([[0,0],[0,0]]),[note,setNote]=useState(''),[saved,setSaved]=useState(''),[saving,setSaving]=useState(false);
 const comparison=useMemo(()=>data?buildPhrase(data.frames,settings):null,[data,settings]);
 const stage=useRef<HTMLDivElement>(null),fields=useRef<(HTMLDivElement|null)[]>([]),trace=useRef<HTMLCanvasElement>(null),context=useRef<AudioContext|null>(null),buffer=useRef<AudioBuffer|null>(null),source=useRef<AudioBufferSourceNode|null>(null),generation=useRef(0),running=useRef(false),position=useRef(0),startedAt=useRef(0),offset=useRef(0),seen=useRef([new Set<number>(),new Set<number>()]),selection=useRef(1),black=useRef(false),latest=useRef({data,comparison,settings});latest.current={data,comparison,settings};
 useEffect(()=>{let alive=true;fetch('/api/scope-phrase').then(async r=>{if(!r.ok)throw Error(await r.text());return r.json();}).then(d=>{if(alive)setData(d);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 function choose(i:number){selection.current=i;setSelected(i);}
 function stop(){generation.current++;running.current=false;if(source.current){source.current.onended=null;try{source.current.stop();}catch{}source.current.disconnect();source.current=null;}setPlaying(false);setBusy(false);}
 async function play(from=position.current){
  if(!data)return;stop();setError('');setBusy(true);const token=generation.current;
  try{
   const ctx=context.current??(context.current=new AudioContext({sampleRate:48000,latencyHint:'interactive'}));await ctx.resume();
   if(!buffer.current){const r=await fetch('/api/scope-research/phrase');if(!r.ok)throw Error('Connect ExtremePro to play the excerpt.');buffer.current=await ctx.decodeAudioData(await r.arrayBuffer());}
   if(token!==generation.current)return;
   const begin=from>=data.source.durationSeconds-.02?0:Math.max(0,from),node=ctx.createBufferSource();node.buffer=buffer.current;node.connect(ctx.destination);source.current=node;offset.current=begin;position.current=begin;startedAt.current=ctx.currentTime+.04;node.start(startedAt.current,begin);running.current=true;setPlaying(true);setTime(begin);
  }catch(e){if(token===generation.current){stop();setError(e instanceof Error?e.message:String(e));}}finally{if(token===generation.current)setBusy(false);}
 }
 function seek(t:number){position.current=t;setTime(t);if(running.current)void play(t);}
 function change(key:keyof typeof settings,value:number|boolean){stop();setSettings(s=>({...s,[key]:value}));seen.current=[new Set(),new Set()];setCoverage([[0,0],[0,0]]);setSaved('');position.current=0;setTime(0);}
 function toggleBlackout(){black.current=!black.current;setBlackout(black.current);}
 function fullscreen(i:number){choose(i);stage.current?.requestFullscreen().catch(()=>setError('Fullscreen is unavailable in this browser.'));}
 useEffect(()=>{
  let raf=0,statsAt=0;
  const key=(event:KeyboardEvent)=>{if(document.fullscreenElement!==stage.current)return;if(event.code==='ArrowRight'||event.code==='ArrowLeft'){event.preventDefault();choose(1-selection.current);}if(event.code==='Space'){event.preventDefault();toggleBlackout();}};
  window.addEventListener('keydown',key);
  function tick(){
   const now=performance.now(),{data:d,comparison:c,settings:p}=latest.current,ctx=context.current;let at=position.current,valid=false;
   if(running.current&&ctx&&ctx.state==='running'&&d){const stamp=ctx.getOutputTimestamp(),audible=stamp.performanceTime&&stamp.contextTime!==undefined?stamp.contextTime+(now-stamp.performanceTime)/1000:ctx.currentTime;at=Math.max(0,offset.current+audible-startedAt.current);if(at>=d.source.durationSeconds){at=d.source.durationSeconds;running.current=false;source.current?.disconnect();source.current=null;setPlaying(false);}else valid=true;position.current=at;}
   const index=d?phraseIndex(at,d.frames.length,d.fps):-1;
   for(let i=0;i<2;i++){const field=fields.current[i];if(!field)continue;const level=valid&&!black.current&&c&&index>=0?(i===0?c.baseline[index]:c.shaped[index]):0,v=Math.round(level*255);field.style.backgroundColor=`rgb(${v}, ${v}, ${v})`;field.dataset.level=String(level);field.dataset.frame=String(index);
    const r=field.getBoundingClientRect(),visible=Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0))*Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0));
    if(valid&&index>=0&&!black.current&&document.visibilityState==='visible'&&r.width*r.height>0&&visible/(r.width*r.height)>.8&&(!document.fullscreenElement||selection.current===i))seen.current[i].add(index);
   }
   const canvas=trace.current;if(canvas&&d&&c){const g=canvas.getContext('2d')!,w=canvas.width,h=canvas.height;g.clearRect(0,0,w,h);for(const [series,color] of [[c.baseline,'#667c78'],[c.shaped,'#b9f3d3']] as [number[],string][]){g.strokeStyle=color;g.lineWidth=1.4;g.beginPath();series.forEach((v,i)=>{const x=i/(series.length-1)*w,y=h-4-v*(h-8);if(i)g.lineTo(x,y);else g.moveTo(x,y);});g.stroke();}g.strokeStyle='#f2c57c';g.beginPath();g.moveTo(p.impact/d.source.durationSeconds*w,0);g.lineTo(p.impact/d.source.durationSeconds*w,h);g.stroke();g.strokeStyle='#fff';g.beginPath();g.moveTo(at/d.source.durationSeconds*w,0);g.lineTo(at/d.source.durationSeconds*w,h);g.stroke();}
   if(now-statsAt>100){setTime(at);if(d)setCoverage(seen.current.map(indices=>{let before=0,after=0;for(const i of indices)if(d.frames[i].time<p.impact)before++;else after++;return[before/d.fps,after/d.fps];}));statsAt=now;}
   raf=requestAnimationFrame(tick);
  }raf=requestAnimationFrame(tick);
  return()=>{cancelAnimationFrame(raf);window.removeEventListener('keydown',key);generation.current++;running.current=false;try{source.current?.stop();}catch{}source.current?.disconnect();if(context.current&&context.current.state!=='closed')void context.current.close();context.current=null;};
 },[]);
 const canJudge=!!data&&coverage.every(c=>c[0]>=2&&c[1]>=2);
 async function judge(vote:string){if(!data)return;setSaving(true);setError('');const review={version:PHRASE_VERSION,sourceHash:data.source.excerptSha256,settings:{...settings},automated:navigator.webdriver===true,seen:seen.current.map(s=>[...s].sort((a,b)=>a-b)),vote,note};
  try{const r=await fetch('/api/scope-phrase',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(review)});if(!r.ok)throw Error(await r.text());const result=await r.json();setSaved(`Saved on ExtremePro · ${result.id.slice(0,8)}`);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}
 }
 return <main className="signal-studio phrase-studio">
  <header className="signal-header"><a href="/">lightflow<span> / phrase</span></a><div><a className="signal-link" href="/scope/interplay">Earlier experiments</a></div></header>
  <div className="phrase-intro"><h1>Does the light phrase the music better?</h1><p>A keeps your scope response. B keeps grain before the marked arrival, then changes to a sharper response.</p></div>
  {error&&<p role="alert" className="signal-error">{error}</p>}
  <div className="phrase-transport"><button disabled={!data||busy} onClick={()=>playing?stop():play()}>{busy?'Loading audio…':playing?'Pause':'Play excerpt'}</button><button disabled={!data||busy} onClick={()=>play(0)}>Replay from start</button><button onClick={stop}>Stop</button><span role="status">{data?`${data.name} · 31:22–31:54`:'Loading comparison…'}</span><span className="phrase-time" data-testid="playback-time">{clock(time)} / 0:32</span></div>
  <div ref={stage} className="phrase-stage" aria-label="Brightness comparison">
   {['A · Preferred scope','B · Shaped phrase'].map((label,i)=><section key={label} className={`phrase-card${selected===i?' active':''}`} aria-label={label}><div ref={node=>{fields.current[i]=node;}} className="phrase-output" aria-label={i===0?'Scope brightness':'Shaped brightness'}/><div className="phrase-caption"><span>{label}</span><button onClick={()=>fullscreen(i)} aria-label={`Fullscreen ${i===0?'A':'B'}`}>Fullscreen ↗</button></div></section>)}
  </div>
  <div className="phrase-timeline"><canvas ref={trace} width={1200} height={75} aria-label="Scope and shaped brightness over the excerpt"/><input aria-label="Playback position" type="range" min="0" max="32" step=".02" value={time} disabled={!data||busy} onChange={e=>seek(Number(e.target.value))}/><div><span><i className="baseline-key"/>Scope <i className="shaped-key"/>Shaped</span><span className="phrase-phase">B: {time<settings.impact?'Grain · restrained detail':'Snap · sharp attacks'}</span></div></div>
  <div className="phrase-settings"><label>Transition marker <span>{clock(settings.impact)}</span><input aria-label="Transition marker" type="range" min="3" max="29" step=".02" value={settings.impact} onChange={e=>change('impact',Number(e.target.value))}/></label><label>Quiet detail <span>{Math.round(settings.quiet*100)}%</span><input aria-label="Quiet detail" type="range" min=".15" max="1" step=".05" value={settings.quiet} onChange={e=>change('quiet',Number(e.target.value))}/></label><label>Attack tail <span>{settings.decay} ms</span><input aria-label="Attack tail" type="range" min="30" max="350" step="10" value={settings.decay} onChange={e=>change('decay',Number(e.target.value))}/></label></div>
  <div className="phrase-options"><label><input type="checkbox" checked={settings.match} onChange={e=>change('match',e.target.checked)}/> Match average brightness</label><span data-testid="mean-match">{comparison?(settings.match?(comparison.stats.matched?'Matched across this excerpt':'Could not match exactly'):'Original intensities'):''}</span><button onClick={toggleBlackout}>{blackout?'Restore':'Blackout'}</button><span>Fullscreen: ← → compare · Space blackout · Esc exit</span></div>
  <section className="phrase-judgment" aria-label="Listening judgment"><h2>Better phrasing, with the detail still intact?</h2><div>{[['scope','A feels better'],['shaped','B feels better'],['unclear','No clear improvement'],['detail_lost','B loses detail']].map(([vote,label])=><button key={vote} disabled={!canJudge||saving} onClick={()=>judge(vote)}>{label}</button>)}</div><label className="phrase-note">A moment that needs changing <span>optional</span><input type="text" value={note} maxLength={1500} placeholder="e.g. the first hit lands well, but the next quiet sound disappears" onChange={e=>setNote(e.target.value)}/></label><p role="status">{saving?'Saving…':saved||(!canJudge?'Listen with both views visible for a few seconds before and after the marker.':'Your judgment will be saved with this excerpt and these settings on ExtremePro.')}</p></section>
  <details className="phrase-context"><summary>What this comparison establishes</summary><p>The marker is a proposed transition near 31:37.66 in the original recording. Move it if the musical arrival is elsewhere. Changing a control restarts the comparison.</p><p>B is a deliberately directed example, not a trained model or automatic drop detector. A uses your 33% circle and strength 3.3; the unseen attack/release/makeup controls use 0 ms / 0 ms / 1. Average matching uses one fixed gain for this known excerpt. This is a test of behavior before learning when to use it.</p><p>Earlier experiments remain available. The next training target depends on whether this change is actually useful to you.</p></details>
 </main>;
}
