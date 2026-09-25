'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, SlidersHorizontal, Maximize2, Minimize2, Pause, Play, Repeat2, RotateCcw, ScanLine, Video, Volume2, VolumeX, X } from 'lucide-react';
import { IconButton, useFlashControls } from '@/components/lighting/FlashControls';
import { observedFrame, paintSkeleton } from '@/lib/pipeline/raw-skeleton';
import { DEFAULT_SMOOTHING, SkeletonDisplayFilter, type SmoothingSettings } from '@/lib/pipeline/skeleton-smoothing';
import { BRIGHTNESS_MODES, brightnessAt, applyBrightnessFade, MovementBrightnessCache, type BrightnessFrame, type BrightnessMode, type BrightnessDefault } from '@/lib/pipeline/movement-brightness';
import { loadMusicContext } from '@/lib/pipeline/music-audio';
import { musicBrightnessDefault, type MusicContext } from '@/lib/pipeline/music-context';
import { MovementBrightnessCache as OriginalBrightnessCache } from '@/lib/pipeline/brightness-v0';
import { TimingStudyCache, type TimingControl } from '@/lib/pipeline/brightness-timing';
import { PhraseStudyCache, matchBrightness, type PhraseStudy } from '@/lib/pipeline/brightness-phrase';
import type { PoseFrame, RunSummary, Snapshot } from '@/lib/pipeline/types';
import '@/components/lighting/flash.css';
import './movement.css';

const DEFAULT_RUN='86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6';
type StudyVersion='v0'|'v1'|'v2'|'v3';
const clock=(t:number)=>`${Math.floor(Math.max(0,t)/60)}:${Math.floor(Math.max(0,t)%60).toString().padStart(2,'0')}`;
async function get<T>(url:string,signal:AbortSignal):Promise<T> {
  const response=await fetch(url,{signal,cache:'no-store'});
  const data=await response.json();if (!response.ok) throw Error(data.error||'Could not load the recorded movement.');return data;
}

