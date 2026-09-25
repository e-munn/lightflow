import type { BrightnessFrame } from './movement-brightness';
import type { MusicContext, MusicEvidence } from './music-context';

export type AudioAccent = { t: number; availableAt: number; strength: number };
export type TimingEvidence = { accents: AudioAccent[]; energyAnchors: AudioAccent[]; grid: { period: number; phase: number; confidence: number } | null; frames: MusicEvidence[]; rms95: number };
export type TimingControl = 'candidate' | 'snap' | 'audio' | 'rms';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const q = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] ?? 0; };

/** Whole-clip scaling, locally prominent peaks, explicit 20 ms confirmation.
 * RMS-rise anchors use a separate feature from the spectral construction cue.
 * Neither detector, nor the phase grid, is a human beat annotation. */
export function audioTiming(frames: MusicEvidence[], music: MusicContext): TimingEvidence {
  const accents: AudioAccent[] = [], energyAnchors: AudioAccent[] = [];
  const rms95 = q(frames.map(f => f.rms), .95), flux95 = q(frames.map(f => f.flux), .95);
  const rises = frames.map((f, i) => Math.max(0, Math.log((f.rms + 1e-5) / (q(frames.slice(Math.max(0, i - 4), i).map(p => p.rms), .5) + 1e-5))));
  for (let i = 2; i < frames.length - 1; i++) {
    const f = frames[i], prior = frames.slice(Math.max(0, i - 50), i).map(p => p.flux);
    if (f.t < .3 || f.rms < Math.max(.0001, rms95 * .025)) continue;
    const median = q(prior, .5), mad = q(prior.map(v => Math.abs(v - median)), .5);
    const threshold = Math.max(.00001, flux95 * .15, median + 2.5 * mad);
    if (f.flux > threshold && f.flux >= frames[i - 1].flux && f.flux > frames[i + 1].flux && (!accents.length || f.t - accents[accents.length - 1].t >= .1)) {
      accents.push({ t: f.t, availableAt: frames[i + 1].t, strength: clamp(f.flux / Math.max(.00001, flux95)) });
    }
    if (rises[i] > .18 && rises[i] >= rises[i - 1] && rises[i] > rises[i + 1] && (!energyAnchors.length || f.t - energyAnchors[energyAnchors.length - 1].t >= .12)) {
      energyAnchors.push({ t: f.t, availableAt: frames[i + 1].t, strength: clamp(rises[i]) });
    }
  }
  let grid: TimingEvidence['grid'] = null;
  if (music.bpm && energyAnchors.length >= 8) {
    const period = 60 / music.bpm;
    let c = 0, s = 0, total = 0;
    for (const a of energyAnchors) { c += Math.cos(2 * Math.PI * a.t / period) * a.strength; s += Math.sin(2 * Math.PI * a.t / period) * a.strength; total += a.strength; }
    const confidence = Math.hypot(c, s) / Math.max(1e-6, total);
    if (confidence >= .35) grid = { period, phase: ((Math.atan2(s, c) / (2 * Math.PI)) * period + period) % period, confidence };
  }
  return { accents, energyAnchors, grid, frames, rms95 };
}

export type TimingStudy = { v2: BrightnessFrame[]; v3: BrightnessFrame[]; audio: BrightnessFrame[]; rms: BrightnessFrame[]; accepted: number[]; rejected: number[]; original: number[] };

/** V2 keeps movement timing intact and rejects hits without recent audio support.
 * V3 changes ONLY amplitude at those same hits; it does not manufacture a beat.
 * Both candidates have zero extra lookahead beyond the cue's explicit availability.
 * All arrays use the existing source-pose clock, so video-frame quantization remains.
 */
export function timingStudy(raw: BrightnessFrame[], timing: TimingEvidence): TimingStudy {
  const v2: BrightnessFrame[] = [], v3: BrightnessFrame[] = [], audio: BrightnessFrame[] = [], rms: BrightnessFrame[] = [];
  const accepted: number[] = [], rejected: number[] = [], original: number[] = [];
  let cue = -1, audioFrame = -1;
  for (const frame of raw) {
    let audioHit = 0;
    while (cue + 1 < timing.accents.length && timing.accents[cue + 1].availableAt <= frame.t + .001) {
      cue++; if (frame.t - timing.accents[cue].availableAt <= .15) audioHit = Math.max(audioHit, timing.accents[cue].strength);
    }
    while (audioFrame + 1 < timing.frames.length && timing.frames[audioFrame + 1].t <= frame.t + .001) audioFrame++;
    const latest = cue >= 0 ? timing.accents[cue] : null;
    const support = !!latest && frame.t - latest.availableAt <= .12;
    const hit = frame.snap;
    if (hit !== null && hit > 0) { original.push(frame.t); (support ? accepted : rejected).push(frame.t); }
    const gated = hit === null ? null : support ? hit : 0;
    const phrase = gated === null || frame.open === null ? null : gated * (.25 + .75 * frame.open);
    // Controls share the same visibility mask, clock and release to isolate the
    // mapping. They are controls for this teacher study, not live-audio products.
    const audioValue = frame.snap === null ? null : audioHit;
    const e = timing.frames[audioFrame];
    const rmsValue = frame.snap === null || !e || frame.t - e.t > .15 ? null : clamp(e.rms / Math.max(.0001, timing.rms95));
    v2.push({ ...frame, snap: gated, open: gated });
    v3.push({ ...frame, snap: phrase, open: phrase });
    audio.push({ ...frame, snap: audioValue, open: audioValue });
    rms.push({ ...frame, snap: rmsValue, open: rmsValue });
  }
  return { v2, v3, audio, rms, accepted, rejected, original };
}

export class TimingStudyCache {
  private raw: BrightnessFrame[] | null = null;
  private timing: TimingEvidence | null = null;
  private result: TimingStudy | null = null;
  study(raw: BrightnessFrame[], timing: TimingEvidence) {
    if (this.raw !== raw || this.timing !== timing) { this.raw = raw; this.timing = timing; this.result = timingStudy(raw, timing); }
    return this.result!;
  }
}
