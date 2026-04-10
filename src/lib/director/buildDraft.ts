/**
 * Build a StemSummary + DraftPlan from an analysis JSON file.
 *
 * The DraftPlan is the engine's section-by-section "taste" output,
 * produced BEFORE Claude sees anything. It encodes the same invariants
 * as src/lib/modulators.ts chooseNextMod() so Claude sees the engine's
 * actual decisions and only patches where it genuinely helps.
 */

import {
  DIRECTOR_VERSION,
} from '@/lib/modulators';
import type {
  StemSummary,
  DraftPlan,
  DraftSection,
  EventCandidateSchema,
  EffectInstance,
} from './schema';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Analysis JSON shape (matches public/songs/*_analysis.json)
// ---------------------------------------------------------------------------

interface AnalysisFrame {
  time: number;
  stems: {
    bass: number;
    kick: number;
    snare: number;
    hat: number;
    vocals: number;
    other: number;
  };
  centroid: number;
  onsets: { kick: number; snare: number; hat: number };
  spectral_flux: number;
}

interface AnalysisSection {
  start: number;
  end: number;
  label: string;
  energy_level: number;
  bass_presence: number;
  has_vocals: boolean;
}

export interface AnalysisJson {
  song: string;
  duration: number;
  bpm: number;
  bpm_confidence?: number;
  fps: number;
  sections: AnalysisSection[];
  frames: AnalysisFrame[];
}

type EventCandidate = z.infer<typeof EventCandidateSchema>;

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

const SUMMARY_FPS = 2; // 0.5s frames — compact, arrangement-level

function downsample(values: number[], srcFps: number, dstFps: number): number[] {
  if (srcFps === dstFps) return values;
  const ratio = srcFps / dstFps;
  const out: number[] = [];
  for (let i = 0; i < values.length; i += ratio) {
    const start = Math.floor(i);
    const end = Math.min(values.length, Math.floor(i + ratio));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end; j++) {
      sum += values[j];
      n++;
    }
    out.push(n > 0 ? +(sum / n).toFixed(3) : 0);
  }
  return out;
}

function extractOnsetTimes(
  frames: AnalysisFrame[],
  key: 'kick' | 'snare' | 'hat',
  threshold = 0.3,
): number[] {
  const out: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const cur = frames[i].onsets[key];
    const prev = frames[i - 1].onsets[key];
    if (cur > threshold && prev <= threshold) {
      out.push(+frames[i].time.toFixed(3));
    }
  }
  return out;
}

function computeDownbeats(bpm: number, duration: number): number[] {
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const out: number[] = [];
  for (let t = 0; t < duration; t += barSec) {
    out.push(+t.toFixed(3));
  }
  return out;
}

function nearestDownbeat(t: number, downbeats: number[]): number {
  if (downbeats.length === 0) return t;
  let best = downbeats[0];
  let bestDist = Math.abs(t - best);
  for (const d of downbeats) {
    const dist = Math.abs(t - d);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

function detectEvents(
  analysis: AnalysisJson,
  summary: { duration: number; downbeats: number[] },
): EventCandidate[] {
  const events: EventCandidate[] = [];
  const frames = analysis.frames;
  const sections = analysis.sections;

  // 1. Drop candidates — detected by frame-level energy, NOT librosa labels.
  // A drop is: low/falling bass+drum energy → sharp rise to sustained high
  // bass+drum energy over <1s, with vocals absent or low. Walks the frame
  // array directly so it works even when librosa merges a drop into a
  // longer section.
  const dropFps = analysis.fps;
  const lookback = dropFps;
  const forward = dropFps;
  for (let i = lookback; i < frames.length - forward; i += Math.floor(dropFps / 2)) {
    const prevWin = frames.slice(i - lookback, i);
    const nextWin = frames.slice(i, i + forward);
    const prevLow =
      prevWin.reduce(
        (s, f) => s + Math.max(f.stems.bass, f.stems.kick),
        0,
      ) / prevWin.length;
    const nextHigh =
      nextWin.reduce(
        (s, f) => s + Math.max(f.stems.bass, f.stems.kick),
        0,
      ) / nextWin.length;
    const vocalsNext =
      nextWin.reduce((s, f) => s + f.stems.vocals, 0) / nextWin.length;
    if (nextHigh - prevLow > 0.35 && nextHigh > 0.5 && vocalsNext < 0.3) {
      events.push({
        t: nearestDownbeat(frames[i].time, summary.downbeats),
        type: 'drop_candidate',
        confidence: Math.min(1, (nextHigh - prevLow) * 1.5),
      });
    }
    if (prevLow - nextHigh > 0.35 && prevLow > 0.5) {
      events.push({
        t: frames[i].time,
        type: 'breakdown_start',
        confidence: Math.min(1, (prevLow - nextHigh) * 1.5),
      });
    }
  }

  // 2. Vocal entry/exit scan (1s hysteresis)
  const fps = analysis.fps;
  const window = fps; // 1 second
  let vocalOn = false;
  for (let i = window; i < frames.length; i += Math.floor(fps / 2)) {
    let sum = 0;
    for (let j = i - window; j < i; j++) sum += frames[j].stems.vocals;
    const mean = sum / window;
    if (!vocalOn && mean > 0.25) {
      vocalOn = true;
      events.push({ t: +frames[i].time.toFixed(2), type: 'vocal_entry', confidence: 0.8 });
    } else if (vocalOn && mean < 0.08) {
      vocalOn = false;
      events.push({ t: +frames[i].time.toFixed(2), type: 'vocal_exit', confidence: 0.8 });
    }
  }

  // 3. Big transients (spectral flux spikes)
  for (let i = 5; i < frames.length - 1; i++) {
    const cur = frames[i].spectral_flux;
    const prevMean =
      (frames[i - 5].spectral_flux +
        frames[i - 4].spectral_flux +
        frames[i - 3].spectral_flux +
        frames[i - 2].spectral_flux +
        frames[i - 1].spectral_flux) /
      5;
    if (cur > 1.5 && cur > prevMean * 2.5) {
      events.push({
        t: +frames[i].time.toFixed(2),
        type: 'big_transient',
        confidence: Math.min(1, (cur - prevMean) / 2),
      });
    }
  }

  // Keep only high-confidence, dedupe near-duplicates
  const filtered = events
    .filter((e) => e.confidence >= 0.5)
    .sort((a, b) => a.t - b.t)
    .filter((e, i, arr) => i === 0 || e.t - arr[i - 1].t > 0.5 || e.type !== arr[i - 1].type);

  return filtered.slice(0, 40);
}

export function buildStemSummary(analysis: AnalysisJson): StemSummary {
  const fps = analysis.fps;
  const frames = analysis.frames;

  const vocals = frames.map((f) => f.stems.vocals);
  const drums = frames.map((f) =>
    Math.max(f.stems.kick, f.stems.snare, f.stems.hat),
  );
  const bass = frames.map((f) => f.stems.bass);
  const other = frames.map((f) => f.stems.other);
  const hatDensity = frames.map((f) => f.onsets.hat);

  const downbeats = computeDownbeats(analysis.bpm, analysis.duration);

  const summary: StemSummary = {
    song: analysis.song,
    duration: analysis.duration,
    bpm: analysis.bpm,
    bpmConfidence: analysis.bpm_confidence ?? 0.8,
    frameRate: SUMMARY_FPS,
    downbeats,
    sections: analysis.sections.map((s) => ({
      start: s.start,
      end: s.end,
      label: s.label,
    })),
    stems: {
      vocals: { energy: downsample(vocals, fps, SUMMARY_FPS) },
      drums: {
        energy: downsample(drums, fps, SUMMARY_FPS),
        kickOnsets: extractOnsetTimes(frames, 'kick'),
        snareOnsets: extractOnsetTimes(frames, 'snare'),
        hatDensity: downsample(hatDensity, fps, SUMMARY_FPS),
      },
      bass: { energy: downsample(bass, fps, SUMMARY_FPS) },
      other: { energy: downsample(other, fps, SUMMARY_FPS) },
    },
    events: [],
  };

  summary.events = detectEvents(analysis, summary);
  return summary;
}

// ---------------------------------------------------------------------------
// Draft plan builder — mirrors modulators.ts chooseNextMod() invariants
// ---------------------------------------------------------------------------

interface SectionStats {
  meanBass: number;
  meanKick: number;
  meanSnare: number;
  meanHat: number;
  meanVocals: number;
  meanOther: number;
  meanCentroid: number;
  variance: number;
  hasVocals: boolean;
  /** Fraction of frames where bass > 0.45 — tells "sustained" apart from "many hits" */
  bassSustainFraction: number;
  /** Fraction of frames where ANY drum stem is above 0.3 — drop density */
  drumActivityFraction: number;
}

