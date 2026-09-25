'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Circle, Download, FileText, Layers, Pause, Play, Radio, ScanLine, Square, Workflow } from 'lucide-react';
import type { Source, PoseFrame, RunSummary, Snapshot } from '@/lib/pipeline/types';
import './pipeline.css';
import IdentityReview from './IdentityReview';
import MovementLab, { type LightLevels } from './MovementLab';

const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [0, 7], [0, 8]];
const clock = (n: number) => `${Math.floor(Math.max(0, n) / 60).toString().padStart(2, '0')}:${(Math.max(0, n) % 60).toFixed(2).padStart(5, '0')}`;
async function api(url = '/api/pipeline', body?: object) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
  const value = await response.json();
  if (!response.ok) throw Error(value.error ?? 'Request failed');
  return value;
}
function findFrame(frames: PoseFrame[], time: number) {
  let lo = 0, hi = frames.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid].t <= time + 0.001) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  return found;
}

export default function Pipeline() {
  const [sources, setSources] = useState<Source[]>([]), [runs, setRuns] = useState<RunSummary[]>([]);
  const [sourceId, setSourceId] = useState(''), [runId, setRunId] = useState('');
  const [start, setStart] = useState(20), [length, setLength] = useState(20);
  const [ready, setReady] = useState(false), [drive, setDrive] = useState(false), [loaded, setLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null), [frames, setFrames] = useState<PoseFrame[]>([]);
  const [poseTime, setPoseTime] = useState<number | null>(null);
  const [movementReady, setMovementReady] = useState(false);
  const [lightLevels, setLightLevels] = useState<LightLevels>({ dance: null, scope: null, loudness: null });
  const [time, setTime] = useState(0), [mediaDuration, setMediaDuration] = useState(0), [playing, setPlaying] = useState(false);
  const [overlay, setOverlay] = useState(true), [others, setOthers] = useState(true), [skeletonOnly, setSkeletonOnly] = useState(false);
  const [rate, setRate] = useState(1), [aspect, setAspect] = useState(16 / 9);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [note, setNote] = useState(''), [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'events' | 'notes'>('events'), [follow, setFollow] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const refreshCatalog = useCallback(async () => {
    const data = await api(); setSources(data.sources); setRuns(data.runs); setReady(data.ready); setDrive(data.drive); setLoaded(true);
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    refreshCatalog().then(data => { if (!active) return; setSourceId(data.sources[0]?.video_id ?? ''); const requested = new URLSearchParams(window.location.search).get('run'); const selected = data.runs.find((r: RunSummary) => r.id === requested) ?? data.runs[0]; if (selected) { setRunId(selected.id); setSourceId(selected.sourceId); setStart(selected.start); setLength(selected.duration); } }).catch(e => { if (active) { setError(e.message); setLoaded(true); } });
    return () => { active = false; };
  }, [refreshCatalog]);
  useEffect(() => {
    setSnapshot(null); setFrames([]); setTime(0); setPoseTime(null); setPlaying(false); setMediaDuration(0); setNote(''); setMovementReady(false);
    if (!runId) return;
    let active = true, fetching = false, chunks = -1, terminalSeen = false;
    async function poll() {
      if (fetching) return; fetching = true;
      try {
        const next: Snapshot = await api(`/api/pipeline?run=${runId}`);
        if (!active) return;
        setSnapshot(next);
        if (next.chunks !== chunks) {
          const data = await api(`/api/pipeline?run=${runId}&view=frames`);
          if (!active) return; setFrames(data); chunks = next.chunks;
        }
        if (next.state !== 'running' && !terminalSeen) { terminalSeen = true; await refreshCatalog(); }
      } catch (e) { if (active) setError((e as Error).message); }
      finally { fetching = false; }
    }
    void poll(); const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [runId, refreshCatalog]);
  useEffect(() => {
    if (!playing) return;
    let animation = 0;
    function tick() { if (video.current) setTime(video.current.currentTime); animation = requestAnimationFrame(tick); }
    tick(); return () => cancelAnimationFrame(animation);
  }, [playing]);
  useEffect(() => {
    const v = video.current;
    if (!v || !snapshot?.preview || !v.requestVideoFrameCallback) return;
    let handle = 0;
    const presented: VideoFrameRequestCallback = (_now, metadata) => {
      setPoseTime(metadata.mediaTime);
      handle = v.requestVideoFrameCallback(presented);
    };
    handle = v.requestVideoFrameCallback(presented);
    return () => v.cancelVideoFrameCallback(handle);
  }, [runId, snapshot?.preview]);
  const duration = mediaDuration || snapshot?.result?.duration || snapshot?.job.duration || length;
  const index = findFrame(frames, poseTime ?? -1);
  const frame = poseTime !== null && index >= 0 && poseTime - frames[index].t < 0.15 ? frames[index] : null;
  const primary = frame?.primary !== null && frame?.primary !== undefined ? frame.poses[frame.primary] : null;
  const quality = primary ? primary.reduce((sum, p) => sum + p[3], 0) / primary.length : null;
  const source = sources.find(s => s.video_id === sourceId);
  const asset = (file: string) => `/api/pipeline/asset?run=${runId}&file=${file}`;
  const seek = useCallback((value: number) => { const next = Math.max(0, Math.min(duration, value)); if (video.current) { if (Math.abs(video.current.currentTime - next) > 0.00001) setPoseTime(null); video.current.currentTime = next; setTime(next); } }, [duration]);
  const step = useCallback((delta: number) => {
    video.current?.pause();
    if (frames.length) { const at = findFrame(frames, video.current?.currentTime ?? time); seek(frames[Math.max(0, Math.min(frames.length - 1, at + delta))].t + 0.0005); }
    else seek(time + delta / (snapshot?.result?.fps || 24));
  }, [frames, time, seek, snapshot?.result?.fps]);
  const togglePlay = useCallback(() => { const v = video.current; if (!v) return; if (v.paused) void v.play().catch(e => setError(e.message)); else v.pause(); }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input,textarea,select,button,a')) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') { event.preventDefault(); step(event.code === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [step, togglePlay]);
  async function processClip() {
    setBusy(true); setError('');
    try { const result = await api('/api/pipeline', { action: 'start', sourceId, start, duration: length }); setRunId(result.id); await refreshCatalog(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function saveNote() {
    setSaving(true); setError('');
    try { await api('/api/pipeline', { action: 'note', run: runId, t: time, text: note }); setNote(''); setSnapshot(await api(`/api/pipeline?run=${runId}`)); setTab('notes'); }
    catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const waveformPath = useMemo(() => {
    const w = snapshot?.waveform; if (!w) return '';
    const stride = Math.max(1, Math.floor(w.peaks.length / 750)); let d = '';
    for (let i = 0; i < w.peaks.length; i += stride) { const peak = Math.max(...w.peaks.slice(i, i + stride)); const x = i * w.step / duration * 1000, h = Math.min(1, peak) * 24; d += `M${x.toFixed(2)},${30 - h}v${2 * h || 0.6} `; }
    return d;
  }, [snapshot?.waveform, duration]);
  const progress = [...(snapshot?.events ?? [])].reverse().find(e => e.progress !== undefined)?.progress ?? 0;
  const events = (snapshot?.events ?? []).filter(e => e.stage !== 'progress' && (!follow || e.t === null || e.t <= time + 0.01));
  const activeRun = snapshot?.state === 'running';
  const stages = [
    { name: 'Source & audio', detail: snapshot?.waveform ? 'Review clip + waveform ready' : 'Prepare synchronized passage', done: !!snapshot?.waveform, active: activeRun && !snapshot?.waveform },
    { name: 'Skeleton extraction', detail: frames.length ? `${frames.length.toLocaleString()} frames available` : '33 landmarks · up to 6 bodies', done: !!snapshot?.result, active: activeRun && !!snapshot?.waveform },
    { name: 'Primary dancer', detail: snapshot?.job.trackingMode === 'solo' ? 'Solo gate · identity needs review' : 'Legacy association · identity unverified', done: !!snapshot?.result, active: activeRun && !!snapshot?.waveform },
    { name: 'Movement → light', detail: movementReady ? 'Draft hypotheses · ready to audition' : 'Analyze a solo passage to compare', done: movementReady, active: false },
  ];
  return <main className="pipeline">
    <header className="pl-header"><Link href="/" className="pl-brand"><Workflow size={20} /> lightflow <span>/</span> <b>pipeline</b></Link><div className="pl-header-right"><span className={`pl-dot ${drive ? 'online' : ''}`} />{drive ? 'SanDisk connected' : loaded ? 'SanDisk unavailable' : 'Connecting…'}<span className="pl-tag">LOCAL WORKSPACE</span></div></header>
    <div className="pl-page">
      <div className="pl-title"><div><div className="pl-eyebrow">DANCE → MOVEMENT → LIGHT</div><h1>Inside the pipeline<span>.</span></h1><p>Follow the footage. Inspect the movement. Find the musical intent.</p></div><div className="pl-experiment"><Radio size={15} /><Link href="/pipeline/live">Music + raw movement ↗</Link></div></div>
      {error && <div className="pl-error" role="alert">{error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <section className="pl-sourcebar" aria-label="Processing controls">
        <label className="pl-source-picker"><span>REFERENCE VIDEO</span><select value={sourceId} onChange={e => { setSourceId(e.target.value); const match = runs.find(r => r.sourceId === e.target.value); setRunId(match?.id ?? ''); if (match) { setStart(match.start); setLength(match.duration); } }} aria-label="Reference video">{sources.map(s => <option key={s.video_id} value={s.video_id}>{s.title}{s.available ? '' : ' — unavailable'}</option>)}</select></label>
        <label><span>START / SEC</span><input aria-label="Passage start in seconds" type="number" min={0} max={source?.duration_seconds} step={1} value={start} onChange={e => setStart(Number(e.target.value))} /></label>
        <label><span>LENGTH / SEC</span><input aria-label="Passage length in seconds" type="number" min={2} max={60} value={length} onChange={e => setLength(Number(e.target.value))} /></label>
        <button className="pl-process" onClick={processClip} disabled={!ready || !source?.available || busy || runs.some(r => r.state === 'running')}><ScanLine size={16} />{busy ? 'Starting…' : 'Process passage'}<ArrowRight size={16} /></button>
      </section>
      <p className="pl-solo-policy">New runs use a strict solo gate. Original footage and earlier runs are retained.</p>
      {!ready && loaded && <p className="pl-help">Processing needs the local Python runtime and pose model on SanDisk. Connect the drive, then <button onClick={() => void refreshCatalog().catch(e => setError(e.message))}>check again</button>.</p>}
      <section className="pl-stages" aria-label="Pipeline stages">{stages.map((stage, i) => <div className={`pl-stage ${stage.done ? 'done' : stage.active ? 'active' : ''}`} key={stage.name}><div className="pl-stage-number">{stage.done ? <Check size={15} /> : String(i + 1).padStart(2, '0')}</div><div><h2>{stage.name}</h2><p>{stage.detail}</p></div>{i < 3 && <ChevronRight className="pl-stage-chevron" size={16} />}</div>)}</section>
      <div className="pl-workspace">
        <section className="pl-review" id="pipeline-video">
          <div className="pl-panel-heading"><h2><ScanLine size={16} /> Frame inspection</h2><div className="pl-state"><span className={`pl-dot ${activeRun ? 'online' : ''}`} />{snapshot ? snapshot.state === 'complete' ? 'Ready for review' : snapshot.state : 'No run selected'}</div></div>
          <div className="pl-video-stage" style={{ aspectRatio: aspect }}>
            {snapshot?.preview ? <>
              <video ref={video} key={runId} src={asset('preview.mp4')} playsInline preload="auto" style={{ opacity: skeletonOnly ? 0 : 1 }} onLoadedMetadata={e => { const v = e.currentTarget; setMediaDuration(v.duration); setAspect(v.videoWidth / v.videoHeight); v.playbackRate = rate; }} onLoadedData={e => { if (!e.currentTarget.requestVideoFrameCallback) setPoseTime(e.currentTarget.currentTime); }} onTimeUpdate={e => { setTime(e.currentTarget.currentTime); if (!e.currentTarget.requestVideoFrameCallback) setPoseTime(e.currentTarget.currentTime); }} onSeeked={e => { setTime(e.currentTarget.currentTime); if (!e.currentTarget.requestVideoFrameCallback) setPoseTime(e.currentTarget.currentTime); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => setError('Review video could not play. Check the SanDisk connection and worker log.')} />
              {overlay && frame && <svg className="pl-skeleton" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Skeleton mapping overlay">{frame.poses.map((pose, person) => {
                const isPrimary = person === frame.primary; if (!isPrimary && !others) return null;
                const color = isPrimary ? '#b6ff69' : '#b3c2d4';
                return <g key={person} opacity={isPrimary ? 1 : 0.35}>{BONES.map(([a, b]) => pose[a][3] >= .5 && pose[b][3] >= .5 ? <line key={`${a}-${b}`} x1={pose[a][0] * 1000} y1={pose[a][1] * 1000} x2={pose[b][0] * 1000} y2={pose[b][1] * 1000} stroke={color} strokeWidth={isPrimary ? 2.2 : 1.2} vectorEffect="non-scaling-stroke" /> : null)}{pose.map((p, j) => p[3] >= .5 ? <ellipse key={j} cx={p[0] * 1000} cy={p[1] * 1000} rx={isPrimary ? 2.8 : 1.8} ry={(isPrimary ? 2.8 : 1.8) * aspect} fill={color} /> : null)}</g>;
              })}</svg>}
              <div className="pl-video-top"><span>REFERENCE / {snapshot.job.sourceId}</span><span>{frame ? `FRAME ${String(frame.index).padStart(5, '0')}` : poseTime === null ? 'WAITING FOR VIDEO FRAME' : 'NO POSE DATA AT PLAYHEAD'}</span></div>
              <div className="pl-video-bottom"><span className={primary ? 'pl-primary-label' : 'pl-gap-label'}><Circle size={10} fill="currentColor" />{primary ? `PRIMARY ${frame?.track} · ${frame?.state.toUpperCase()}` : 'PRIMARY NOT AVAILABLE'}</span><span>{clock(time)}</span></div>
            </> : <div className="pl-empty"><ScanLine size={40} strokeWidth={1} /><h3>{activeRun ? 'Preparing the passage' : 'Start with a passage'}</h3><p>{activeRun ? 'The synchronized video will appear here when it is ready.' : 'Choose a reference and process 2–60 seconds to inspect real skeleton data.'}</p></div>}
          </div>
          <div className="pl-view-options"><label><input type="checkbox" checked={overlay} onChange={e => setOverlay(e.target.checked)} /> Skeleton overlay</label><label><input type="checkbox" checked={others} onChange={e => setOthers(e.target.checked)} /> Other bodies</label><label><input type="checkbox" checked={skeletonOnly} onChange={e => { setSkeletonOnly(e.target.checked); if (e.target.checked) setOverlay(true); }} /> Skeleton only</label></div>
          {movementReady && <div className="pl-inline-lights" aria-label="Brightness beside the video">{([['Dance hypothesis', lightLevels.dance], ['Stereo scope', lightLevels.scope], ['Loudness', lightLevels.loudness]] as const).map(([name, level]) => <div key={name}><span className={level === null ? 'missing' : ''} style={level === null ? {} : { backgroundColor: `rgb(${Math.round(level * 255)} ${Math.round(level * 255)} ${Math.round(level * 255)})` }} /><label>{name}<b>{level === null ? 'Missing' : level.toFixed(3)}</b></label></div>)}</div>}
          <div className="pl-timeline">
            <div className="pl-timeline-label"><span><Radio size={13} /> SOURCE AUDIO</span><span>{snapshot ? `${clock(snapshot.job.start)}–${clock(snapshot.job.start + snapshot.job.duration)} in original` : 'Same clock as video'}</span></div>
            <div className="pl-wave-wrap"><svg viewBox="0 0 1000 60" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="30" x2="1000" y2="30" stroke="#303936" /><path d={waveformPath} stroke="#799682" strokeWidth="1.5" /><rect x="0" y="0" width={time / duration * 1000} height="60" fill="#b6ff69" opacity=".06" />{frames.filter((_, i) => i % 5 === 0).map(f => (f.primary === null || f.poseUsable === false) ? <rect key={f.index} x={f.t / duration * 1000} y="56" width={Math.max(1, ((frames[Math.min(f.index + 5, frames.length - 1)]?.t ?? f.t) - f.t) / duration * 1000)} height="3" fill="#eab580" opacity=".7" /> : null)}<line x1={time / duration * 1000} y1="0" x2={time / duration * 1000} y2="60" stroke="#b6ff69" strokeWidth="2" /></svg><input type="range" min="0" max={duration} step="0.001" value={time} disabled={!snapshot?.preview} onChange={e => seek(Number(e.target.value))} aria-label="Scrub video and audio" /></div>
            <div className="pl-ruler">{Array.from({ length: 5 }, (_, i) => <span key={i}>{clock(duration * i / 4)}</span>)}</div>
            <div className="pl-transport"><div><button aria-label="Previous frame" title="Previous frame (←)" disabled={!snapshot?.preview} onClick={() => step(-1)}><ChevronLeft size={19} /></button><button className="pl-play" aria-label={playing ? 'Pause' : 'Play'} disabled={!snapshot?.preview} onClick={togglePlay}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><button aria-label="Next frame" title="Next frame (→)" disabled={!snapshot?.preview} onClick={() => step(1)}><ChevronRight size={19} /></button><span className="pl-time">{clock(time)} <span>/ {clock(duration)}</span></span></div><div><span className="pl-shortcuts">← → frame · space play</span><select aria-label="Playback speed" value={rate} onChange={e => { const value = Number(e.target.value); setRate(value); if (video.current) video.current.playbackRate = value; }}>{[.25, .5, 1, 1.5, 2].map(r => <option key={r} value={r}>{r}×</option>)}</select></div></div>
          </div>
        </section>
        <aside className="pl-inspector"><div className="pl-panel-heading"><h2><Layers size={16} /> Frame readout</h2><span className="pl-tag">OBSERVED</span></div><div className="pl-inspector-body"><div className="pl-readout-title"><span>PRIMARY DANCER</span><strong>{primary ? `Track ${frame?.track}` : '—'}</strong><p>{primary ? 'Model association · identity unverified' : 'No reliable primary at this timestamp'}</p></div><dl><div><dt>Detected bodies</dt><dd>{frame?.poses.length ?? '—'} <small>/ 6 max</small></dd></div><div><dt>Mean model confidence</dt><dd>{quality === null ? '—' : `${Math.round(quality * 100)}%`}</dd></div><div><dt>Required joints</dt><dd>{frame?.poseUsable === undefined ? 'Not measured' : frame.poseUsable ? 'All visible' : 'Partial / missing'}</dd></div><div><dt>Frame timestamp</dt><dd>{frame ? `${frame.t.toFixed(3)} s` : '—'}</dd></div><div><dt>Body-relative speed</dt><dd>{frame?.speed !== null && frame?.speed !== undefined ? `${frame.speed.toFixed(2)} /s` : '—'}</dd></div><div><dt>Possible camera cut</dt><dd>{frame ? frame.cut ? 'Flagged' : 'Not flagged' : '—'}</dd></div></dl><div className="pl-rule"><span>SELECTION RULE</span><p>{snapshot?.job.trackingMode === 'solo' ? 'Exactly one detected body. Multiple detections become gaps; a cut or sustained loss stops association until a new passage is reviewed.' : 'Legacy center/shape association. Group identity can switch; retained for comparison.'}</p></div><div className="pl-model-note"><span className="pl-dot online" /><div><strong>Pose estimator</strong><p>MediaPipe estimates the joints. Tracking uses a heuristic. Speed is a diagnostic, not a lighting decision.</p></div></div><div className="pl-pending"><span>LIGHTING RESEARCH</span><strong>{movementReady ? 'Hypotheses ready below' : 'Ready for movement analysis'}</strong><p>Compare authored mappings with the audio references. A trained dance-to-light model is still pending.</p></div></div></aside>
      </div>
      {snapshot && <MovementLab key={`movement-${runId}`} snapshot={snapshot} frameTime={poseTime} time={time} playing={playing} onSeek={seek} onAvailable={setMovementReady} onLevels={setLightLevels} onTogglePlay={togglePlay} />}
      {snapshot && <IdentityReview key={runId} snapshot={snapshot} time={time} onSeek={seek} onSaved={async () => setSnapshot(await api(`/api/pipeline?run=${runId}`))} />}
      <section className="pl-journal"><div className="pl-journal-main"><div className="pl-panel-heading"><div className="pl-tabs"><button className={tab === 'events' ? 'selected' : ''} onClick={() => setTab('events')}>Processing log <span>{events.length}</span></button><button className={tab === 'notes' ? 'selected' : ''} onClick={() => setTab('notes')}>Review notes <span>{snapshot?.notes.length ?? 0}</span></button></div>{tab === 'events' && <label className="pl-follow"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> Up to playhead</label>}</div><div className="pl-log" aria-live={activeRun ? 'polite' : 'off'}>{tab === 'events' ? events.length ? events.map(e => <button className={`pl-log-row ${e.stage === 'error' ? 'is-error' : ''}`} key={e.id} disabled={e.t === null || !snapshot?.preview} onClick={() => e.t !== null && seek(e.t)}><time>{e.t === null ? 'SYSTEM' : clock(e.t)}</time><span className={`pl-event-kind ${e.kind === 'gap' ? 'gap' : ''}`}>{e.kind ?? e.stage}</span><span>{e.message}</span>{e.t !== null && <ArrowRight size={13} />}</button>) : <div className="pl-log-empty">Actual processing events and tracking decisions will appear here.</div> : snapshot?.notes.length ? [...snapshot.notes].sort((a, b) => a.t - b.t).map(n => <button className="pl-log-row note" key={n.id} onClick={() => seek(n.t)}><time>{clock(n.t)}</time><FileText size={14} /><span>{n.text}</span><ArrowRight size={13} /></button>) : <div className="pl-log-empty">No review notes yet. Mark what you notice at the playhead.</div>}</div></div><div className="pl-compose"><label htmlFor="pipeline-note">NOTE AT <b>{clock(time)}</b></label><textarea id="pipeline-note" placeholder="A clean hit, an identity switch, a moment worth learning…" maxLength={4000} value={note} onChange={e => setNote(e.target.value)} disabled={!runId} /><button onClick={saveNote} disabled={!runId || !note.trim() || saving}><FileText size={14} />{saving ? 'Saving…' : 'Save timestamped note'}<ArrowRight size={14} /></button><span>Saved to this run on SanDisk.</span></div></section>
      <section className="pl-runbar"><div><span>RUN HISTORY</span><select aria-label="Run history" value={runId} onChange={e => { setRunId(e.target.value); const run = runs.find(r => r.id === e.target.value); if (run) setSourceId(run.sourceId); }}>{!runs.length && <option value="">No processed passages yet</option>}{runs.map(r => <option key={r.id} value={r.id}>{r.title} · {clock(r.start)} + {r.duration}s · {r.state} · {new Date(r.createdAt).toLocaleTimeString()}</option>)}</select></div><div className="pl-run-actions">{snapshot?.audio && <a href={asset('audio.m4a')} download><Download size={13} /> Audio</a>}{runId && <a href={asset('worker.log')} target="_blank" rel="noreferrer">Worker log <ArrowRight size={12} /></a>}{activeRun && <button onClick={async () => { try { await api('/api/pipeline', { action: 'cancel', run: runId }); } catch (e) { setError((e as Error).message); } }}><Square size={12} /> Cancel run</button>}</div></section>
      {activeRun && <div className="pl-progress"><div style={{ width: `${Math.max(2, progress * 100)}%` }} /><span>{Math.round(progress * 100)}% · processing on your machine</span></div>}
      <footer className="pl-footer"><span>Originals preserved. Every processing pass creates a new run.</span><Link href="/scope"><ArrowLeft size={12} /> Stereo-scope reference</Link></footer>
    </div>
  </main>;
}
