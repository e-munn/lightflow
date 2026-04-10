/**
 * Engine adapter: ShowPlan (Claude-edited) → live EffectInstance[] for
 * the existing renderSectionFrame pipeline in src/lib/effects.ts.
 *
 * Responsibilities:
 *  1. Select the active section for the current playback time.
 *  2. Convert director-schema effects (camelCase) into the existing
 *     engine type (snake_case, src/types/v3.ts).
 *  3. Fire hit cues as temporary overlay layers with simple envelopes.
 *  4. Apply crossfade transitions between section changes.
 *
 * Pure and stateless-across-calls except for the tiny hit-cue ring
 * buffer which each caller manages via `createHitCueTracker()`.
 */

import type {
  EffectInstance as EngineEffect,
  Region as EngineRegion,
  Color as EngineColor,
} from '@/types/v3';
import type {
  ShowPlan,
  SectionPlan,
  EffectInstance as DirectorEffect,
  HitCue,
} from './schema';

// ---------------------------------------------------------------------------
// Conversion: director-schema (camelCase) → engine (snake_case)
// ---------------------------------------------------------------------------

function toEngineRegion(r: DirectorEffect['region']): EngineRegion {
  return {
    preset: r.preset ?? null,
    tubes: r.tubes ?? null,
    pixel_range: r.pixelRange ? [r.pixelRange.start, r.pixelRange.end] : null,
  };
}

function toEngineColor(c: { r: number; g: number; b: number }): EngineColor {
  return { r: c.r, g: c.g, b: c.b };
}

export function toEngineEffect(
  e: DirectorEffect,
  intensityOverride?: number,
): EngineEffect {
  return {
    effect: e.effect,
    color: toEngineColor(e.color),
    secondary_color: e.secondaryColor ? toEngineColor(e.secondaryColor) : null,
    intensity_source: e.intensitySource,
    region: toEngineRegion(e.region),
    speed: e.speed,
    direction: e.direction,
    blend_mode: e.blendMode,
    intensity: intensityOverride ?? e.intensity,
    attack_ms: e.attackMs,
    release_ms: e.releaseMs,
    attack_beats: e.attackBeats ?? null,
    release_beats: e.releaseBeats ?? null,
    pan_follow: e.panFollow,
    onset_mode: e.onsetMode,
  };
}

// ---------------------------------------------------------------------------
// Section lookup
// ---------------------------------------------------------------------------