function sectionStats(
  frames: AnalysisFrame[],
  start: number,
  end: number,
): SectionStats {
  const slice = frames.filter((f) => f.time >= start && f.time < end);
  if (slice.length === 0) {
    return {
      meanBass: 0, meanKick: 0, meanSnare: 0, meanHat: 0,
      meanVocals: 0, meanOther: 0, meanCentroid: 0,
      variance: 0, hasVocals: false,
      bassSustainFraction: 0, drumActivityFraction: 0,
    };
  }
  const avg = (k: keyof AnalysisFrame['stems']) =>
    slice.reduce((s, f) => s + f.stems[k], 0) / slice.length;
  const meanBass = avg('bass');
  const meanKick = avg('kick');
  const meanSnare = avg('snare');
  const meanHat = avg('hat');
  const meanVocals = avg('vocals');
  const meanOther = avg('other');
  const meanCentroid =
    slice.reduce((s, f) => s + f.centroid, 0) / slice.length;

  // Total energy variance — proxy for rhythmicity
  const totals = slice.map((f) =>
    Math.max(f.stems.kick, f.stems.snare, f.stems.bass, f.stems.hat),
  );
  const totalMean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance =
    totals.reduce((s, v) => s + Math.abs(v - totalMean), 0) / totals.length;

  const bassSustainFraction =
    slice.filter((f) => f.stems.bass > 0.45).length / slice.length;
  const drumActivityFraction =
    slice.filter(
      (f) => Math.max(f.stems.kick, f.stems.snare, f.stems.hat) > 0.3,
    ).length / slice.length;

  return {
    meanBass, meanKick, meanSnare, meanHat, meanVocals, meanOther,
    meanCentroid, variance,
    hasVocals: meanVocals > 0.15,
    bassSustainFraction,
    drumActivityFraction,
  };
}

