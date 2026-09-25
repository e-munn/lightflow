'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { inferBuffer, type DanceFrame, type DanceModel } from '../../../../public/dance-audio.mjs';
import { atTime, compareAudio, type AudioReference } from '@/lib/pipeline/audio-comparison';
import './study.css';

type Passage = { runId: string; title: string; split: string; seconds: number };
type Report = { trainSongs: number; testSongs: number; eligibleSeconds: number; selectedByValidation: string; passages: Passage[]; testMacroMae: Record<string, number> };
const labels: Record<string, string> = { movement: 'Audio → movement → light', direct: 'Audio → light', scope: 'Stereo-scope reference' };
const shade = (v: number | null) => v === null ? '#151918' : `rgb(${Math.round(v * 255)} ${Math.round(v * 255)} ${Math.round(v * 255)})`;

export default function ModelStudy() {
  const [model, setModel] = useState<DanceModel | null>(null), [report, setReport] = useState<Report | null>(null);
  const [run, setRun] = useState(''), [url, setUrl] = useState(''), [name, setName] = useState('');
  const [frames, setFrames] = useState<DanceFrame[]>([]), [refs, setRefs] = useState<AudioReference[]>([]);
  const [time, setTime] = useState(0), [duration, setDuration] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [live, setLive] = useState(false), [liveFrame, setLiveFrame] = useState<DanceFrame | null>(null), [full, setFull] = useState('');
  const audio = useRef<HTMLAudioElement>(null), objectUrl = useRef(''), lastAudioName = useRef(''), generation = useRef(0), loading = useRef<AbortController | null>(null);
  const capture = useRef<{ context: AudioContext; stream: MediaStream; node: AudioWorkletNode } | null>(null);
  const fullField = useRef<HTMLDivElement>(null);
  function stopCapture() {
    const c = capture.current; capture.current = null;
    if (c) { c.node.disconnect(); c.stream.getTracks().forEach(t => t.stop()); void c.context.close(); }
    setLive(false); setLiveFrame(null); setName(lastAudioName.current);
  }
  useEffect(() => {
    let active = true;
    fetch('/api/pipeline/model', { cache: 'no-store' }).then(async r => {
      const d = await r.json(); if (!r.ok) throw Error(d.error); if (!active) return;
      setModel(d.model); setReport(d.report); setRun(d.report.passages.find((p: Passage) => p.split === 'test')?.runId ?? '');
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; generation.current++; loading.current?.abort(); const c = capture.current; if (c) { c.stream.getTracks().forEach(t => t.stop()); void c.context.close(); } if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, []);
  async function load(source: string, title: string) {
    if (!model) return;
    const ticket = ++generation.current; loading.current?.abort(); const abort = new AbortController(); loading.current = abort;
    stopCapture(); lastAudioName.current = title; audio.current?.pause(); setUrl(''); setFrames([]); setRefs([]); setBusy(true); setError(''); setTime(0); setDuration(0); setName(title);
    try {
      const r = await fetch(source, { signal: abort.signal }); if (!r.ok) throw Error('Audio unavailable');
      const context = new OfflineAudioContext(1, 1, 16000), buffer = await context.decodeAudioData(await r.arrayBuffer());
      if (ticket !== generation.current) return;
      const mono = new Float32Array(buffer.length);
      for (let c = 0; c < buffer.numberOfChannels; c++) { const channel = buffer.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / buffer.numberOfChannels; }
      const predictions = inferBuffer(mono, model), references = await compareAudio(source, abort.signal);
      if (ticket !== generation.current) return;
      setFrames(predictions); setRefs(references.frames); setDuration(buffer.duration); setUrl(source);
    } catch (e) { if (ticket === generation.current && !abort.signal.aborted) setError((e as Error).message); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  useEffect(() => {
    const p = report?.passages.find(p => p.runId === run);
    if (p && model) void load(`/api/pipeline/asset?run=${run}&file=audio.m4a`, p.title);
    // A selected passage uses the same audio-only engine as a local upload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, model?.id]);
  useEffect(() => {
    let id = 0;
    const tick = () => { if (audio.current && !audio.current.paused) setTime(audio.current.currentTime); id = requestAnimationFrame(tick); };
    tick(); return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const handler = () => { if (!document.fullscreenElement) setFull(''); };
    document.addEventListener('fullscreenchange', handler); return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  async function microphone() {
    if (live) { stopCapture(); return; }
    if (!model) return;
    const ticket = ++generation.current; loading.current?.abort(); audio.current?.pause(); setBusy(true); setError('');
    let stream: MediaStream | null = null, context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      if (ticket !== generation.current) { stream.getTracks().forEach(t => t.stop()); return; }
      context = new AudioContext({ latencyHint: 'interactive' }); await context.audioWorklet.addModule('/dance-capture.mjs');
      if (ticket !== generation.current) { stream.getTracks().forEach(t => t.stop()); await context.close(); return; }
      const node = new AudioWorkletNode(context, 'dance-capture', { processorOptions: { model }, numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = e => setLiveFrame(e.data);
      context.createMediaStreamSource(stream).connect(node); node.connect(context.destination);
      capture.current = { context, stream, node }; await context.resume(); setLive(true); setName('Live microphone');
    } catch (e) { capture.current = null; stream?.getTracks().forEach(t => t.stop()); if (context) await context.close(); setError((e as Error).message); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  const current = live ? liveFrame : atTime(frames, time, .03), reference = live ? null : atTime(refs, time, .03);
  const levels: Record<string, number | null> = { movement: current?.movement ?? null, direct: current?.direct ?? null, scope: reference?.scope ?? null };
  const passage = report?.passages.find(p => p.runId === run);
  async function expand(key: string) { setFull(key); try { await fullField.current?.requestFullscreen(); } catch { /* Fixed viewport fallback still fills the screen. */ } }
  function trace(get: (f: DanceFrame) => number) { return frames.filter((_, i) => i % 3 === 0).map((f, i) => `${i ? 'L' : 'M'}${f.t / duration * 1000},${100 - get(f) * 95}`).join(' '); }
  return <main className="dm-study">
    <header><Link href="/pipeline">← Dance pipeline</Link><span>LIGHTFLOW / AUDIO MODEL STUDY</span></header>
    <section className="dm-intro"><p className="dm-eyebrow">TRAINED EXPERIMENT · ONE BRIGHTNESS OUTPUT</p><h1>Can the light learn<br />the dancer’s phrasing?</h1><p>Both models hear only the music. One predicts coarse movement before shaping the light; the other predicts brightness directly. Compare them with the unchanged stereo-scope.</p></section>
    {report && Math.min(report.testMacroMae.movement, report.testMacroMae.direct) > report.testMacroMae.constant && <aside className="dm-result"><strong>First result: transferable timing has not been learned.</strong><p>On the two unseen songs, both models have more error than constant brightness. Their outputs are too averaged, and wrong-song controls sometimes score as well. These are inspectable baselines, not an upgrade to the stereo-scope.</p></aside>}
    {error && <p role="alert" className="dm-error">{error}</p>}
    <section className="dm-controls"><label>Music<select aria-label="Model study music" value={run} disabled={!report || busy} onChange={e => setRun(e.target.value)}><option value="">Your audio</option>{report?.passages.map(p => <option key={p.runId} value={p.runId}>{p.split === 'test' ? 'UNSEEN' : p.split.toUpperCase()} · {p.title}</option>)}</select></label><label className="dm-button">Choose audio<input aria-label="Choose audio file" type="file" accept="audio/*" disabled={!model || busy} onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(file); setRun(''); void load(objectUrl.current, file.name); }} /></label><button disabled={!model || busy} onClick={() => void microphone()}>{live ? 'Stop microphone' : busy ? 'Preparing…' : 'Use microphone'}</button></section>
    <div className="dm-transport"><div><strong>{busy ? 'Preparing audio comparison…' : name || 'Loading model…'}</strong><p>{live ? 'Live audio · no video input · microphone monitoring is off' : passage && run ? `${passage.split === 'test' ? 'Song excluded from training and tuning' : `${passage.split} passage`} · ${passage.seconds} seconds` : 'Local audio stays on this computer'}</p></div><audio ref={audio} src={url || undefined} controls onPlay={() => { if (live) stopCapture(); }} onTimeUpdate={() => setTime(audio.current?.currentTime ?? 0)} onSeeked={() => setTime(audio.current?.currentTime ?? 0)} /></div>
    <section className="dm-fields" aria-label="Audio-only brightness comparisons">{Object.entries(levels).map(([key, value]) => <article key={key}><h2>{labels[key]}<span>{value === null ? '—' : value.toFixed(3)}</span></h2><button className="dm-field" aria-label={`Expand ${labels[key]}`} data-value={value ?? 'missing'} style={{ background: shade(value) }} onClick={() => void expand(key)}>{value === null && <span>{live && key === 'scope' ? 'File comparison only' : busy ? 'Preparing…' : 'Press Play'}</span>}</button><p>{key === 'movement' ? 'Predicts arms, legs, travel, extension, stopping and holds.' : key === 'direct' ? 'Learns the same authored brightness rule directly from audio.' : 'Existing stereo trace coverage · exposure 40 · soft curve'}</p></article>)}</section>
    <p className="dm-status">{current && !current.ready ? 'Building 1.32 seconds of audio context. ' : ''}{current?.silent ? 'Silence guard active. ' : ''}Click a field for a screen-filling view.{live ? '' : ' Playback and all fields share the same audio clock.'}</p>
    {!live && frames.length > 0 && <section className="dm-traces"><h2>Where the predictions differ</h2><svg viewBox="0 0 1000 110" preserveAspectRatio="none" aria-label="Movement and direct model brightness traces"><path d={trace(f => f.movement)} fill="none" stroke="#c8e7a6" strokeWidth="1.7" /><path d={trace(f => f.direct)} fill="none" stroke="#9db7ca" strokeWidth="1.7" /><line x1={time / duration * 1000} x2={time / duration * 1000} y1="0" y2="110" stroke="white" /></svg><label>Position · {time.toFixed(2)} s<input type="range" aria-label="Seek model comparison" min="0" max={duration} step=".02" value={Math.min(time, duration)} onChange={e => { if (audio.current) { audio.current.currentTime = +e.target.value; setTime(+e.target.value); } }} /></label><p><span style={{ color: '#c8e7a6' }}>Movement route</span> · <span style={{ color: '#9db7ca' }}>Direct route</span></p></section>}
    {report && <details className="dm-evidence"><summary>What this model has—and hasn’t—learned</summary><p>Trained on {report.trainSongs} songs, tested on {report.testSongs} other songs. {Math.round(report.eligibleSeconds)} seconds of usable movement across all splits. This is a small feasibility study with sampled pose checks, not an approved lighting model.</p><p>The target is an authored rule based on body extension, limb motion and deceleration. Lower error means reproducing that rule; it does not establish a better light show. Full identity review, source A/V alignment and human musical preference remain unresolved.</p><table><thead><tr><th>Held-out proxy error (lower is better)</th><th>Mean absolute error</th></tr></thead><tbody>{Object.entries(report.testMacroMae).map(([key, value]) => <tr key={key}><td>{key === 'constant' ? 'Constant training brightness' : key === 'rms' ? 'RMS-only trained control' : labels[key]}</td><td>{value.toFixed(4)}</td></tr>)}</tbody></table><p>Validation chose {report.selectedByValidation === 'movement' ? 'the movement route' : 'the direct route'}. Both remain visible. The microphone uses trailing 32 ms audio windows and 20 ms updates; those are not measurements of end-to-end device latency. Silence below RMS 0.0001 is forced dark by an explicit guard outside the model.</p><a href="/api/pipeline/model" target="_blank" rel="noreferrer">Model weights, splits and full evaluation JSON ↗</a>{run && <p><Link href={`/pipeline?run=${run}`}>Inspect this passage’s skeleton and extraction ↗</Link></p>}</details>}
    <div ref={fullField} className={full ? 'dm-full active' : 'dm-full'} style={{ background: shade(levels[full] ?? null) }}><button onClick={() => { setFull(''); if (document.fullscreenElement) void document.exitFullscreen(); }}>Close · {labels[full]}</button></div>
  </main>;
}