export function findActiveSection(
  plan: ShowPlan,
  time: number,
): { section: SectionPlan; index: number } | null {
  for (let i = 0; i < plan.sections.length; i++) {
    const s = plan.sections[i];
    if (time >= s.start && time < s.end) return { section: s, index: i };
  }
  // Clamp to last section if we're past the end
  if (plan.sections.length > 0 && time >= plan.sections[plan.sections.length - 1].end) {
    const i = plan.sections.length - 1;
    return { section: plan.sections[i], index: i };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hit-cue tracker
// ---------------------------------------------------------------------------

export interface HitCueTracker {
  /** Indices of cues currently firing (active envelope). */
  active: Set<number>;
  /** Last playback time we saw — for detecting seek/restart. */
  lastTime: number;
}

export function createHitCueTracker(): HitCueTracker {
  return { active: new Set(), lastTime: 0 };
}

export function resetHitCueTracker(t: HitCueTracker) {
  t.active.clear();
  t.lastTime = 0;
}

/**
 * Returns the list of currently-firing hit cues AND the engine-ready
 * effect layers for them. A cue fires from `t` to `t + duration` and
 * its intensity follows a fast-attack / exp-decay envelope.
 *
 * Handles seek: if `time` jumps backward, the tracker resets so cues
 * don't get stuck in the "already fired" state.
 */
export function getFiringCues(
  plan: ShowPlan,
  tracker: HitCueTracker,
  time: number,
): { cue: HitCue; effect: EngineEffect; envelope: number }[] {
  // Seek detection — rewind or big jump forward
  if (time < tracker.lastTime - 0.1 || time > tracker.lastTime + 1.0) {
    tracker.active.clear();
  }
  tracker.lastTime = time;

  const out: { cue: HitCue; effect: EngineEffect; envelope: number }[] = [];

  for (let i = 0; i < plan.hitCues.length; i++) {
    const cue = plan.hitCues[i];
    const dt = time - cue.t;
    if (dt < -0.02 || dt > cue.duration) {
      tracker.active.delete(i);
      continue;
    }
    tracker.active.add(i);

    // Envelope: full at t=0, exp decay over duration
    const phase = Math.max(0, dt) / cue.duration;
    const envelope = Math.exp(-phase * 3.5);

    out.push({
      cue,
      effect: toEngineEffect(cue.effect, cue.effect.intensity * envelope),
      envelope,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// ProgramBlock integration — converts a ShowPlan into the same block
// timeline shape page.tsx's render loop already consumes.
//
// A ShowPlan section → one `stem:<focusStem>` block + one `fx:<name>`
// block, with `rate` extracted from the modulator string ("pulse:16"
// → 16, "raw" → 0) and `intensityScale` derived from the max effect
// intensity in the section (Claude's patch already scaled per-section
// intensities in applyPatch.ts).
// ---------------------------------------------------------------------------

export interface ProgramBlock {
  lane: string;
  start: number;
  end: number;
  rate?: number;
  intensityScale?: number;
}

/** Parse a modulator string from the draft/show plan. */
function parseModulator(m: string): { lane: string; rate: number } {
  // Format: "raw" | "pulse:<N>"
  if (m === 'raw' || !m) return { lane: 'raw', rate: 0 };
  const match = /^pulse:(\d+)$/.exec(m);
  if (match) {
    const rate = parseInt(match[1], 10);
    // Match the legacy label convention the HUD/timeline expects:
    // rate ≥ 6 is a hard strobe, anything lower is a musical pulse.
    const lane = rate >= 6 ? 'beatStrobe' : 'halfBarPulse';
    return { lane, rate };
  }
  return { lane: 'raw', rate: 0 };
}

/**
 * Step a pulse rate one notch down the ladder (same ladder as
 * modulators.ts). 16 → 8 → 5 → 4 → 2 → 1 → 0. 0 means raw.
 */
const PATTERN_RATE_LADDER = [16, 8, 5, 4, 2, 1, 0];
function patternStepDown(rate: number, steps: number): number {
  let idx = PATTERN_RATE_LADDER.indexOf(rate);
  if (idx < 0) {
    // Find nearest lower rate on the ladder
    idx = PATTERN_RATE_LADDER.findIndex((r) => r <= rate);
    if (idx < 0) return 0;
  }
  const target = Math.min(PATTERN_RATE_LADDER.length - 1, idx + steps);
  return PATTERN_RATE_LADDER[target];
}

/**
 * Synthesize a per-bar block timeline for a single section based on
 * its bar pattern. Emits alternating fx blocks (pulse / raw /
 * blackout) aligned to bar boundaries.
 *
 * Called by buildClaudeBlocks when section.barPattern !== 'solid'.
 * Each returned block still carries an intensityScale so the render
 * loop applies Claude's per-section intensity multiplier correctly.
 */
function synthesizeBarPattern(
  sec: ShowPlan['sections'][number],
  bpm: number,
  intensityScale: number,
): ProgramBlock[] {
  const beatSec = 60 / bpm;
  const barSec = beatSec * 4;
  const sectionLen = sec.end - sec.start;
  const bars = Math.max(1, Math.floor(sectionLen / barSec));
  const { rate: peakRate } = parseModulator(sec.modulator);
  const pattern = sec.barPattern ?? 'solid';

  const blocks: ProgramBlock[] = [];
  const barStart = (i: number) => sec.start + i * barSec;
  const barEnd = (i: number) => Math.min(sec.end, sec.start + (i + 1) * barSec);

  // Helper: emit a single-bar fx block with the given rate/lane.
  const emit = (
    i: number,
    lane: string,
    rate: number,
    extraScale = 1,
  ) => {
    blocks.push({
      lane: 'fx:' + lane,
      start: barStart(i),
      end: barEnd(i),
      rate,
      intensityScale: intensityScale * extraScale,
    });
  };

  const emitRaw = (i: number) => emit(i, 'raw', 0);
  const emitBlackout = (i: number) =>
    emit(i, 'blackout', 0, 0);

  const emitPulse = (i: number, rate: number) => {
    if (rate === 0) return emitRaw(i);
    const lane = rate >= 6 ? 'beatStrobe' : 'halfBarPulse';
    emit(i, lane, rate);
  };

  if (pattern === 'solid') {
    // One fx block for the whole section — same as the pre-v1.2 path.
    const { lane, rate } = parseModulator(sec.modulator);
    blocks.push({
      lane: 'fx:' + lane,
      start: sec.start,
      end: sec.end,
      rate,
      intensityScale,
    });
    return blocks;
  }

  if (pattern === 'solid-blackout-last') {
    const { lane, rate } = parseModulator(sec.modulator);
    // Solid up to the last bar, then blackout for the final bar.
    const lastBarStart = barStart(bars - 1);
    blocks.push({
      lane: 'fx:' + lane,
      start: sec.start,
      end: lastBarStart,
      rate,
      intensityScale,
    });
    blocks.push({
      lane: 'fx:blackout',
      start: lastBarStart,
      end: sec.end,
      rate: 0,
      intensityScale: 0,
    });
    return blocks;
  }

  if (pattern === 'alternating') {
    // Bar 1 pulse, bar 2 raw, bar 3 pulse, ... No decay, no blackout.
    for (let i = 0; i < bars; i++) {
      if (i % 2 === 0) emitPulse(i, peakRate);
      else emitRaw(i);
    }
    return blocks;
  }

  // every-4-bars / every-2-bars — gridded decay patterns.
  // Pulse burst on bars at a fixed stride, step rate DOWN each burst,
  // raw in between, blackout on the final bar.
  const stride = pattern === 'every-4-bars' ? 4 : 2;
  let step = 0;
  for (let i = 0; i < bars - 1; i++) {
    if (i % stride === 0) {
      const rateForThisBurst = patternStepDown(peakRate, step);
      if (rateForThisBurst > 0) {
        emitPulse(i, rateForThisBurst);
      } else {
        emitRaw(i);
      }
      step += 1;
    } else {
      emitRaw(i);
    }
  }
  // Final bar: blackout
  if (bars >= 2) {
    emitBlackout(bars - 1);
  } else {
    emitPulse(0, peakRate); // section is too short for a pattern — just pulse
  }
  return blocks;
}

/**
 * Build a program-timeline-compatible block list from a Claude ShowPlan.
 * For each section:
 *   - one stem: lane for the focus stem
 *   - fx lanes synthesized from the section's barPattern (v1.2+)
 */
export function buildClaudeBlocks(plan: ShowPlan): ProgramBlock[] {
  const blocks: ProgramBlock[] = [];
  const bpm = plan.bpm;

  for (const sec of plan.sections) {
    // Stem lane — use 'kick' as a safe fallback for vocals/other since the
    // render path's stem dispatch only knows bass/kick/snare/hat/other.
    const focusForEngine =
      sec.focusStem === 'vocals' ? 'other' : sec.focusStem;
    blocks.push({
      lane: 'stem:' + focusForEngine,
      start: sec.start,
      end: sec.end,
    });

    // Intensity scale: max of the section's effect intensities (applyPatch
    // has already multiplied these by Claude's intensityScale edits).
    const maxIntensity = sec.effects.length
      ? Math.max(...sec.effects.map((e) => e.intensity))
      : 1;

    // Synthesize fx lane(s) based on barPattern. Solid returns one block;
    // non-solid returns per-bar blocks.
    const fxBlocks = synthesizeBarPattern(sec, bpm, maxIntensity);
    for (const fx of fxBlocks) blocks.push(fx);
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Signal-space hit cue firing — for direct use in the existing render loop.
//
// The full engine-adapter path (resolveShowPlanFrame → renderSectionFrame)
// is the rich option, but wiring it into the spatial render pipeline is
// invasive. The quick path: look up whether a hit cue is firing right now,
// return an {envelope, color} that the render loop can Math.max onto the
// active brightness signal for a visible punch.
// ---------------------------------------------------------------------------

export interface HitCueBoost {
  /** 0..1 — add to (or max onto) the brightness signal */
  envelope: number;
  /** Optional color tint the caller may blend in */
  color: { r: number; g: number; b: number } | null;
  /** The underlying cue — useful for HUD */
  cue: HitCue | null;
  /** Label for debug HUD */
  label: string;
}

export const NO_BOOST: HitCueBoost = {
  envelope: 0,
  color: null,
  cue: null,
  label: '',
};

/**
 * Find the most recent hit cue whose envelope is still active at `time`
 * and return a boost. If multiple cues overlap, the one with the highest
 * envelope wins.
 */
export function getHitCueBoost(
  plan: ShowPlan | null,
  time: number,
): HitCueBoost {
  if (!plan || plan.hitCues.length === 0) return NO_BOOST;
  let best: HitCueBoost = NO_BOOST;
  // Hit cues are typically sorted by t; linear scan is fine (<30 cues).
  for (const cue of plan.hitCues) {
    const dt = time - cue.t;
    if (dt < 0 || dt > cue.duration) continue;
    const phase = dt / cue.duration;
    // Sharp attack (first 10% of duration at full) then exp decay.
    const envelope =
      phase < 0.1 ? 1 : Math.exp(-(phase - 0.1) * 3.5);
    if (envelope > best.envelope) {
      best = {
        envelope: envelope * cue.effect.intensity,
        color: cue.effect.color,
        cue,
        label: cue.label,
      };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Main entry: compute engine effect list for a given playback time
// ---------------------------------------------------------------------------

export interface ShowPlanRenderState {
  /** Engine-ready effects to composite this frame (base + hit cues). */
  effects: EngineEffect[];
  /** The section label driving the base stack, for HUD display. */
  sectionLabel: string;
  sectionIntent: string;
  /** Any hit cues firing this frame, for debug/overlay HUD. */
  firing: HitCue[];
}

/**
 * Produce the full list of effects the renderer should composite this frame.
 *
 * Handles section crossfade: within `crossfadeSec` of a boundary, the
 * previous section's effects are emitted with a fading intensity
 * alongside the incoming section.
 */
export function resolveShowPlanFrame(
  plan: ShowPlan,
  tracker: HitCueTracker,
  time: number,
  crossfadeSec: number = 0.5,
): ShowPlanRenderState {
  const active = findActiveSection(plan, time);
  if (!active) {
    return { effects: [], sectionLabel: '—', sectionIntent: '', firing: [] };
  }

  const { section, index } = active;
  const effects: EngineEffect[] = section.effects.map((e) => toEngineEffect(e));

  // Crossfade in from previous section (always crossfade for now — schema
  // doesn't carry per-section transition preference yet).
  const elapsed = time - section.start;
  if (elapsed < crossfadeSec && index > 0) {
    const prev = plan.sections[index - 1];
    const fade = 1 - elapsed / crossfadeSec; // 1 → 0
    for (const e of prev.effects) {
      effects.push(toEngineEffect(e, e.intensity * fade));
    }
    // Incoming section also ramps in
    for (let i = 0; i < effects.length - prev.effects.length; i++) {
      effects[i] = { ...effects[i], intensity: effects[i].intensity * (1 - fade) };
    }
  }

  // Fire hit cues as overlay layers
  const firing = getFiringCues(plan, tracker, time);
  for (const f of firing) effects.push(f.effect);

  return {
    effects,
    sectionLabel: section.sectionLabel,
    sectionIntent: section.intent,
    firing: firing.map((f) => f.cue),
  };
}
