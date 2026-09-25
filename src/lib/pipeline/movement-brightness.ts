import type { PoseFrame } from './types';

export const BRIGHTNESS_MODES = [
  { id: 'motion', label: 'Motion', description: 'Brighter with movement. The more active limb group leads.' },
  { id: 'arms', label: 'Arms', description: 'Elbows and wrists drive the light. Leg movement is ignored.' },
  { id: 'legs', label: 'Legs', description: 'Knees and ankles drive the light. Arm movement is ignored.' },
  { id: 'snap', label: 'Snap', description: 'Brief flashes when movement suddenly accelerates.' },
  { id: 'stops', label: 'Stops', description: 'Flash on a confirmed slowdown after a fast gesture.' },
  { id: 'hold', label: 'Hold', description: 'Brighten during relative stillness after movement, then fade.' },
  { id: 'open', label: 'Open', description: 'Open poses brighten; contracted poses dim. Position, not speed.' },
  { id: 'off', label: 'Off', description: 'Black background. Keep the skeleton as your reference.' },
] as const;
export type BrightnessMode = typeof BRIGHTNESS_MODES[number]['id'];
type Signals = Record<Exclude<BrightnessMode, 'off'>, number | null>;
export type BrightnessFrame = Signals & { t: number; index: number; reset?: boolean };
export type BrightnessDefault = { gain: number; fade: number; events: number; spacingMs: number | null; coverage: number; measured: boolean; reason: string };
type Point = [number, number];
type MetricFrame = { frame: PoseFrame; reset: boolean; arms: number | null; legs: number | null; open: number | null; complete: boolean };
const ARMS = [13, 14, 15, 16], LEGS = [25, 26, 27, 28];
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const valid = (p?: number[]) => !!p && p.length >= 4 && p[3] >= .5 && p.slice(0, 2).every(v => Number.isFinite(v) && v >= 0 && v <= 1);
const percentile = (values: number[], p: number, fallback: number) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) * p)] : fallback;
};
const blank = (): Signals => ({ motion: null, arms: null, legs: null, snap: null, stops: null, hold: null, open: null });

/** Recorded-passage audition, not an audio predictor. Clip-wide robust calibration
 * uses future data; temporal filters/events use only the current and earlier poses.
 * Fixed metric filtering is independent of the user's skeleton display smoothing.
 */
