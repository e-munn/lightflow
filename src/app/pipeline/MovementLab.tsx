'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Lightbulb, Pause, Play, WandSparkles } from 'lucide-react';
import type { CueReview, MovementAnalysis, MovementCue, Snapshot } from '@/lib/pipeline/types';
import { atTime, compareAudio, type AudioComparison } from '@/lib/pipeline/audio-comparison';

type Projection = 'flow' | 'punctuation';
export type LightLevels = { dance: number | null; scope: number | null; loudness: number | null };
async function request(run: string, body?: object) {
  const response = await fetch(body ? '/api/pipeline' : `/api/pipeline?run=${run}&view=movement`, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ run, ...body }),
  } : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Movement analysis unavailable');
  return data;
}
function trace<T extends { t: number }>(frames: T[], get: (f: T) => number | null, duration: number) {
  let path = '', previous = false;
  for (const f of frames) {
    const v = get(f);
    if (v === null) { previous = false; continue; }
    path += `${previous ? 'L' : 'M'}${(f.t / duration * 1000).toFixed(2)},${(56 - Math.min(1, Math.max(0, v)) * 48).toFixed(2)} `;
    previous = true;
  }
  return path;
}
function Field({ name, value, explanation }: { name: string; value: number | null; explanation: string }) {
  const shade = value === null ? 0 : Math.round(value * 255);
  return <article className="pl-light-card"><h3>{name}<span>{value === null ? '—' : value.toFixed(3)}</span></h3>
    <div className={`pl-light-field ${value === null ? 'missing' : ''}`} role="img" aria-label={`${name} brightness`} data-value={value ?? 'missing'} style={value === null ? {} : { backgroundColor: `rgb(${shade} ${shade} ${shade})` }}>{value === null && <span>No value at this frame</span>}</div>
    <p>{explanation}</p></article>;
}