function pickFocusStem(
  s: SectionStats,
): DraftSection['focusStem'] {
  const candidates: Array<[DraftSection['focusStem'], number]> = [
    ['bass',   s.meanBass   * 1.1],
    ['kick',   s.meanKick   * 1.2],
    ['snare',  s.meanSnare],
    ['hat',    s.meanHat    * 0.9],
    ['vocals', s.meanVocals * 1.0],
    ['other',  s.meanOther  * 0.8],
  ];
  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0][0];
}

/**
 * Emulates modulators.ts chooseNextMod() at the SECTION level.
 * The live Director runs per-frame; here we need one summary label.
 */
function pickModulator(
  s: SectionStats,
  focus: DraftSection['focusStem'],
): { modulator: string; rationale: string } {
  // Invariant: hat-dominant → raw
  if (focus === 'hat' && s.meanHat > 0.2) {
    return {
      modulator: 'raw',
      rationale: 'Hat-dominant: hat envelope already encodes subdivision — raw passthrough.',
    };
  }

  const drumLike = focus === 'kick' || focus === 'snare' || focus === 'bass';
  const hasRhythm = s.variance >= 0.04 || drumLike;

  // Invariant: beatless ambient → raw
  if (!hasRhythm) {
    return {
      modulator: 'raw',
      rationale: 'Beatless ambient section — no rhythmic variance, raw passthrough.',
    };
  }

  // Held bass synth → hard strobe.
  // INVARIANT: strobes never fire when vocals are clearly present. A
  // sustained bass under vocals is a ballad texture, not a drop.
  // Further guards: the LIVE Director fires this only after ~1s of
  // continuously >0.45 bass with mid centroid and sparse drums. Emulate
  // by demanding bass > 0.45 for >70% of the section AND low drum density.
  if (
    focus === 'bass' &&
    !s.hasVocals &&
    s.bassSustainFraction > 0.7 &&
    s.meanCentroid > 1500 &&
    s.drumActivityFraction < 0.5
  ) {
    return {
      modulator: 'pulse:16',
      rationale: 'Sustained heavy bass synth (no vocals, sparse drums, mid centroid) — hard strobe territory.',
    };
  }

  // If vocals are present, cap the modulator at pulse:2. Anything faster
  // fights the vocal line. This is the same taste rule the live Director
  // applies via the hat-dominant + raw fall-through path.
  if (s.hasVocals) {
    const energy = Math.max(s.meanBass, s.meanKick, s.meanSnare);
    if (energy > 0.3 && (s.variance > 0.06 || focus === 'kick' || focus === 'bass')) {
      return {
        modulator: 'pulse:2',
        rationale: 'Vocals present — capped at 8th-note pulse to support, not fight, the vocal line.',
      };
    }
    return {
      modulator: 'raw',
      rationale: 'Vocals present and low rhythmic energy — raw passthrough, let vocals carry.',
    };
  }

  // High-energy rhythmic → fast pulse
  const energy = Math.max(s.meanBass, s.meanKick, s.meanSnare);
  if (energy > 0.5 && s.variance > 0.10) {
    return {
      modulator: 'pulse:5',
      rationale: 'High-energy rhythmic — fast pulse (5/beat) for building intensity.',
    };
  }

  // Rhythmic mid-energy → 8ths
  if (energy > 0.22 && s.variance > 0.08) {
    return {
      modulator: 'pulse:2',
      rationale: 'Rhythmic mid-energy — 8th-note pulse.',
    };
  }

  // Sustained mid-energy with rhythm → soft 1/beat pulse
  if (energy > 0.25) {
    return {
      modulator: 'pulse:1',
      rationale: 'Sustained mid-energy with rhythmic evidence — soft musical pulse on the beat.',
    };
  }

  return {
    modulator: 'raw',
    rationale: 'Low-energy section — raw passthrough.',
  };
}

