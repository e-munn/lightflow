import type { BrightnessDefault, BrightnessFrame } from './movement-brightness';
import type { MusicContext } from './music-context';
import type { AudioAccent, TimingEvidence } from './brightness-timing';

const q = (a: number[], p: number) => { const values = a.slice().sort((x, y) => x - y); return values[Math.floor((values.length - 1) * p)] ?? 0; };
export type PhraseEvent = { t: number; accentTime: number; availableAt: number; amplitude: number | null; open: number | null; wrongAmplitude: number | null };
export type PhraseStudy = { candidate: BrightnessFrame[]; constant: BrightnessFrame[]; wrong: BrightnessFrame[]; selected: AudioAccent[]; events: PhraseEvent[]; refractory: number };

export function strongAccents(timing: TimingEvidence, bpm: number | null) {
  const refractory = bpm && bpm > 0 ? Math.max(.18, Math.min(.3, 30 / bpm)) : .25;
  const selected: AudioAccent[] = [];
  for (const accent of timing.accents) {
    if (accent.strength < .9 || ![accent.t, accent.availableAt, accent.strength].every(Number.isFinite)) continue;
    if (!selected.length || accent.availableAt - selected[selected.length - 1].availableAt >= refractory) selected.push(accent);
  }
  return { selected, refractory };
}

/** One audio event clock, two amplitude hypotheses. No expansion-driven event
 * creation, predictive audio model, or implicit timestamp shifting. */
export function phraseStudy(raw: BrightnessFrame[], timing: TimingEvidence, bpm: number | null, other: BrightnessFrame[] = []): PhraseStudy {
  const { selected, refractory } = strongAccents(timing, bpm);
  const candidate: BrightnessFrame[] = [], constant: BrightnessFrame[] = [], wrong: BrightnessFrame[] = [], events: PhraseEvent[] = [];
  let cursor = -1, otherCursor = -1, lastTime: number | null = null;
  let open: number | null = null, wrongOpen: number | null = null;
  for (const frame of raw) {
    const dt = lastTime === null ? 0 : frame.t - lastTime; lastTime = frame.t;
    const reset = frame.reset || dt <= 0 || dt > .15;
    if (reset) { open = null; wrongOpen = null; }
    const a = 1 - Math.exp(-Math.max(0, dt) / .2);
    open = frame.open === null ? null : open === null ? frame.open : open + a * (frame.open - open);
    while (otherCursor + 1 < other.length && other[otherCursor + 1].t <= frame.t + .001) otherCursor++;
    const alternate = other[otherCursor];
    const otherValue = alternate && frame.t - alternate.t < .15 ? alternate.open : null;
    if (alternate?.reset) wrongOpen = null;
    wrongOpen = otherValue === null ? null : wrongOpen === null ? otherValue : wrongOpen + a * (otherValue - wrongOpen);
    let amplitude: number | null = open === null ? null : 0;
    let flat: number | null = open === null ? null : 0;
    let mismatch: number | null = open === null || wrongOpen === null ? null : 0;
    while (cursor + 1 < selected.length && selected[cursor + 1].availableAt <= frame.t + .001) {
      const accent = selected[++cursor];
      // A timestamp jump may skip an accent. Never replay it as a delayed flash.
      if (frame.t - accent.availableAt >= .15) continue;
      const level = open === null ? null : .25 + .75 * open;
      const wrongLevel = open === null || wrongOpen === null ? null : .25 + .75 * wrongOpen;
      amplitude = level; flat = open === null ? null : .625; mismatch = wrongLevel;
      events.push({ t: frame.t, accentTime: accent.t, availableAt: accent.availableAt, amplitude: level, open, wrongAmplitude: wrongLevel });
    }
    candidate.push({ ...frame, snap: amplitude, open: amplitude });
    constant.push({ ...frame, snap: flat, open: flat });
    wrong.push({ ...frame, snap: mismatch, open: mismatch });
  }
  return { candidate, constant, wrong, selected, events, refractory };
}

/** Fallback timing is derived from AUDIO-event spacing, not movement frequency. */
export function phraseBaseDefault(study: PhraseStudy): BrightnessDefault {
  const amplitudes = study.events.flatMap(e => e.amplitude === null ? [] : [e.amplitude]);
  const p90 = q(amplitudes, .9), enough = amplitudes.length >= 4;
  const gain = enough ? Math.round(Math.max(.65, Math.min(1.5, .9 / Math.max(.25, p90))) * 20) / 20 : 1;
  const intervals = study.selected.slice(1).map((e, i) => e.availableAt - study.selected[i].availableAt);
  const spacingMs = intervals.length >= 3 ? Math.round(q(intervals, .5) * 1000) : null;
  const fade = spacingMs === null ? 160 : Math.round(Math.max(50, Math.min(350, .5 * spacingMs / Math.log(10))) / 10) * 10;
  return { gain, fade, events: amplitudes.length, spacingMs, coverage: study.events.length ? amplitudes.length / study.events.length : 0, measured: enough, reason: 'Strong audio accents set timing; Open shapes their brightness.' };
}

/** Match displayed, clamped time-average brightness on shared valid samples.
 * A report exposes unreachable targets rather than claiming a false match. */
export function matchBrightness(candidate: BrightnessFrame[], reference: BrightnessFrame[], candidateGain: number) {
  const mean = (frames: BrightnessFrame[], gain: number) => {
    let sum = 0, duration = 0;
    for (let i = 1; i < frames.length; i++) {
      const dt = frames[i].t - frames[i - 1].t;
      if (dt <= 0 || dt > .15 || candidate[i]?.open === null || reference[i]?.open === null || frames[i].reset) continue;
      duration += dt; sum += Math.min(1, Math.max(0, (frames[i].open ?? 0) * gain)) * dt;
    }
    return { value: duration ? sum / duration : 0, duration };
  };
  const target = mean(candidate, candidateGain);
  let lo = 0, hi = 8;
  for (let i = 0; i < 25; i++) { const mid = (lo + hi) / 2; if (mean(reference, mid).value < target.value) lo = mid; else hi = mid; }
  const achieved = mean(reference, hi).value;
  return { gain: hi, targetMean: target.value, actualMean: achieved, matched: target.duration > 0 && Math.abs(achieved - target.value) < .001, sharedSeconds: target.duration };
}

export class PhraseStudyCache {
  private input: BrightnessFrame[] | null = null;
  private music: MusicContext | null = null;
  private result: PhraseStudy | null = null;
  private base: BrightnessDefault | null = null;
  study(raw: BrightnessFrame[], music: MusicContext) {
    if (!music.timing) return null;
    if (raw !== this.input || music !== this.music) { this.input = raw; this.music = music; this.result = phraseStudy(raw, music.timing, music.bpm); this.base = phraseBaseDefault(this.result); }
    return { result: this.result!, base: this.base! };
  }
}