export default function MovementLab({ snapshot, frameTime, time, playing, onSeek, onAvailable, onLevels, onTogglePlay }: {
  snapshot: Snapshot; frameTime: number | null; time: number; playing: boolean; onSeek: (t: number) => void;
  onAvailable: (ready: boolean) => void; onLevels: (levels: LightLevels) => void; onTogglePlay: () => void;
}) {
  const run = snapshot.job.id;
  const [analysis, setAnalysis] = useState<MovementAnalysis | null>(null), [reviews, setReviews] = useState<CueReview[]>([]);
  const [references, setReferences] = useState<AudioComparison | null>(null), [audioState, setAudioState] = useState('');
  const [projection, setProjection] = useState<Projection>('punctuation'), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [selected, setSelected] = useState(''), [judgment, setJudgment] = useState<'keep' | 'reject'>('keep');
  const [evidence, setEvidence] = useState(''), [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    request(run).then(data => { if (active) { setAnalysis(data.analysis); setReviews(data.reviews); onAvailable(!!data.analysis); } }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [run, onAvailable]);
  useEffect(() => {
    if (!analysis || !snapshot.audio) return;
    const controller = new AbortController();
    setAudioState('Computing audio references…');
    compareAudio(`/api/pipeline/asset?run=${run}&file=audio.m4a`, controller.signal).then(data => {
      if (!controller.signal.aborted) { setReferences(data); setAudioState('Audio references ready'); }
    }).catch(e => { if (!controller.signal.aborted) setAudioState(`Audio comparison unavailable: ${e.message}`); });
    return () => controller.abort();
  }, [analysis?.id, snapshot.audio, run]); // Recompute only for a new saved analysis.
  async function analyze() {
    setBusy(true); setError('');
    try { const data = await request(run, { action: 'analyze' }); setAnalysis(data.analysis); setReviews(data.reviews); setSelected(''); onAvailable(true); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!analysis || !selected) return;
    setSaving(true); setError('');
    try {
      const review = await request(run, { action: 'cue-review', review: { analysisId: analysis.id, candidateId: selected, judgment, text: evidence, reviewer: 'user' } });
      setReviews(prior => [...prior, review]); setEvidence('');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const current = atTime(analysis?.frames ?? [], frameTime), audio = atTime(references?.frames ?? [], frameTime, .025);
  const danceLevel = current?.[projection] ?? null, scopeLevel = audio?.scope ?? null, loudnessLevel = audio?.loudness ?? null;
  useEffect(() => { onLevels({ dance: danceLevel, scope: scopeLevel, loudness: loudnessLevel }); }, [danceLevel, scopeLevel, loudnessLevel, onLevels]);
  const duration = analysis?.duration ?? snapshot.job.duration;
  const cue = analysis?.candidates.find(c => c.id === selected);
  const currentReviews = reviews.filter(r => r.analysisId === analysis?.id);
  const paths = useMemo(() => analysis ? [
    { label: 'Relative motion', color: '#b6ff69', path: trace(analysis.frames, f => f.speed === null ? null : f.speed / analysis.parameters.speed95, duration) },
    { label: 'Body extension', color: '#9ac7ff', path: trace(analysis.frames, f => f.speed === null || f.extension === null ? null : (f.extension - analysis.parameters.extension05) / Math.max(.15, analysis.parameters.extension95 - analysis.parameters.extension05), duration) },
    { label: 'Dance → brightness', color: '#b6ff69', path: trace(analysis.frames, f => f[projection], duration) },
    { label: 'Stereo-scope brightness', color: '#9ac7ff', path: trace(references?.frames ?? [], f => f.scope, duration) },
    { label: 'Loudness brightness', color: '#e7b987', path: trace(references?.frames ?? [], f => f.loudness, duration) },
  ] : [], [analysis, references, projection, duration]);
  function choose(c: MovementCue) { setSelected(c.id); setEvidence(''); onSeek(Math.max(0, c.start - .2)); }
  return <section className="pl-movement" aria-label="Movement and lighting comparison">
    <div className="pl-panel-heading"><h2><Lightbulb size={16} /> Movement → light</h2><span className="pl-tag">AUTHORED HYPOTHESES</span></div>
    <div className="pl-movement-intro"><div><h3>{analysis ? 'Audition the phrasing.' : 'From tracked joints to a first light study.'}</h3><p>Compare the same passage and listen for accents, sustained holds, and transitions. Suggestions need review; this is not a trained lighting model.</p></div>
      <button className="pl-analyze" disabled={busy || loading || snapshot.state !== 'complete' || snapshot.job.trackingMode !== 'solo'} onClick={analyze}><WandSparkles size={14} />{busy ? 'Analyzing movement…' : analysis ? 'Create new analysis' : 'Analyze movement'}</button></div>
    {error && <p className="pl-movement-error" role="alert">{error}</p>}
    {!analysis && <p className="pl-movement-help">{loading ? 'Loading saved analysis…' : 'Requires a completed solo extraction. Every analysis is saved as a new file on SanDisk.'}</p>}
    {analysis && <>
      <div className="pl-projection-controls"><label>Dance mapping<select aria-label="Dance brightness mapping" value={projection} onChange={e => setProjection(e.target.value as Projection)}><option value="punctuation">Accents + held poses</option><option value="flow">Extension + motion</option></select></label><p>{projection === 'punctuation' ? 'Extension sets the level. Proposed arrivals add a short pulse; detected holds preserve the base.' : 'Expansion raises the light; relative limb motion adds detail. A hypothesis to compare against the held-pose version.'}</p><span>{Math.round(analysis.coverage * 100)}% movement coverage</span></div>
      <div className="pl-light-fields">
        <Field name="Dance hypothesis" value={current?.[projection] ?? null} explanation={current?.holding ? 'Detected hold · base level retained' : current?.speed === null || !current ? 'Missing movement stays missing.' : `${current.speed.toFixed(2)} torso lengths/s · offline pose evidence`} />
        <Field name="Stereo-scope reference" value={audio?.scope ?? null} explanation="Existing scope reduction · exposure 40 · soft curve" />
        <Field name="Loudness reference" value={audio?.loudness ?? null} explanation="20 ms stereo RMS · fixed response · no pose input" />
      </div>
      <div className="pl-comparison-transport"><button onClick={onTogglePlay} aria-label={playing ? 'Pause comparison' : 'Play comparison'}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'Pause' : 'Play passage'}</button><a href="#pipeline-video">Return to video ↑</a><p className="pl-comparison-status">{audioState}{references ? ` · ${references.channels} channel${references.channels === 1 ? '' : 's'} · ${references.sampleRate.toLocaleString()} Hz` : ''}. All views follow the video clock. Pausing freezes the inspection; gaps are hatched.</p></div>
      <div className="pl-motion-traces" aria-label="Synchronized movement and brightness traces">
        {paths.map((line, i) => <div className="pl-motion-trace" key={line.label}><span style={{ color: line.color }}>{line.label}</span><svg viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="56" x2="1000" y2="56" stroke="#344132" /><path d={line.path} fill="none" stroke={line.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /><line x1={time / duration * 1000} y1="0" x2={time / duration * 1000} y2="64" stroke="#fff" strokeOpacity=".5" />{i === 2 && analysis.candidates.filter(c => c.kind === 'arrival').map(c => <circle key={c.id} cx={c.start / duration * 1000} cy="5" r="2.5" fill="#efd3a6" />)}</svg></div>)}
        <label className="pl-comparison-scrub"><span>Scrub comparison · {time.toFixed(2)} s</span><input aria-label="Scrub lighting comparison" type="range" min="0" max={duration} step="0.001" value={Math.min(time, duration)} onChange={e => onSeek(Number(e.target.value))} /></label>
      </div>
      <div className="pl-cue-workspace"><div><h3>Proposed movement cues <span>{analysis.candidates.length}</span></h3><p>Inspect the skeleton and listen before keeping a cue. These rules do not identify musical intent.</p>
        <div className="pl-cue-list">{analysis.candidates.length ? analysis.candidates.map(c => {
          const last = [...currentReviews].filter(r => r.candidateId === c.id && r.reviewer !== 'automated').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          return <button key={c.id} className={selected === c.id ? 'selected' : ''} onClick={() => choose(c)}><time>{c.start.toFixed(2)}{c.end !== c.start ? `–${c.end.toFixed(2)}` : ''} s</time><b>{c.kind}</b><span>{last ? `${last.judgment === 'keep' ? 'Kept' : 'Rejected'} · ${last.reviewer}` : 'Unreviewed'}</span><ArrowRight size={12} /></button>;
        }) : <p>No cues meet the current thresholds. This does not mean the passage has no phrasing.</p>}</div></div>
        <div className="pl-cue-review"><h3>{cue ? `${cue.kind} at ${cue.start.toFixed(2)} s` : 'Review a suggested cue'}</h3><p>{cue?.reason ?? 'Choose a cue to seek just before it. Use the main playback controls to watch and listen.'}</p>
          <label>Judgment<select aria-label="Movement cue judgment" value={judgment} disabled={!cue} onChange={e => setJudgment(e.target.value as typeof judgment)}><option value="keep">Useful movement cue</option><option value="reject">Reject / tracking artifact</option></select></label>
          <label>Evidence<textarea aria-label="Movement cue evidence" value={evidence} disabled={!cue} maxLength={2000} onChange={e => setEvidence(e.target.value)} placeholder="What happens here? Is the arrival precise, the hold intentional, or the motion a tracking artifact?" /></label>
          <button className="pl-review-save" disabled={!cue || !evidence.trim() || saving} onClick={save}>{saving ? 'Saving…' : 'Save cue review'}</button>
          <p>Reviews are saved separately from the original hypotheses. Keeping a cue does not approve the lighting mapping or certify identity.</p>
          {currentReviews.filter(r => r.candidateId === selected).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => <div className="pl-cue-record" key={r.id}><b>{r.judgment} · {r.reviewer}</b><p>{r.text}</p></div>)}
        </div>
      </div>
      <details className="pl-analysis-method"><summary>Method, timing, and provenance</summary><p>Aspect-corrected 2D joints, relative to the torso center and a fixed median torso scale. Center travel is separate. Local line fits use ±60 ms of video; speed uses actual neighboring frame timestamps. No interpolation crosses a gap, cut, or track change.</p><p>Measured feature lookahead: {(analysis.parameters.measuredFeatureLookaheadSeconds * 1000).toFixed(1)} ms. Whole-passage normalization and cue rules use additional future information. Brightness is an offline design hypothesis; no live latency claim is made.</p><p>Audio references use decoded source audio resampled to 48 kHz, trailing 20 ms windows at 50 Hz. The scope uses the existing {references?.scopeVersion ?? 'scope-coverage-v1'} implementation with its default soft curve. Loudness brightness = 1 − exp(−4 × RMS). No second audio stream is played.</p><ul>{analysis.limitations.map(item => <li key={item}>{item}</li>)}</ul><p>{analysis.version} · {analysis.createdAt}<br />Analysis {analysis.id}<br />Pose SHA-256 {analysis.poseSha256}<br />Implementation SHA-256 {analysis.implementationSha256}<br />Audio SHA-256 {analysis.audioSha256}</p><a href={`/api/pipeline?run=${run}&view=movement`} target="_blank" rel="noreferrer">View analysis and review JSON <ArrowRight size={12} /></a></details>
    </>}
  </section>;
}
