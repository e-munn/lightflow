'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {paintSkeleton,observedFrame,containedMedia} from '@/lib/pipeline/raw-skeleton';
import type {PoseFrame} from '@/lib/pipeline/types';
import './pose-quality.css';
type Coverage={body:number;arms:number;legs:number};
type Passage={title:string;baseline:string;candidate:string;before:Coverage;after:Coverage;candidateLabel?:string};
const percent=(n:number)=>`${(100*n).toFixed(1)}%`;
export default function PoseComparison({passages}:{passages:Passage[]}){
 const [selected,setSelected]=useState(0),[mode,setMode]=useState<'full'|'heavy'|'both'>('heavy');
 const [showVideo,setShowVideo]=useState(true),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[duration,setDuration]=useState(30),[ready,setReady]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 const [coverage,setCoverage]=useState({full:0,heavy:0}),[hands,setHands]=useState(true),drawHands=useRef(true);
 const video=useRef<HTMLVideoElement>(null),stage=useRef<HTMLDivElement>(null),fullCanvas=useRef<HTMLCanvasElement>(null),heavyCanvas=useRef<HTMLCanvasElement>(null);
 const data=useRef<{full:PoseFrame[];heavy:PoseFrame[]}>({full:[],heavy:[]}),aspect=useRef(16/9),presented=useRef<number|null>(null),target=useRef<number|null>(null);
 const passage=passages[selected];
 const candidateLabel=passage.candidateLabel??'Heavy';
 const draw=useCallback((t:number|null)=>{
  presented.current=t;
  if(fullCanvas.current)paintSkeleton(fullCanvas.current,observedFrame(data.current.full,t),aspect.current);
  if(heavyCanvas.current){
   const canvas=heavyCanvas.current,frame=observedFrame(data.current.heavy,t);paintSkeleton(canvas,frame,aspect.current);
   const whole=frame?.primary!==null&&frame?.primary!==undefined?frame.wholebody?.[frame.primary]:null;
   const context=canvas.getContext('2d');canvas.dataset.handPoints='0';
   if(whole&&context&&drawHands.current){
    const box=containedMedia(canvas.clientWidth,canvas.clientHeight,aspect.current);
    const valid=(i:number)=>whole[i]?.length===3&&whole[i][2]>=.5&&whole[i].slice(0,2).every(v=>Number.isFinite(v)&&v>=0&&v<=1);
    const p=(i:number)=>[box.x+whole[i][0]*box.width,box.y+whole[i][1]*box.height];
    context.strokeStyle='#80e5b0';context.lineWidth=1.2;context.beginPath();let count=0;
    for(const start of [91,112]){
     for(let finger=0;finger<5;finger++){const chain=[start,...Array.from({length:4},(_,n)=>start+1+finger*4+n)];for(let j=1;j<chain.length;j++){const [a,b]=[chain[j-1],chain[j]];if(valid(a)&&valid(b)){const from=p(a),to=p(b);context.moveTo(...from as [number,number]);context.lineTo(...to as [number,number]);}}}
     for(let i=start;i<start+21;i++)if(valid(i))count++;
    }
    context.stroke();canvas.dataset.handPoints=String(count);
   }
  }
  setCoverage({full:Number(fullCanvas.current?.dataset.joints??0),heavy:Number(heavyCanvas.current?.dataset.joints??0)});
 },[]);
 useEffect(()=>{
  let alive=true;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),20000);
  video.current?.pause();setPlaying(false);setReady(false);setLoaded(false);setError('');setTime(0);data.current={full:[],heavy:[]};target.current=null;draw(null);
  Promise.all([passage.baseline,passage.candidate].map(async id=>{
   const response=await fetch(`/api/pipeline?run=${id}&view=frames`,{signal:controller.signal,cache:'no-store'});
   if(!response.ok)throw Error('Could not load skeletons. Check SanDisk and retry.');return await response.json() as PoseFrame[];
  })).then(([full,heavy])=>{
   if(controller.signal.aborted)return;
   if(!full.length||full.length!==heavy.length||full.some((f,i)=>f.t!==heavy[i].t||f.index!==heavy[i].index))throw Error('Pose timestamps do not match. Comparison is disabled.');
   data.current={full,heavy};setLoaded(true);clearTimeout(timeout);
   // Cached video can finish loading before the effect resets readiness.
   // Reconcile against the mounted video after both pose streams arrive.
   const v=video.current;
   if(v&&v.readyState>=2){aspect.current=v.videoWidth/v.videoHeight;setDuration(v.duration);setReady(true);}
   draw(presented.current??(v&&v.readyState>=2?v.currentTime:null));
  }).catch(e=>{if(alive)setError(controller.signal.aborted?'Loading timed out. Check SanDisk and retry.':e.message);});
  return()=>{alive=false;clearTimeout(timeout);controller.abort();};
 },[passage,revision,draw]);
 useEffect(()=>{
  const v=video.current;if(!v)return;let handle=0;
  const callback:VideoFrameRequestCallback=(_now,metadata)=>{
   if(target.current===null||Math.abs(metadata.mediaTime-target.current)<.12){target.current=null;draw(metadata.mediaTime);setTime(metadata.mediaTime);}
   handle=v.requestVideoFrameCallback(callback);
  };
  if(v.requestVideoFrameCallback)handle=v.requestVideoFrameCallback(callback);
  return()=>{if(handle)v.cancelVideoFrameCallback(handle);};
 },[passage,revision,draw]);
 useEffect(()=>{const el=stage.current;if(!el)return;const observer=new ResizeObserver(()=>draw(presented.current));observer.observe(el);return()=>observer.disconnect();},[draw]);
 const seek=useCallback((t:number)=>{
  const v=video.current;if(!v||!Number.isFinite(v.duration))return;
  const next=Math.max(0,Math.min(v.duration-.001,t));if(Math.abs(v.currentTime-next)<.00001)return;
  draw(null);target.current=next;setTime(next);v.currentTime=next;
 },[draw]);
 const toggle=useCallback(async()=>{const v=video.current;if(!v||!ready||!loaded)return;if(v.paused){try{await v.play();}catch{setError('Playback could not start. Retry.');}}else v.pause();},[ready,loaded]);
 function step(direction:number){const v=video.current;if(!v)return;v.pause();const at=observedFrame(data.current.full,presented.current??v.currentTime);const index=at?data.current.full.indexOf(at):0;const next=data.current.full[Math.max(0,Math.min(data.current.full.length-1,index+direction))];if(next)seek(next.t+.0001);}
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,select,button,a')||e.metaKey||e.ctrlKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();void toggle();}if(e.key==='1')setMode('full');if(e.key==='2')setMode('heavy');if(e.key==='3')setMode('both');};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[toggle]);
 return <main className="pose-quality">
  <header><a href="/pipeline/live">lightflow / movement</a><span>POSE QUALITY</span></header>
  <div className="pq-heading"><div><h1>Same dance. Better joints?</h1><p>Compare the original Full model with {candidateLabel} on identical frames. No display smoothing.</p></div><label>Passage<select aria-label="Dance passage" value={selected} onChange={e=>setSelected(+e.target.value)}>{passages.map((p,i)=><option key={p.candidate} value={i}>{p.title}{p.candidateLabel?` · ${p.candidateLabel}`:''}</option>)}</select></label></div>
  {error&&<p role="alert" className="pq-error">{error} <button onClick={()=>{video.current?.load();setRevision(r=>r+1);}}>Retry</button></p>}
  <div className="pq-stage" ref={stage}>
   <video ref={video} key={passage.candidate} className={showVideo?'':'pq-video-hidden'} src={`/api/pipeline/asset?run=${passage.baseline}&file=preview.mp4`} playsInline preload="auto" loop
    onLoadedMetadata={e=>{aspect.current=e.currentTarget.videoWidth/e.currentTarget.videoHeight;setDuration(e.currentTarget.duration);draw(presented.current);}}
    onLoadedData={e=>{setReady(true);if(!e.currentTarget.requestVideoFrameCallback)draw(e.currentTarget.currentTime);}}
    onCanPlay={()=>setReady(true)}
    onSeeking={e=>{if(presented.current===null||Math.abs(presented.current-e.currentTarget.currentTime)>.12)draw(null);}}
    onSeeked={e=>{if(!e.currentTarget.requestVideoFrameCallback){target.current=null;draw(e.currentTarget.currentTime);}setTime(e.currentTarget.currentTime);}}
    onTimeUpdate={e=>{if(!e.currentTarget.requestVideoFrameCallback&&!e.currentTarget.seeking){draw(e.currentTarget.currentTime);setTime(e.currentTarget.currentTime);}}}
    onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onError={()=>{setError('Video unavailable. Check SanDisk and retry.');setReady(false);}}/>
   <canvas ref={fullCanvas} className={`pq-full ${mode==='heavy'?'pq-hidden':''}`} aria-label="Original Full skeleton"/>
   <canvas ref={heavyCanvas} className={mode==='full'?'pq-hidden':''} aria-label={`${candidateLabel} skeleton`}/>
   <span className="pq-label">{!loaded||!ready?'Loading…':mode==='both'?`Full · gray / ${candidateLabel} · mint`:`${mode==='full'?'Original · Full':`Candidate · ${candidateLabel}`}${presented.current!==null&&coverage[mode]===0?' · tracking gap':''}`}</span>
   <button className="pq-fullscreen" aria-label="Fullscreen comparison" onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void stage.current?.requestFullscreen().catch(()=>setError('Fullscreen unavailable.'));}}>⛶</button>
  </div>
  <div className="pq-transport"><button disabled={!ready||!loaded} onClick={()=>void toggle()}>{playing?'Pause':'Play music'}</button><button aria-label="Previous frame" disabled={!loaded||!ready} onClick={()=>step(-1)}>‹</button><button aria-label="Next frame" disabled={!loaded||!ready} onClick={()=>step(1)}>›</button><input aria-label="Seek comparison" type="range" min="0" max={duration} step=".001" value={Math.min(time,duration)} disabled={!ready||!loaded} onChange={e=>seek(+e.target.value)}/><output>{time.toFixed(2)}s</output></div>
  <div className="pq-comparison"><div role="group" aria-label="Pose model">{(['full','heavy','both'] as const).map((v,i)=><button key={v} aria-pressed={mode===v} onClick={()=>setMode(v)}>{i+1} · {v==='full'?'Original Full':v==='heavy'?candidateLabel:'Both'}</button>)}</div><label><input type="checkbox" checked={showVideo} onChange={e=>setShowVideo(e.target.checked)}/>Source video</label>{candidateLabel==='RTMW'&&<label><input type="checkbox" checked={hands} onChange={e=>{drawHands.current=e.target.checked;setHands(e.target.checked);draw(presented.current);}}/>Hand detail</label>}<span>{mode==='both'?`Full ${coverage.full} / ${candidateLabel} ${coverage.heavy}`:`${coverage[mode]}`} mapped joints visible now</span></div>
  <div className="pq-evidence"><p>Check wrist and elbow placement, crossed limbs, foot contact and sudden jumps. More visible points do not necessarily mean more accurate points.</p><table><caption>Usable joint coverage across this passage</caption><thead><tr><th>Group</th><th>Full</th><th>{candidateLabel}</th></tr></thead><tbody>{(['body','arms','legs'] as const).map(k=><tr key={k}><th>{k==='body'?'Whole body':k==='arms'?'Arms':'Legs'}</th><td>{percent(passage.before[k])}</td><td>{percent(passage.after[k])}</td></tr>)}</tbody></table><p>Coverage requires confidence ≥ 0.5 and joints inside the frame. Both models use the same strict solo gate; uncertain or multiple bodies stay unassigned. {candidateLabel==='RTMW'?'RTMW and MediaPipe scores have different meanings, so these percentages do not establish relative accuracy. RTMW estimates 2D positions; no measured depth.':'Neither model is promoted by this comparison.'}</p></div>
 </main>;
}