export function movementBrightness(frames: PoseFrame[], aspect: number, fadeMs = 160): BrightnessFrame[] {
  const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const torsoLengths = frames.flatMap(f => {
    const p = f.primary === null ? null : f.poses[f.primary];
    if (!p || ![11, 12, 23, 24].every(i => valid(p[i]))) return [];
    return [Math.hypot((p[11][0] + p[12][0] - p[23][0] - p[24][0]) * ratio / 2, (p[11][1] + p[12][1] - p[23][1] - p[24][1]) / 2)];
  });
  const scale = Math.max(.025, percentile(torsoLengths, .5, .2));
  let previous: PoseFrame | null = null;
  let points = new Map<number, Point>();
  let groupState: { mask: string; speed: number }[] = [];
  const metrics: MetricFrame[] = frames.map(frame => {
    const dt = previous ? frame.t - previous.t : 0;
    const reset = !previous || dt <= 0 || dt > .15 || frame.cut || frame.track !== previous.track;
    previous = frame;
    const pose = frame.primary === null ? null : frame.poses[frame.primary];
    if (reset) { points.clear(); groupState = []; }
    if (!pose || ![11, 12, 23, 24].every(i => valid(pose[i]))) {
      points.clear(); groupState = [];
      return { frame, reset: true, arms: null, legs: null, open: null, complete: false };
    }
    // Hip-relative coordinates reject image translation. A fixed torso scale avoids
    // artificial velocity from a frame-by-frame changing normalization factor.
    const cx = (pose[23][0] + pose[24][0]) / 2, cy = (pose[23][1] + pose[24][1]) / 2;
    const speeds = new Map<number, number>();
    const distances: number[] = [];
    for (const i of [...ARMS, ...LEGS]) {
      if (!valid(pose[i])) { points.delete(i); continue; }
      const raw: Point = [(pose[i][0] - cx) * ratio / scale, (pose[i][1] - cy) / scale];
      const old = points.get(i);
      const a = 1 - Math.exp(-dt / .035);
      const filtered: Point = old ? [old[0] + a * (raw[0] - old[0]), old[1] + a * (raw[1] - old[1])] : raw;
      points.set(i, filtered);
      if ([15, 16, 27, 28].includes(i)) distances.push(Math.hypot(...filtered));
      if (old && dt > 0) speeds.set(i, Math.hypot(filtered[0] - old[0], filtered[1] - old[1]) / dt);
    }
    const group = (indices: number[], index: number) => {
      const present = indices.filter(i => speeds.has(i)), mask = present.join(',');
      if (present.length < 2) { groupState[index] = { mask: '', speed: 0 }; return null; }
      const rms = Math.sqrt(present.reduce((sum, i) => sum + speeds.get(i)! ** 2, 0) / present.length);
      const old = groupState[index], a = 1 - Math.exp(-dt / .045);
      const speed = old?.mask === mask ? old.speed + a * (rms - old.speed) : rms;
      groupState[index] = { mask, speed };
      return speed;
    };
    return { frame, reset, arms: group(ARMS, 0), legs: group(LEGS, 1), open: distances.length === 4 ? distances.reduce((s, v) => s + v, 0) / 4 : null, complete: speeds.size === 8 };
  });

  const arm95 = Math.max(.45, percentile(metrics.flatMap(m => m.arms === null ? [] : [m.arms]), .95, 1));
  const leg95 = Math.max(.45, percentile(metrics.flatMap(m => m.legs === null ? [] : [m.legs]), .95, 1));
  const openings = metrics.flatMap(m => m.open === null ? [] : [m.open]);
  const open05 = percentile(openings, .05, 0), open95 = percentile(openings, .95, 1);
  const norm = (v: number | null, high: number) => v === null ? null : clamp((v - .06) / (high - .06));
  const quiet = Math.max(.12, Math.min(.32, percentile(metrics.filter(m => m.complete).map(m => Math.max(norm(m.arms, arm95) ?? 0, norm(m.legs, leg95) ?? 0)), .25, .12)));
  let lastTime: number | null = null, eventReady = false;
  let slow = 0, recentPeak = 0, stopSince: number | null = null, stillSince: number | null = null;
  let lastActive = -Infinity, lastSnap = -Infinity, lastStop = -Infinity;
  const signals = metrics.map(m => {
    const dt = lastTime === null ? 0 : m.frame.t - lastTime; lastTime = m.frame.t;
    const arms = norm(m.arms, arm95), legs = norm(m.legs, leg95);
    const motion = arms === null ? legs : legs === null ? arms : Math.max(arms, legs);
    const open = m.open === null ? null : clamp((m.open - open05) / Math.max(.25, open95 - open05));
    if (m.reset) eventReady = false;
    let snap: number | null = null, stops: number | null = null, hold: number | null = null;
    if (!m.complete || motion === null) {
      eventReady = false;
    } else if (!eventReady) {
      slow = motion; recentPeak = motion; stopSince = null; stillSince = null;
      lastActive = lastSnap = lastStop = -Infinity; eventReady = true;
      snap = stops = hold = 0;
    } else {
      snap = stops = hold = 0;
      // An attack is a rise over recent activity, not every fast moving frame.
      const rise = motion - slow;
      if (rise > .16 && m.frame.t - lastSnap > .18) { snap = clamp(rise / .42); lastSnap = m.frame.t; }
      slow += (1 - Math.exp(-dt / .22)) * (motion - slow);
      recentPeak = Math.max(motion, recentPeak * Math.exp(-dt / .8));
      if (recentPeak > .4 && motion < recentPeak * .65) {
        stopSince ??= m.frame.t;
        if (m.frame.t - stopSince >= .06 && m.frame.t - lastStop > .3) {
          stops = clamp(recentPeak / .65); lastStop = m.frame.t; recentPeak = motion; stopSince = null;
        }
      } else stopSince = null;
      if (motion > .4) lastActive = m.frame.t;
      if (motion < quiet) {
        stillSince ??= m.frame.t;
        const age = m.frame.t - stillSince;
        if (stillSince - lastActive < 1.2 && age > .1) hold = Math.min(1, (age - .1) / .06) * Math.exp(-Math.max(0, age - 1) / .5);
      } else stillSince = null;
    }
    return { t: m.frame.t, index: m.frame.index, reset: m.reset, arms, legs, motion, snap, stops, hold, open };
  });
  return applyBrightnessFade(signals, fadeMs);
}

