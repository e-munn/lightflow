import type { BrightnessDefault, BrightnessMode } from './movement-brightness';
import type { TimingEvidence } from './brightness-timing';

export type MusicEvidence = { t: number; rms: number; flux: number };
export type MusicContext = {
  bpm: number | null; confidence: number; texture: 'percussive' | 'mixed' | 'sustained' | 'quiet';
  percussiveness: number; density: number; continuity: number; duration: number;
  timing?: TimingEvidence;
};
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const quantile = (x: number[], p: number) => { const sorted = x.slice().sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * p)] ?? 0; };

/** Descriptive audio cues, not semantic genre/emotion recognition. Tempo is an
 * approximate periodicity estimate: half/double-time ambiguity remains possible.
 * Input is the complete recorded excerpt on a uniform 20 ms analysis clock. */
export function analyzeMusic(frames: MusicEvidence[]): MusicContext {
  const empty: MusicContext = { bpm: null, confidence: 0, texture: 'quiet', percussiveness: 0, density: 0, continuity: 0, duration: 0 };
  if (frames.length < 20 || frames.some(f => ![f.t, f.rms, f.flux].every(Number.isFinite))) return empty;
  const duration = frames[frames.length - 1].t - frames[0].t;
  const step = duration / (frames.length - 1);
  if (step <= 0 || frames.slice(1).some((f, i) => Math.abs(f.t - frames[i].t - step) > step * .1)) return empty;
  const rms = frames.map(f => f.rms), high = quantile(rms, .9);
  if (high < .0001) return { ...empty, duration };
  const flux = frames.map((f, i) => i < Math.ceil(.15 / step) ? 0 : Math.max(0, f.flux));
  const mean = flux.reduce((a, b) => a + b, 0) / flux.length;
  const median = quantile(flux, .5), mad = quantile(flux.map(x => Math.abs(x - median)), .5);
  const threshold = Math.max(.00001, median + 2.5 * mad, mean * 1.5);
  const peaks: number[] = [];
  for (let i = 1; i < flux.length - 1; i++) {
    if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] > flux[i + 1]) {
      const last = peaks[peaks.length - 1];
      if (last !== undefined && (i - last) * step < .1) { if (flux[i] > flux[last]) peaks[peaks.length - 1] = i; }
      else peaks.push(i);
    }
  }
  const continuity = clamp(quantile(rms, .2) / Math.max(.0001, quantile(rms, .8)));
  const crest = quantile(peaks.map(i => flux[i]), .5) / Math.max(.00001, mean);
  const attack = quantile(peaks.map(i => {
    const prior = rms.slice(Math.max(0, i - Math.round(.12 / step)), i);
    return clamp((rms[i] - quantile(prior, .5)) / Math.max(.0001, rms[i]));
  }), .5);
  const percussiveness = peaks.length < 3 ? 0 : clamp(.65 * clamp((crest - 1.5) / 5) + .35 * attack);
  const density = peaks.length / Math.max(.02, duration);
  const texture = percussiveness > .55 ? 'percussive' : percussiveness < .28 && continuity > .55 ? 'sustained' : 'mixed';

  // Mean-centered autocorrelation rejects a steady bed. Require repeat evidence
  // in BOTH halves so a few accidental intervals do not establish a tempo.
  const cap = Math.max(.00001, quantile(flux, .98) * 2);
  const novelty = flux.map(v => Math.min(cap, Math.max(0, v - median)));
  const average = novelty.reduce((a, b) => a + b, 0) / novelty.length;
  const x = novelty.map(v => v - average);
  const correlation = (lag: number, from = 0, to = x.length) => {
    let cross = 0, a = 0, b = 0;
    for (let i = from + lag; i < to; i++) { cross += x[i] * x[i - lag]; a += x[i] ** 2; b += x[i - lag] ** 2; }
    return cross / Math.max(1e-12, Math.sqrt(a * b));
  };
  const lo = Math.round(60 / 180 / step), hi = Math.round(60 / 70 / step);
  const scores = Array.from({ length: hi + 2 }, (_, lag) => lag < lo - 1 ? 0 : correlation(lag));
  const candidates = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter(lag => scores[lag] >= scores[lag - 1] && scores[lag] >= scores[lag + 1]);
  const top = Math.max(0, ...candidates.map(lag => scores[lag]));
  // Prefer the shorter period only when the correlation evidence is comparable.
  const best = candidates.find(lag => scores[lag] >= top * .92) ?? lo;
  const contrast = scores[best] - quantile(scores.slice(lo, hi + 1), .5);
  const half = Math.floor(x.length / 2);
  const consistent = Math.min(correlation(best, 0, half), correlation(best, half, x.length));
  const confidence = clamp(Math.min(scores[best], consistent) * Math.min(1, Math.max(0, contrast) / .2));
  let bpm: number | null = null;
  if (duration >= 8 && peaks.length >= 8 && scores[best] >= .3 && contrast >= .15 && consistent >= .2) {
    const a = scores[best - 1], b = scores[best], c = scores[best + 1];
    const offset = Math.max(-.5, Math.min(.5, .5 * (a - c) / (a - 2 * b + c || 1)));
    bpm = Math.round(60 / ((best + offset) * step));
  }
  return { bpm, confidence, texture, percussiveness, density, continuity, duration };
}

/** Sensitivity stays grounded in movement range. Music supplies the time scale
 * and a texture-dependent release policy, without moving or inventing gestures. */
export function musicBrightnessDefault(base: BrightnessDefault, mode: BrightnessMode, music: MusicContext | null): BrightnessDefault {
  if (!music || mode === 'off') return base;
  if (!music.bpm) return { ...base, reason: `Beat uncertain · ${music.texture} audio. ${base.reason}` };
  const beatMs = 60000 / music.bpm;
  const sustain = 1 - music.percussiveness;
  const beats = mode === 'snap' ? .25 + .25 * sustain : mode === 'stops' ? .375 + .375 * sustain : mode === 'hold' || mode === 'open' ? .75 + .75 * sustain : .5 + .5 * sustain;
  const hitsPerBeat = music.density * beatMs / 1000;
  const densityFactor = Math.max(.7, 1 / (1 + .15 * Math.max(0, hitsPerBeat - 2)));
  const fade = Math.round(Math.max(40, Math.min(500, beatMs * beats * densityFactor / Math.log(10))) / 10) * 10;
  return { ...base, fade, reason: `~${music.bpm} BPM · ${music.texture} audio. Fade loses 90% in ~${(beats * densityFactor).toFixed(2)} beats; sensitivity follows the movement range.` };
}