export default function RawMovementPlayer() {
  const stage=useRef<HTMLElement>(null),video=useRef<HTMLVideoElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const light=useRef<HTMLDivElement>(null),lightReadout=useRef<HTMLOutputElement>(null),lightCache=useRef(new MovementBrightnessCache());
  const originalCache=useRef(new OriginalBrightnessCache()),studyVersion=useRef<StudyVersion>('v1');
  const [version,setVersion]=useState<StudyVersion>('v1');
  const rawMetrics=useRef(new OriginalBrightnessCache()),timingCache=useRef(new TimingStudyCache());
  const envelope=useRef<{input:BrightnessFrame[]|null;fade:number;output:BrightnessFrame[]}>({input:null,fade:0,output:[]});
  const control=useRef<TimingControl|'constant'>('candidate'),[comparison,setComparison]=useState<TimingControl|'constant'>('candidate');
  const phraseCache=useRef(new PhraseStudyCache()),matchAverage=useRef(true),[matched,setMatched]=useState(true);
  const phraseEnvelope=useRef<{study:PhraseStudy|null;fade:number;gain:number;candidate:BrightnessFrame[];constant:BrightnessFrame[];matchedGain:number;matchValid:boolean}>({study:null,fade:0,gain:0,candidate:[],constant:[],matchedGain:1,matchValid:false});
  const [mapping,setMapping]=useState<BrightnessMode>('motion'),[gain,setGain]=useState(1),[fade,setFade]=useState(120),[showSkeleton,setShowSkeleton]=useState(true);
  const [automatic,setAutomatic]=useState(true),[recommendation,setRecommendation]=useState<BrightnessDefault|null>(null),[audioStatus,setAudioStatus]=useState<'loading'|'ready'|'unavailable'>('loading');
  const lightSettings=useRef({mode:'motion' as BrightnessMode,gain:1,fade:120,automatic:true});
  const overrides=useRef<Partial<Record<BrightnessMode,{gain:number;fade:number}>>>({}),music=useRef<MusicContext|null>(null);
  const recommended=useRef<{base:BrightnessDefault|null;music:MusicContext|null;value:BrightnessDefault|null;version:string}>({base:null,music:null,value:null,version:''});
  const {controlsVisible,isFullscreen}=useFlashControls(stage);
  const [runs,setRuns]=useState<RunSummary[]>([]),[run,setRun]=useState(''),[snapshot,setSnapshot]=useState<Snapshot|null>(null);
  const [busy,setBusy]=useState(true),[ready,setReady]=useState(false),[playing,setPlaying]=useState(false),[error,setError]=useState('');
  const [started,setStarted]=useState(false);
  const [overlay,setOverlay]=useState(false),[loop,setLoop]=useState(true),[muted,setMuted]=useState(false),[rate,setRate]=useState(1);
  const [time,setTime]=useState(0),[duration,setDuration]=useState(0),[panel,setPanel]=useState<'clips'|'info'|null>(null),[revision,setRevision]=useState(0);
  const [gap,setGap]=useState(false),[partial,setPartial]=useState(false);
  const [settings,setSettings]=useState(DEFAULT_SMOOTHING);
  const smoothing=useRef(DEFAULT_SMOOTHING),filter=useRef(new SkeletonDisplayFilter());
  const frames=useRef<PoseFrame[]>([]),aspect=useRef(16/9),presented=useRef<number|null>(null),seekTarget=useRef<number|null>(null),resume=useRef(false);
  const draw=useCallback((mediaTime:number|null)=>{
    presented.current=mediaTime;const raw=observedFrame(frames.current,mediaTime);
    const frame=observedFrame(filter.current.frames(frames.current,smoothing.current,aspect.current),mediaTime);
    const config=lightSettings.current;
    const cache=studyVersion.current==='v0'?originalCache.current:lightCache.current;
    const phrase=studyVersion.current==='v3'&&music.current?.timing?phraseCache.current.study(rawMetrics.current.frames(frames.current,aspect.current,0),music.current):null;
    const base=phrase?.base??cache.defaults(frames.current,aspect.current)[studyVersion.current==='v2'?'snap':config.mode];
    if(recommended.current.base!==base||recommended.current.music!==music.current||recommended.current.version!==studyVersion.current){
      const value=studyVersion.current==='v0'?{...base,gain:1.3,fade:160,reason:'Frozen original · sensitivity 1.30× / fade 160 ms.'}:musicBrightnessDefault(base,studyVersion.current==='v2'?'snap':config.mode,music.current);
      recommended.current={base,music:music.current,value,version:studyVersion.current};setRecommendation(value);
    }
    const setting=overrides.current[config.mode]??recommended.current.value!;
    const auto=!overrides.current[config.mode];
    if(config.gain!==setting.gain){config.gain=setting.gain;setGain(setting.gain);}
    if(config.fade!==setting.fade){config.fade=setting.fade;setFade(setting.fade);}
    if(config.automatic!==auto){config.automatic=auto;setAutomatic(auto);}
    let lightFrames=cache.frames(frames.current,aspect.current,config.fade),effectiveGain=config.gain;
    if(studyVersion.current==='v2'){
      const evidence=music.current?.timing;
      if(!evidence)lightFrames=[];
      else{
        const raw=rawMetrics.current.frames(frames.current,aspect.current,0),study=timingCache.current.study(raw,evidence);
        const input=control.current==='candidate'?study.v2:control.current==='snap'?raw:control.current==='audio'?study.audio:study.rms;
        if(envelope.current.input!==input||envelope.current.fade!==config.fade)envelope.current={input,fade:config.fade,output:applyBrightnessFade(input,config.fade)};
        lightFrames=envelope.current.output;
      }
    }
    if(studyVersion.current==='v3'){
      if(!phrase)lightFrames=[];
      else{
        const saved=phraseEnvelope.current;
        if(saved.study!==phrase.result||saved.fade!==config.fade||saved.gain!==config.gain){
          const candidate=applyBrightnessFade(phrase.result.candidate,config.fade),constant=applyBrightnessFade(phrase.result.constant,config.fade);
          const matching=matchBrightness(candidate,constant,config.gain);
          phraseEnvelope.current={study:phrase.result,fade:config.fade,gain:config.gain,candidate,constant,matchedGain:matching.gain,matchValid:matching.matched};
        }
        lightFrames=control.current==='constant'?phraseEnvelope.current.constant:phraseEnvelope.current.candidate;
        if(control.current==='constant'&&matchAverage.current&&phraseEnvelope.current.matchValid)effectiveGain=phraseEnvelope.current.matchedGain;
      }
    }
    const output=brightnessAt(lightFrames,mediaTime,config.mode,effectiveGain);
    if(light.current){const value=Math.round(output.value*255);light.current.style.backgroundColor=`rgb(${value}, ${value}, ${value})`;light.current.dataset.brightness=String(output.value);light.current.dataset.mode=config.mode;light.current.dataset.available=String(output.available);light.current.dataset.auto=String(auto);}
    if(lightReadout.current){lightReadout.current.value=output.available?`${Math.round(output.value*100)}%`:'—';lightReadout.current.title=output.available?'Screen brightness':'Not enough reliable joints for this mapping';}
    if (canvas.current) {paintSkeleton(canvas.current,frame,aspect.current,smoothing.current.enabled&&smoothing.current.compare?raw:null);canvas.current.dataset.smoothing=String(smoothing.current.enabled&&smoothing.current.steadiness>0);}
    setGap(mediaTime!==null && (!frame||frame.primary===null));setPartial(!!frame&&frame.primary!==null&&frame.poseUsable===false);
  },[]);
  const changeLight=useCallback((patch:{mode?:BrightnessMode;gain?:number;fade?:number})=>{
    const config=lightSettings.current;
    if(patch.mode){config.mode=patch.mode;setMapping(patch.mode);}
    if(patch.gain!==undefined||patch.fade!==undefined)overrides.current[config.mode]={gain:patch.gain??config.gain,fade:patch.fade??config.fade};
    draw(presented.current);
  },[draw]);
  function useAutomatic(){delete overrides.current[lightSettings.current.mode];draw(presented.current);}
  function changeVersion(value:StudyVersion){
    studyVersion.current=value;setVersion(value);overrides.current={};
    if(value==='v2'){lightSettings.current.mode='snap';setMapping('snap');}
    if(value==='v3'){lightSettings.current.mode='open';setMapping('open');}
    control.current='candidate';setComparison('candidate');draw(presented.current);
    const url=new URL(window.location.href);url.searchParams.set('study',value);window.history.replaceState(null,'',url);
  }
  useEffect(()=>{
    const params=new URLSearchParams(window.location.search),value=params.get('study')==='v3'?'v3':params.get('study')==='v2'?'v2':params.get('study')==='v0'?'v0':'v1';
    studyVersion.current=value;setVersion(value);
    const mode=BRIGHTNESS_MODES.find(m=>m.id===params.get('mode'));
    if(value==='v3')changeLight({mode:'open'});else if(value==='v2')changeLight({mode:'snap'});else if(mode)changeLight({mode:mode.id});else draw(presented.current);
  },[changeLight,draw]);
  function changeSmoothing(patch: Partial<SmoothingSettings>){
    const next={...smoothing.current,...patch};smoothing.current=next;setSettings(next);draw(presented.current);
    try{localStorage.setItem('lightflow-movement-smoothing-v1',JSON.stringify(next));}catch{}
  }
  useEffect(()=>{
    try{const saved=JSON.parse(localStorage.getItem('lightflow-movement-smoothing-v1')||'null');
      if(saved&&typeof saved.enabled==='boolean'&&typeof saved.compare==='boolean'&&[saved.steadiness,saved.responsiveness].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100)){smoothing.current=saved;setSettings(saved);draw(presented.current);}
    }catch{}
  },[draw]);

  useEffect(()=>{
    const abort=new AbortController();let alive=true;const timeout=setTimeout(()=>abort.abort(),20000);
    setError('');setBusy(true);
    get<{drive:boolean;runs:RunSummary[]}>('/api/pipeline',abort.signal).then(data=>{
      if (!alive) return;if (!data.drive) throw Error('Connect SanDisk ExtremePro, then retry.');
      const available=data.runs.filter(r=>r.state==='complete'&&r.trackingMode==='solo');
      if (!available.length) throw Error('No completed solo passages are available yet.');
      setRuns(available);const requested=new URLSearchParams(window.location.search).get('run');
      setRun(available.find(r=>r.id===requested)?.id??available.find(r=>r.id===DEFAULT_RUN)?.id??available[0].id);
    }).catch(e=>{if(alive){setError(e.name==='AbortError'?'The local pipeline took too long to respond. Retry loading.':e.message);setBusy(false);}});
    return()=>{alive=false;clearTimeout(timeout);abort.abort();};
  },[revision]);

  useEffect(()=>{
    if (!run) return;const abort=new AbortController();let alive=true;const timeout=setTimeout(()=>abort.abort(),20000);
    video.current?.pause();setPlaying(false);setStarted(false);setBusy(true);setReady(false);setSnapshot(null);setError('');setTime(0);setDuration(0);frames.current=[];seekTarget.current=null;overrides.current={};music.current=null;setAudioStatus('loading');draw(null);
    Promise.all([get<Snapshot>(`/api/pipeline?run=${run}`,abort.signal),get<PoseFrame[]>(`/api/pipeline?run=${run}&view=frames`,abort.signal)]).then(([s,f])=>{
      if (!alive) return;if (!s.preview||!f.length) throw Error('The passage does not have both video and skeleton frames. Choose another clip.');
      frames.current=f;setSnapshot(s);setDuration(s.result?.duration??s.job.duration);
      const url=new URL(window.location.href);url.searchParams.set('run',run);window.history.replaceState(null,'',url);
    }).catch(e=>{if(alive){setError(e.name==='AbortError'?'Loading timed out. Check SanDisk and retry.':e.message);setBusy(false);}});
    return()=>{alive=false;clearTimeout(timeout);abort.abort();};
  },[run,revision,draw]);

  useEffect(()=>{
    if(!snapshot)return;
    if(!snapshot.audio){setAudioStatus('unavailable');return;}
    const abort=new AbortController();let alive=true;const timer=setTimeout(()=>abort.abort(),30000);
    loadMusicContext(`/api/pipeline/asset?run=${snapshot.job.id}&file=audio.m4a`,abort.signal).then(context=>{
      if(!alive)return;music.current=context;setAudioStatus('ready');draw(presented.current);
    }).catch(()=>{if(alive){music.current=null;setAudioStatus('unavailable');draw(presented.current);}});
    return()=>{alive=false;clearTimeout(timer);abort.abort();};
  },[snapshot,draw]);

  useEffect(()=>{
    const v=video.current;if (!v||!snapshot) return;let handle=0;
    const frame:VideoFrameRequestCallback=(_now,metadata)=>{
      if (seekTarget.current===null||Math.abs(metadata.mediaTime-seekTarget.current)<.12) { seekTarget.current=null;draw(metadata.mediaTime);setTime(metadata.mediaTime); }
      handle=v.requestVideoFrameCallback(frame);
    };
    if(v.requestVideoFrameCallback) handle=v.requestVideoFrameCallback(frame);
    return()=>{if(handle)v.cancelVideoFrameCallback(handle);};
  },[snapshot,draw]);
  useEffect(()=>{
    const element=stage.current;if(!element)return;
    const observer=new ResizeObserver(()=>draw(presented.current));observer.observe(element);return()=>observer.disconnect();
  },[draw]);
  useEffect(()=>{if(video.current)video.current.playbackRate=rate;},[rate,snapshot]);
  useEffect(()=>{
    if(!snapshot||ready||error)return;const timer=setTimeout(()=>{setBusy(false);setError('The video did not become ready. Check the drive connection and retry.');},20000);return()=>clearTimeout(timer);
  },[snapshot,ready,error]);

  const toggle=useCallback(async()=>{
    const v=video.current;if(!v||!ready)return;
    if(!v.paused){v.pause();return;}
    try{await v.play();setError('');}catch(e){setError(`Playback could not start: ${(e as Error).message}`);}
  },[ready]);
  const seek=useCallback((value:number)=>{
    const v=video.current;if(!v)return;const t=Math.max(0,Math.min(value,Math.max(0,v.duration-.001)));
    if(Math.abs(v.currentTime-t)<.00001)return;draw(null);seekTarget.current=t;setTime(t);v.currentTime=t;
  },[draw]);
  const step=useCallback((direction:number)=>{
    const v=video.current;if(!v)return;v.pause();const at=observedFrame(frames.current,presented.current??v.currentTime);
    const position=at?frames.current.indexOf(at):0;const next=frames.current[Math.max(0,Math.min(frames.current.length-1,position+direction))];if(next)seek(next.t+.0001);
  },[seek]);
  const fullscreen=useCallback(async()=>{try{if(document.fullscreenElement===stage.current)await document.exitFullscreen();else await stage.current?.requestFullscreen();}catch{setError('Native fullscreen is unavailable. The player still fills this window.');}},[]);
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){setPanel(null);return;}if(e.metaKey||e.ctrlKey||e.altKey||(e.target as HTMLElement).closest('input,select,textarea,button,a'))return;
      if(e.code==='Space'){e.preventDefault();if(!e.repeat)void toggle();}
      if(e.code==='ArrowLeft'||e.code==='ArrowRight'){e.preventDefault();step(e.code==='ArrowLeft'?-1:1);}
      if(e.code==='KeyF'&&!e.repeat){e.preventDefault();void fullscreen();}
      if(e.code==='KeyV'&&!e.repeat)setOverlay(v=>!v);
      const mode=BRIGHTNESS_MODES[Number(e.key)-1];
      const allowed=mode&&(studyVersion.current==='v3'?mode.id==='open'||mode.id==='off':studyVersion.current==='v2'?mode.id==='snap'||mode.id==='off':true);
      if(allowed&&!e.repeat)changeLight({mode:mode.id});
    };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[toggle,step,fullscreen,changeLight]);

  const current=runs.find(r=>r.id===run),index=runs.findIndex(r=>r.id===run);
  function choose(id:string){if(id===run){setPanel(null);return;}resume.current=!!video.current&&!video.current.paused;setRun(id);setPanel(null);}
  function mediaReady(v:HTMLVideoElement){
    setBusy(false);setReady(true);setDuration(v.duration);aspect.current=v.videoWidth/v.videoHeight;v.playbackRate=rate;
    if(!v.requestVideoFrameCallback)draw(v.currentTime);else draw(presented.current);
    if(resume.current){resume.current=false;void v.play().catch(()=>setPlaying(false));}
  }
  const hidden=playing&&!controlsVisible&&!panel&&!error&&!busy;
  const status=busy?'Loading passage…':error?'Needs attention':playing?(gap?'Tracking gap':partial?'Playing · partial joints':'Playing'):ready?'Ready to play':'Waiting';
  return <main ref={stage} tabIndex={-1} className={`flash-studio movement-studio${hidden?' flash-idle':''}`}>
    <h1 className="flash-sr-only">Music and raw skeleton movement</h1>
    <section className="flash-stage mv-stage" aria-label="Recorded dance and synchronized skeleton" onPointerDown={()=>setPanel(null)} onDoubleClick={()=>void fullscreen()}>
      <div ref={light} className="mv-light" data-brightness="0" aria-hidden="true" />
      {snapshot&&<video ref={video} key={run} src={`/api/pipeline/asset?run=${run}&file=preview.mp4`} className={overlay?'mv-video visible':'mv-video'} playsInline preload="auto" loop={loop} muted={muted}
        onLoadedMetadata={e=>{aspect.current=e.currentTarget.videoWidth/e.currentTarget.videoHeight;setDuration(e.currentTarget.duration);e.currentTarget.playbackRate=rate;draw(presented.current);}}
        onLoadedData={e=>mediaReady(e.currentTarget)} onCanPlay={e=>mediaReady(e.currentTarget)}
        onSeeking={e=>{if(presented.current===null||Math.abs(presented.current-e.currentTarget.currentTime)>.12)draw(null);}} onSeeked={e=>{setTime(e.currentTarget.currentTime);if(!e.currentTarget.requestVideoFrameCallback){seekTarget.current=null;draw(e.currentTarget.currentTime);}}}
        onTimeUpdate={e=>{setTime(e.currentTarget.currentTime);if(!e.currentTarget.requestVideoFrameCallback&&!e.currentTarget.seeking)draw(e.currentTarget.currentTime);}}
        onPlay={()=>{setStarted(true);setPlaying(true);}} onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)}
        onError={()=>{setBusy(false);setReady(false);setError('The video could not play. Reconnect SanDisk or choose another passage.');}} />}
      <canvas ref={canvas} className={`mv-skeleton${showSkeleton?'':' mv-skeleton-hidden'}`} aria-hidden={!showSkeleton} aria-label={settings.enabled?'Recorded skeleton with display smoothing':'Raw recorded skeleton'} />
    </section>
    <header className="flash-header flash-chrome" data-flash-ui>
      <a href="/pipeline" className="flash-brand">lightflow<span> / movement</span></a>
      <div className="mv-study-nav"><a href="/pipeline/study">Study</a><select aria-label="Study version" value={version} onChange={e=>changeVersion(e.target.value as StudyVersion)}><option value="v0">V0 · Original</option><option value="v1">V1 · Auto</option><option value="v2">V2 · Audio support</option><option value="v3">V3 · Timed Open</option></select></div>
      <div className="flash-status"><span className={`flash-status-dot${playing?' is-live':''}`} /><span role="status">{status}</span><span className="mv-recorded">RECORDED</span></div>
    </header>
    {error&&<div className="flash-notice flash-error" data-flash-ui><p role="alert">{error}</p><button className="flash-text-button" onClick={()=>setRevision(r=>r+1)}>Retry</button><IconButton label="Dismiss error" onClick={()=>setError('')}><X/></IconButton></div>}
    {!playing&&!error&&(!started||busy)&&<div className="mv-start" data-flash-ui>{busy?<span>Loading music + movement…</span>:<button className="mv-start-play" disabled={!ready} onClick={()=>void toggle()} aria-label="Play music"><Play/><span>Play music</span></button>}</div>}
    {gap&&playing&&<span className="mv-gap">Tracking gap</span>}
    <div className="flash-controls flash-chrome mv-controls" data-flash-ui>
      <section className="flash-panel mv-clips" hidden={panel!=='clips'} aria-label="Recorded passages">
        <div className="flash-panel-heading"><div><span className="flash-eyebrow">SOURCE MUSIC + TRACKED MOVEMENT</span><h2>Choose a passage</h2></div><IconButton label="Close passages" onClick={()=>setPanel(null)}><X/></IconButton></div>
        <div className="mv-clip-list">{runs.map(r=><button key={r.id} aria-pressed={run===r.id} onClick={()=>choose(r.id)}><span>{r.title}<small>{clock(r.start)}–{clock(r.start+r.duration)} in original · {r.duration}s</small></span>{run===r.id&&<Check/>}</button>)}</div>
      </section>
      <section className="flash-panel mv-info" hidden={panel!=='info'} aria-label="Movement playback details">
        <div className="flash-panel-heading"><h2>Movement</h2><IconButton label="Close details" onClick={()=>setPanel(null)}><X/></IconButton></div>
        <div className="mv-smoothing">
          <button className="flash-text-button" aria-pressed={settings.enabled} onClick={()=>changeSmoothing({enabled:!settings.enabled})}>Smoothing {settings.enabled?'on':'off'}</button>
          <label className="flash-parameter">Steadiness <output>{settings.steadiness}%</output><input aria-label="Steadiness" type="range" min="0" max="100" value={settings.steadiness} disabled={!settings.enabled} onChange={e=>changeSmoothing({steadiness:+e.target.value})}/><small>Higher reduces jitter; slow gestures lag more.</small></label>
          <label className="flash-parameter">Fast movement response <output>{settings.responsiveness}%</output><input aria-label="Fast movement response" type="range" min="0" max="100" value={settings.responsiveness} disabled={!settings.enabled} onChange={e=>changeSmoothing({responsiveness:+e.target.value})}/><small>Higher lets quick hits and direction changes through.</small></label>
          <label className="mv-compare"><input type="checkbox" checked={settings.compare} disabled={!settings.enabled} onChange={e=>changeSmoothing({compare:e.target.checked})}/>Show raw comparison<span>Gray trace</span></label>
          <button className="flash-text-button mv-reset" onClick={()=>changeSmoothing(DEFAULT_SMOOTHING)}>Reset smoothing</button>
        </div>
        <p className="flash-description">Recorded movement with its original music. Smoothing changes the skeleton only. Brightness uses separate movement metrics, scaled to this passage. Missing tracking goes dark; — means the selected metric is unavailable.</p>
        <p className="flash-description">{version==='v3'?'V3 uses strong audio accents for timing and body expansion for their strength. Auto sets sensitivity from event amplitudes and fade from estimated BPM and audio texture; uncertain tempo falls back to audio-event spacing. The constant comparison shares the same event clock, fade and tracking gaps.':'Auto sets sensitivity from strong movement and fade from estimated BPM and audio texture. When tempo is uncertain, it uses gesture spacing.'} These are starting values, fixed for this passage. Audio texture is not a learned judgment of mood.</p>
        <label className="mv-speed">Playback speed<select aria-label="Playback speed" value={rate} onChange={e=>setRate(+e.target.value)}>{[.25,.5,1,1.5,2].map(v=><option key={v} value={v}>{v}×</option>)}</select></label>
        <div className="mv-frame-step"><IconButton label="Previous frame" onClick={()=>step(-1)} disabled={!ready}><ChevronLeft/></IconButton><span>Frame by frame</span><IconButton label="Next frame" onClick={()=>step(1)} disabled={!ready}><ChevronRight/></IconButton></div>
        <a href={`/pipeline?run=${run}`} className="flash-text-button"><ArrowLeft/>Inspect this passage</a>
      </section>
      <section className="mv-mapping" aria-label="Movement to brightness">
        {version==='v3'?<div className="mv-phrase-controls"><div role="group" aria-label="Expression comparison">{(['candidate','constant'] as const).map(value=><button key={value} aria-pressed={comparison===value} onClick={()=>{control.current=value;setComparison(value);draw(presented.current);}}>{value==='candidate'?'Open expression':'Constant accents'}</button>)}</div><label><input type="checkbox" aria-label="Match average brightness" checked={matched} onChange={e=>{matchAverage.current=e.target.checked;setMatched(e.target.checked);draw(presented.current);}}/>Match average brightness</label></div>:version!=='v2'?<div className="mv-mapping-buttons" role="group" aria-label="Brightness mappings">{BRIGHTNESS_MODES.map((mode,i)=><button key={mode.id} aria-label={`${mode.label} brightness`} aria-keyshortcuts={String(i+1)} aria-pressed={mapping===mode.id} title={`${i+1} · ${mode.description}`} onClick={()=>changeLight({mode:mode.id})}><span>{i+1}</span>{mode.label}</button>)}</div>:<div className="mv-experiment-controls"><label>Compare<select aria-label="Timing comparison" value={comparison} onChange={e=>{control.current=e.target.value as TimingControl;setComparison(control.current);draw(presented.current);}}><option value="candidate">V2 · Supported Snap</option><option value="snap">Snap · same fade</option><option value="audio">Audio accents only</option><option value="rms">Audio level only</option></select></label><button className="flash-text-button" aria-pressed={mapping==='off'} onClick={()=>changeLight({mode:mapping==='off'?'snap':'off'})}>{mapping==='off'?'Light off':'Light on'}</button></div>}
        <div className="mv-light-description"><p>{version==='v3'?'Same audio accents. Does Open add expression to their brightness?':version==='v2'?'Rejected as a general replacement: shifted audio passed the support gate too often.':BRIGHTNESS_MODES.find(m=>m.id===mapping)?.description}</p><output ref={lightReadout} aria-label="Background brightness">0%</output></div>
        <div className="mv-light-tuning">
          <label>Sensitivity <input aria-label="Brightness sensitivity" type="range" min="0.25" max="3" step="0.05" value={gain} disabled={version==='v0'} onChange={e=>changeLight({gain:+e.target.value})}/><output>{gain.toFixed(2)}×</output></label>
          <label>Fade <input aria-label="Brightness fade" type="range" min="40" max="800" step="10" value={fade} disabled={version==='v0'} onChange={e=>changeLight({fade:+e.target.value})}/><output>{fade} ms</output></label>
          <div className="mv-light-actions"><button className="mv-auto" aria-label="Use automatic brightness settings" aria-pressed={automatic} onClick={useAutomatic} disabled={busy||mapping==='off'||version==='v0'} title={recommendation?.reason}>{version==='v0'?'Original':'Auto'}</button><button className="mv-skeleton-toggle" aria-pressed={showSkeleton} onClick={()=>setShowSkeleton(v=>!v)}>{showSkeleton?<Eye/>:<EyeOff/>}Skeleton</button></div>
        </div>
        <p className="mv-auto-note" data-audio-status={audioStatus}>{(version==='v2'||version==='v3')&&audioStatus==='unavailable'?`${version.toUpperCase()} needs audio analysis. Switch to V0 or V1 to continue.`:version==='v0'?recommendation?.reason:automatic?(audioStatus==='loading'?'Listening for tempo and texture…':audioStatus==='unavailable'?`Audio unavailable · ${recommendation?.reason??'Using movement defaults.'}`:recommendation?.reason):'Manual for this mapping. Auto restores the suggested values.'}</p>
      </section>
      <div className="mv-timeline"><span>{clock(time)}</span><input type="range" aria-label="Seek music and skeleton" min="0" max={duration||1} step=".001" value={Math.min(time,duration||1)} disabled={!ready} onChange={e=>seek(+e.target.value)}/><span>{clock(duration)}</span></div>
      <div className="flash-dock mv-dock" role="group" aria-label="Movement playback controls">
        <div className="flash-sources"><IconButton label={playing?'Pause':'Play'} detail="Space" onClick={()=>void toggle()} disabled={!ready}>{playing?<Pause/>:<Play/>}</IconButton><IconButton label="Restart passage" onClick={()=>seek(0)} disabled={!ready}><RotateCcw/></IconButton></div>
        <div className="flash-recipe-selector"><IconButton label="Previous passage" onClick={()=>choose(runs[(index+runs.length-1)%runs.length].id)} disabled={busy||!runs.length}><ChevronLeft/></IconButton><button className="flash-recipe-trigger mv-clip-trigger" aria-label="Choose passage" aria-expanded={panel==='clips'} onClick={()=>setPanel(p=>p==='clips'?null:'clips')}><span><strong>{current?.title??'Choose a passage'}</strong><small>Original audio · {settings.enabled&&settings.steadiness>0?'smoothed':'raw'} joints</small></span><ChevronDown/></button><IconButton label="Next passage" onClick={()=>choose(runs[(index+1)%runs.length].id)} disabled={busy||!runs.length}><ChevronRight/></IconButton></div>
        <div className="flash-actions">
          <IconButton label={overlay?'Show skeleton only':'Show video behind skeleton'} detail="V · same frame and audio" aria-pressed={overlay} onClick={()=>setOverlay(v=>!v)}>{overlay?<ScanLine/>:<Video/>}</IconButton>
          <IconButton label={muted?'Unmute music':'Mute music'} aria-pressed={muted} onClick={()=>setMuted(v=>!v)}>{muted?<VolumeX/>:<Volume2/>}</IconButton>
          <IconButton label="Loop passage" aria-pressed={loop} onClick={()=>setLoop(v=>!v)}><Repeat2/></IconButton>
          <IconButton label="Movement details" detail="Smoothing + playback" aria-expanded={panel==='info'} onClick={()=>setPanel(p=>p==='info'?null:'info')}><SlidersHorizontal/></IconButton>
          <IconButton label={isFullscreen?'Exit fullscreen':'Fullscreen'} detail="F · Esc to exit" onClick={()=>void fullscreen()}>{isFullscreen?<Minimize2/>:<Maximize2/>}</IconButton>
        </div>
      </div>
      <p className="flash-idle-hint">{version==='v2'||version==='v3'?<><kbd>{version==='v3'?'7':'4'}</kbd> light on · <kbd>8</kbd> off</>:<><kbd>1–8</kbd> switch mapping</>}<span>·</span><kbd>Space</kbd> play<span>·</span>controls fade while playing</p>
    </div>
  </main>;
}