/** Zero release exposes the pre-envelope metric for calibration, never for guessing
 * new events from already prolonged light. Original signals are left untouched. */
export function applyBrightnessFade(signals: BrightnessFrame[], fadeMs: number): BrightnessFrame[] {
  if (fadeMs <= 0) return signals;
  const release = Math.max(.04, Math.min(.8, fadeMs / 1000));
  let levels = blank(), lastTime: number | null = null;
  return signals.map(frame => {
    const dt = lastTime === null ? 0 : frame.t - lastTime; lastTime = frame.t;
    if (frame.reset || dt <= 0 || dt > .15) levels = blank();
    for (const key of Object.keys(levels) as (keyof Signals)[]) {
      const v = frame[key], old = levels[key];
      // Confidence loss is unavailable, not a reason to sustain a stale light.
      levels[key] = v === null ? null : Math.max(v, (old ?? 0) * Math.exp(-Math.max(0, dt) / release));
    }
    return { ...frame, ...levels };
  });
}

/** An explicit starting-point policy, not an estimate of the user's taste.
 * Strong observed peaks target 90% screen level. Release loses 90% of a peak
 * within half the median inter-gesture interval. Full-passage calibration is
 * frozen for playback/seeking; it is not a causal live-input controller. */
export function deriveBrightnessDefaults(signals: BrightnessFrame[]): Record<BrightnessMode, BrightnessDefault> {
  const defaults = {} as Record<BrightnessMode, BrightnessDefault>;
  for (const { id: mode } of BRIGHTNESS_MODES) {
    const fallback: BrightnessDefault = { gain: 1, fade: 120, events: 0, spacingMs: null, coverage: 0, measured: false, reason: 'Too little reliable movement; using a neutral starting point.' };
    if (mode === 'off') { defaults[mode] = { ...fallback, reason: 'Background off.' }; continue; }
    const peaks: { t: number; value: number; segment: number }[] = [];
    const samples: { value: number; seconds: number }[] = [];
    let previous: BrightnessFrame | null = null, segment = 0, validSeconds = 0, totalSeconds = 0;
    let trough = 0, peak = 0, peakTime = 0, rising = false;
    for (const frame of signals) {
      const value = frame[mode], dt = previous ? frame.t - previous.t : 0;
      const oldValue = previous?.[mode];
      const connected = previous && dt > 0 && dt <= .15 && !frame.reset && value !== null && oldValue !== null;
      if (dt > 0) totalSeconds += dt;
      if (connected && value !== null) {
        validSeconds += dt; samples.push({ value, seconds: dt });
        // Require a visible rise AND fall, not each tiny jitter or a boundary.
        // Short adjacent maxima merge; missing tracking always starts a new segment.
        if (!rising) {
          trough = Math.min(trough, value);
          if (value - trough >= .12) { rising = true; peak = value; peakTime = frame.t; }
        } else {
          if (value > peak) { peak = value; peakTime = frame.t; }
          if (peak - value >= .12) {
            const last = peaks[peaks.length - 1];
            if (last?.segment === segment && peakTime - last.t < .16) {
              if (peak > last.value) { last.value = peak; last.t = peakTime; }
            } else peaks.push({ t: peakTime, value: peak, segment });
            rising = false; trough = value;
          }
        }
      } else { segment++; rising = false; trough = value ?? 0; }
      previous = frame;
    }
    const coverage = totalSeconds > 0 ? validSeconds / totalSeconds : 0;
    const intervals = peaks.flatMap((peak, i) => i > 0 && peak.segment === peaks[i - 1].segment ? [peak.t - peaks[i - 1].t] : []);
    const timed = validSeconds >= 2 && coverage >= .7 && intervals.length >= 3;
    // Continuous metrics use time-weighted levels when peaks are sparse. Pulse
    // metrics use actual event peaks so many zero frames cannot inflate gain.
    const sorted = samples.slice().sort((a, b) => a.value - b.value);
    let elapsed = 0, level95 = 0;
    for (const sample of sorted) { elapsed += sample.seconds; if (elapsed >= validSeconds * .95) { level95 = sample.value; break; } }
    const strong = peaks.length >= 4 ? percentile(peaks.map(p => p.value), .9, 0) : level95;
    const enough = validSeconds >= 2 && coverage >= .7 && strong >= .15;
    const spacingMs = timed ? Math.round(percentile(intervals, .5, 0) * 1000) : null;
    // Quantize to the existing sliders; bounded gain never rescues weak noise.
    const gain = enough ? Math.round(Math.max(.65, Math.min(1.5, .9 / strong)) * 20) / 20 : 1;
    const fade = spacingMs === null ? 120 : Math.round(Math.max(40, Math.min(350, .5 * spacingMs / Math.log(10))) / 10) * 10;
    defaults[mode] = { gain, fade, events: peaks.length, spacingMs, coverage, measured: enough && timed,
      reason: enough && timed
        ? `Strong gestures target 90% brightness; fade follows ${spacingMs} ms typical gesture spacing.`
        : enough ? 'Brightness follows this passage; too few separate gestures to estimate fade, so it starts at 120 ms.' : fallback.reason };
  }
  return defaults;
}

