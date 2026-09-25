'use client';

import { useState } from 'react';
import type { Snapshot } from '@/lib/pipeline/types';
import { identityStatus } from '@/lib/pipeline/reviews';

export default function IdentityReview({ snapshot, time, onSaved, onSeek }: {
  snapshot: Snapshot; time: number; onSaved: () => Promise<void>; onSeek: (t: number) => void;
}) {
  const [method, setMethod] = useState<'sampled' | 'continuous'>('sampled');
  const [outcome, setOutcome] = useState<'clear' | 'issue'>('clear');
  const [start, setStart] = useState(0), [end, setEnd] = useState(snapshot.job.duration);
  const [text, setText] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const duration = Math.min(snapshot.job.duration, snapshot.result?.duration ?? snapshot.job.duration);
  const reviews = snapshot.reviews ?? [];
  const status = identityStatus(reviews, duration);
  const result = snapshot.result;
  const pc = (n?: number) => n === undefined ? 'Not measured' : `${Math.round(n * 100)}%`;
  async function save() {
    setSaving(true); setError('');
    try {
      const response = await fetch('/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'review', run: snapshot.job.id,
        review: { start, end, method, outcome, reviewer: 'user', text },
      }) });
      const data = await response.json(); if (!response.ok) throw Error(data.error);
      await onSaved(); setText('');
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  return <section className="pl-identity" aria-label="Identity review">
    <div className="pl-metrics">
      <div><span>PRIMARY ASSIGNMENT</span><strong>{pc(result?.coverage)}</strong><p>Assigned a body; does not certify identity.</p></div>
      <div><span>USABLE POSE COVERAGE</span><strong>{pc(result?.poseCoverage)}</strong><p>All 12 major limb/torso joints visible and in frame.</p></div>
      <div><span>MULTIPLE-BODY FRAMES</span><strong>{result?.multipleBodyFrames ?? 'Not measured'}</strong><p>{snapshot.job.trackingMode === 'solo' ? 'Excluded by the solo gate.' : 'Older run used group association.'}</p></div>
      <div><span>IDENTITY REVIEW</span><strong className={status === 'Issues flagged' ? 'pl-review-issue' : ''}>{status}</strong><p>Visual review is separate from model scores.</p></div>
    </div>
    <details className="pl-review-form"><summary>Record an identity check <span>{reviews.length} saved</span></summary>
      <p>Review the video and skeleton together. Record only the interval you inspected. Sample checks do not certify the rest of a passage.</p>
      <div className="pl-review-fields">
        <label>Review method<select aria-label="Identity review method" value={method} onChange={e => setMethod(e.target.value as typeof method)}><option value="sampled">Sampled frames</option><option value="continuous">Watched every frame in interval</option></select></label>
        <label>From / seconds<input aria-label="Identity review start" type="number" min={0} max={duration} step="0.001" value={start} onChange={e => setStart(Number(e.target.value))} /></label>
        <label>To / seconds<input aria-label="Identity review end" type="number" min={0} max={duration} step="0.001" value={end} onChange={e => setEnd(Number(e.target.value))} /></label>
        <label>Observation<select aria-label="Identity review outcome" value={outcome} onChange={e => setOutcome(e.target.value as typeof outcome)}><option value="clear">Intended person throughout inspected material</option><option value="issue">Wrong person or ambiguous identity</option></select></label>
      </div>
      <div className="pl-review-shortcuts"><button onClick={() => { const t = Math.min(duration, Number(time.toFixed(3))); setStart(t); setEnd(t); setMethod('sampled'); }}>Use current frame</button><button onClick={() => { setStart(0); setEnd(duration); }}>Use full passage bounds</button><span>Clip timestamps; add {snapshot.job.start}s for original video.</span></div>
      <label className="pl-review-text">Evidence / observations<textarea aria-label="Identity review evidence" value={text} maxLength={2000} onChange={e => setText(e.target.value)} placeholder="Which frames did you inspect? Note any identity switch, overlap, mirror, or uncertain match." /></label>
      <button className="pl-review-save" disabled={snapshot.state !== 'complete' || !text.trim() || saving} onClick={save}>{saving ? 'Saving…' : 'Save identity check'}</button>
      {error && <p role="alert" className="pl-review-issue">{error}</p>}
      <div className="pl-review-records">{[...reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(r => <button key={r.id} onClick={() => onSeek(r.start)}><b>{r.start.toFixed(2)}–{r.end.toFixed(2)}s · {r.method} · {r.outcome === 'issue' ? 'issue flagged' : 'clear in inspected material'} · {r.reviewer}</b><span>{r.text}</span></button>)}</div>
    </details>
  </section>;
}