function defaultEffectStack(
  focus: DraftSection['focusStem'],
  s: SectionStats,
  label: string,
): EffectInstance[] {
  const base: EffectInstance = {
    effect: 'color_wash',
    color: { r: 0.1, g: 0.1, b: 0.3 },
    intensitySource: 'none',
    region: { preset: 'all' },
    speed: 1,
    direction: 'up',
    blendMode: 'max',
    intensity: 0.4,
    attackMs: 200,
    releaseMs: 400,
    panFollow: false,
    onsetMode: false,
  };

  const effects: EffectInstance[] = [base];

  switch (focus) {
    case 'bass':
      effects.push({
        ...base,
        effect: 'bass_fill',
        color: { r: 0.8, g: 0.1, b: 0.2 },
        intensitySource: 'bass',
        intensity: 0.9,
        attackMs: 20,
        releaseMs: 150,
      });
      break;
    case 'kick':
      effects.push({
        ...base,
        effect: 'kick_flash',
        color: { r: 1, g: 1, b: 1 },
        intensitySource: 'kick',
        region: { preset: 'all' },
        intensity: 0.9,
        attackMs: 5,
        releaseMs: 120,
        onsetMode: true,
      });
      break;
    case 'snare':
      effects.push({
        ...base,
        effect: 'snare_accent',
        color: { r: 1, g: 0.8, b: 0.2 },
        intensitySource: 'snare',
        region: { preset: 'outer' },
        intensity: 0.85,
        onsetMode: true,
      });
      break;
    case 'hat':
      effects.push({
        ...base,
        effect: 'hat_sparkle',
        color: { r: 1, g: 1, b: 0.9 },
        intensitySource: 'hat',
        intensity: 0.7,
        onsetMode: true,
      });
      break;
    case 'vocals':
      effects.push({
        ...base,
        effect: 'vocal_wave',
        color: { r: 0.6, g: 0.2, b: 0.8 },
        intensitySource: 'vocals',
        intensity: 0.8,
        attackMs: 150,
        releaseMs: 400,
      });
      break;
    case 'other':
      effects.push({
        ...base,
        effect: 'breathe',
        color: { r: 0.4, g: 0.3, b: 0.7 },
        intensitySource: 'other',
        intensity: 0.7,
      });
      break;
  }

  // Buildup sections get a rise layer
  if (/build|pre|riser/i.test(label)) {
    effects.push({
      ...base,
      effect: 'buildup_rise',
      color: { r: 1, g: 0.7, b: 0.3 },
      intensitySource: 'drums',
      intensity: 0.85,
      direction: 'up',
    });
  }

  return effects;
}

export function buildDraftPlan(analysis: AnalysisJson): DraftPlan {
  const sections: DraftSection[] = analysis.sections.map((sec) => {
    const stats = sectionStats(analysis.frames, sec.start, sec.end);
    const focus = pickFocusStem(stats);
    const { modulator, rationale } = pickModulator(stats, focus);
    const effects = defaultEffectStack(focus, stats, sec.label);
    return {
      sectionLabel: sec.label,
      start: sec.start,
      end: sec.end,
      focusStem: focus,
      modulator,
      effects,
      rationale: `Focus: ${focus}. ${rationale}${stats.hasVocals ? ' Vocals present.' : ''}`,
      barPattern: 'solid' as const,
    };
  });

  return {
    song: analysis.song,
    bpm: analysis.bpm,
    directorVersion: DIRECTOR_VERSION,
    sections,
  };
}