export function brightnessAt(frames: BrightnessFrame[], time: number | null, mode: BrightnessMode, gain: number) {
  if (time === null || mode === 'off') return { value: 0, available: true };
  let lo = 0, hi = frames.length - 1, found = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (frames[mid].t <= time + .001) { found = mid; lo = mid + 1; } else hi = mid - 1; }
  const frame = found < 0 || time - frames[found].t >= .15 ? null : frames[found];
  const value = frame?.[mode] ?? null;
  return { value: value === null ? 0 : clamp(value * gain), available: value !== null };
}

export class MovementBrightnessCache {
  private input: PoseFrame[] | null = null;
  private aspect = 0;
  private fade = -1;
  private raw: BrightnessFrame[] = [];
  private calibration: Record<BrightnessMode, BrightnessDefault> | null = null;
  private output: BrightnessFrame[] = [];
  private prepare(input: PoseFrame[], aspect: number) {
    if (input !== this.input || aspect !== this.aspect) {
      this.input = input; this.aspect = aspect; this.fade = -1;
      this.raw = movementBrightness(input, aspect, 0); this.calibration = null;
    }
  }
  defaults(input: PoseFrame[], aspect: number) {
    this.prepare(input, aspect);
    return this.calibration ??= deriveBrightnessDefaults(this.raw);
  }
  frames(input: PoseFrame[], aspect: number, fadeMs: number) {
    this.prepare(input, aspect);
    if (fadeMs !== this.fade) { this.fade = fadeMs; this.output = applyBrightnessFade(this.raw, fadeMs); }
    return this.output;
  }
}
