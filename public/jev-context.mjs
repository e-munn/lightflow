/** Experimental Jev context selector. Audio measurements and brightness stay local. */
export const JEV_MODES = ['circle', 'grain', 'snap', 'sustain'];
export const JEV_OPTIONS = [...JEV_MODES, 'uncertain'];
export const JEV_INTERVAL_MS = 2000;
export const JEV_MAX_RESPONSE_AGE = 1.5;
export const JEV_TTL = 6;
const clamp = x => Math.max(0, Math.min(1, x));
const mean = (rows, key) => rows.reduce((sum, r) => sum + r[key], 0) / rows.length;

export class SignalContext {
  constructor() { this.reset(); }
  reset() { this.rows = []; this.above = false; }
  push(frame, metrics) {
    if (!Number.isFinite(frame?.at) || !Number.isFinite(frame?.rms) ||
        ['low', 'mid', 'high', 'onset', 'texture', 'flatness', 'build'].some(k => !Number.isFinite(metrics?.[k]))) {
      this.reset(); return;
    }
    const previous = this.rows.at(-1);
    if (previous && (frame.at <= previous.at || frame.at - previous.at > .25)) this.reset();
    const hit = metrics.onset > .32 && !this.above;
    this.above = metrics.onset > .18;
    this.rows.push({at: frame.at, rms: frame.rms, ...metrics, hit: Number(hit)});
    while (this.rows.length && frame.at - this.rows[0].at > 10) this.rows.shift();
  }
  snapshot() {
    const last = this.rows.at(-1);
    if (!last || last.at - this.rows[0].at < 1.98) return null;
    const current = this.rows.filter(r => last.at - r.at < 2);
    const previous = this.rows.filter(r => last.at - r.at >= 2);
    const summarize = rows => {
      if (!rows.length) return null;
      const duration = Math.min(10, rows.at(-1).at - rows[0].at + .02);
      const rms = mean(rows, 'rms');
      return {
        duration, rms,
        variation: Math.min(10, Math.sqrt(mean(rows.map(r => ({v: (r.rms - rms) ** 2})), 'v')) / Math.max(rms, 1e-7)),
        attacksPerSecond: rows.reduce((sum, r) => sum + r.hit, 0) / duration,
        low: mean(rows, 'low'), mid: mean(rows, 'mid'), high: mean(rows, 'high'),
        texture: mean(rows, 'texture'), flatness: mean(rows, 'flatness'), build: mean(rows, 'build'),
      };
    };
    return {at: last.at, current: summarize(current), previous: summarize(previous)};
  }
}

export function describeSnapshot(snapshot) {
  const c = snapshot.current, p = snapshot.previous;
  const delta = p ? 20 * Math.log10((c.rms + 1e-7) / (p.rms + 1e-7)) : null;
  return {
    evidence: 'Causal audio measurements, not instrument identification. Current window: trailing two seconds. Reference: earlier available audio, up to eight seconds. No future audio.',
    current: {
      level: c.rms < .00001 ? 'effectively silent' : c.rms < .008 ? 'low recorded level' : c.rms < .08 ? 'moderate recorded level' : 'strong recorded level',
      levelComparedWithEarlier: delta === null ? 'no earlier reference yet' : delta > 4 ? 'substantially louder' : delta < -4 ? 'substantially quieter' : 'similar level',
      attacks: c.attacksPerSecond < .3 ? 'few distinct attacks' : c.attacksPerSecond < 2 ? 'occasional distinct attacks' : 'frequent distinct attacks',
      continuity: c.variation < .12 ? 'very even energy' : c.variation < .4 ? 'connected but changing energy' : 'large gaps or energy swings',
      texture: c.texture > .45 || c.flatness > .4 ? 'rough or broadband texture' : 'relatively smooth or narrow texture',
      spectrum: c.low > .65 ? 'low frequencies dominate' : c.high > .3 ? 'substantial high-frequency detail' : c.mid > .65 ? 'midrange body dominates' : 'mixed frequency content',
      recentRise: c.build > .3 ? 'clear short-term rise in energy or spectral brightness' : c.build > .1 ? 'some short-term rise' : 'little short-term rise',
    },
    limits: 'Recording level depends on microphone gain. Frequency bands are not isolated instruments. Do not invent vocals, song names, sections, tempo, or the time of a future drop.',
  };
}

/** Confidence floor and dwell are provisional behavior settings, not calibrated accuracy. */
export class JevSelector {
  constructor() { this.reset(); }
  reset() {
    this.mode = 'circle'; this.from = 'circle'; this.changedAt = -Infinity;
    this.validAt = -Infinity; this.seenAt = -Infinity;
  }
  accept(decision, capturedAt, now) {
    if (!Number.isFinite(capturedAt) || !Number.isFinite(now) || capturedAt <= this.seenAt ||
        now < capturedAt || now - capturedAt > JEV_MAX_RESPONSE_AGE) return 'stale';
    this.seenAt = capturedAt;
    if (!JEV_MODES.includes(decision?.choice) || !Number.isFinite(decision.confidence) || decision.confidence < .55) return 'uncertain';
    if (decision.choice !== this.mode && now - this.changedAt < 2) return 'holding';
    this.validAt = capturedAt;
    if (decision.choice !== this.mode) {
      this.from = this.mode; this.mode = decision.choice; this.changedAt = now;
    }
    return 'accepted';
  }
  frame(values, now) {
    if (!Number.isFinite(now) || JEV_MODES.some(k => !Number.isFinite(values?.[k]))) {
      this.reset(); return {mode: 'circle', value: 0, fallback: true};
    }
    const fallback = now - this.validAt > JEV_TTL;
    if (fallback && this.mode !== 'circle') {
      this.from = this.mode; this.mode = 'circle'; this.changedAt = now;
    }
    const blend = clamp((now - this.changedAt) / .6);
    return {mode: this.mode, value: clamp(values[this.from] * (1 - blend) + values[this.mode] * blend), fallback};
  }
}
