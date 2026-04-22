/**
 * Signal Modulators
 *
 * Take the single attention signal (0-1) and add time-based patterns on top.
 * Each modulator is a pure function: (signal, time, beatPhase, bpm) -> output (0-1)
 *
 * The modulator output replaces the raw signal as the brightness value.
 * Modulators only "activate" when signal is high enough — at low signal
 * they pass through transparently.
 */

// ---------------------------------------------------------------------------
// DIRECTOR VERSION METADATA — bump this every time you change how the Director
// picks effects or tunes thresholds. The test page reads it to tag rating
// cohorts so we can compare old vs new algorithm performance.
// ---------------------------------------------------------------------------
// Clean-slate version numbering starting 2026-04-09. Past versions (v2–v9)
// are preserved in git history; ratings tagged with those strings stay in
// data/test_ratings.json for historical A/B. To see old code:
//   git log --all --grep='DIRECTOR_VERSION' -- src/lib/modulators.ts
//   git show <commit>:src/lib/modulators.ts
export const DIRECTOR_VERSION = 'v1.5-2026-04-21';
export const DIRECTOR_DESCRIPTION =
  'v1.5: Bass-first attention. Default regime heavily favors bass ' +
  '(priority 2.6 vs 0.3–0.8 for others) so ~80% of the show follows ' +
  'the low end. Bass envelope retuned for SMOOTHNESS: slower attack ' +
  '(100ms), longer release (600ms), lower shape weight (0.25) so ' +
  'audio envelope dominates instead of synthetic plateau. Kick ' +
  'becomes additive accent on top of bass, not a competitor. Fast ' +
  'unlock when bass drops to zero so breakdowns hand off to another ' +
  'stem quickly. Scout can disable bass-first for non-bass-driven ' +
  'songs via primaryStem. v1.4: transient-locked sync. v1.3: scout. ' +
  'v1.2: composed bar patterns. v1.1: Claude-as-editor.';

export interface ModulatorContext {
  signal: number;       // 0-1 input from attention layer
  time: number;         // current playback time in seconds
  beatPhase: number;    // 0-1 within current beat
  barPhase: number;     // 0-1 within 4-beat bar
  bpm: number;
  dt: number;           // delta time since last frame
  // Optional musical context for character-aware modulators
  dominantStem?: string;  // current focal stem (bass/kick/snare/hat/other)
  centroid?: number;      // spectral centroid in Hz (for "full spectrum" detection)
  sectionLabel?: string;  // analysis section label (intro/verse/drop/breakdown/outro)
  rawStems?: Record<string, number>;  // unprocessed stem energies from the analysis frame
  // Scout hints (optional, from _scout.json)
  scoutMoment?: { type: string; anticipating: boolean; intensity: number } | null;
  scoutSection?: { signalMode?: string; modulatorHint?: string; suppressEscalation?: boolean } | null;
}

export type Modulator = (ctx: ModulatorContext) => number;

// --- Identity (raw single channel) ---
export const raw: Modulator = (ctx) => ctx.signal;

// --- Blackout ---
export const blackout: Modulator = () => 0;

// --- Unified pulse ---
// All pulse/strobe effects are the same thing: a beat-locked periodic envelope,
// parameterized by RATE (pulses per beat). The envelope shape auto-shifts
// soft→hard as rate climbs. Beat-locked, not wall-clock, so the visual pace
// scales with BPM automatically.
//
//   1  per beat → musical pulse, slow decay (calm section hit)
//   2  per beat → 8th-note pulse, faster decay
//   4  per beat → hard 16ths, square wave (building)
//   8  per beat → strobe (drops)
//  16  per beat → hard strobe (peak)
export function pulseAtBeatRate(ctx: ModulatorContext, pulsesPerBeat: number): number {
  const phase = (ctx.beatPhase * pulsesPerBeat) % 1;
  // True strobe only at rate ≥ 6. Anything slower gets a decaying envelope
  // whose exponent smoothly scales with rate — keeps the shape musical
  // even at fast 16th-note rates (which felt mechanical as a hard square).
  if (pulsesPerBeat >= 6) {
    return phase < 0.5 ? 1 : 0;
  }
  // Exponent grows with rate: 1.8 @ 1/beat, 2.3 @ 2, 3.3 @ 4, 4.3 @ 5
  // Sharper decay at higher rates keeps each pulse punchy without
  // bleeding into the next.
  const exp = 1.3 + pulsesPerBeat * 0.6;
  return Math.pow(1 - phase, exp);
}

export function resetBeatStrobe() {
  // Kept for API compat; unified pulse is stateless.
}

// Legacy named presets — thin wrappers over the unified pulse at fixed rates.
// The webapp's manual modulator picker still uses these names.
export const beatStrobe: Modulator = (ctx) => pulseAtBeatRate(ctx, 8);

// --- Decaying strobe (one-shot burst) ---
// On a sharp signal spike, fire a strobe burst at full intensity that decays.
// Independent of underlying signal during burst.
let _decayState = { lastTrigger: -999, lastSignal: 0 };

export function resetDecayingStrobe() {
  _decayState = { lastTrigger: -999, lastSignal: 0 };
}

export const decayingStrobe: Modulator = (ctx) => {
  // Trigger on rising edge above threshold
  if (ctx.signal > 0.5 && _decayState.lastSignal < 0.4) {
    _decayState.lastTrigger = ctx.time;
  }
  _decayState.lastSignal = ctx.signal;

  const since = ctx.time - _decayState.lastTrigger;
  if (since < 0 || since > 0.8) return ctx.signal; // burst over

  // Burst phase: full-intensity strobe at 20Hz, hard-cut on/off
  const strobeRate = 20;
  const square = Math.floor(since * strobeRate * 2) % 2; // 0 or 1
  // Decay envelope: full for first 0.2s, then ramp down to 0 by 0.8s
  let envelope: number;
  if (since < 0.2) envelope = 1.0;
  else envelope = Math.max(0, 1 - (since - 0.2) / 0.6);

  // Pure binary strobe scaled by envelope (no signal mixing)
  return square === 1 ? envelope : 0;
};

// --- Sawtooth pulse ---
// Sharp attack, decay over each beat
export const sawtooth: Modulator = (ctx) => {
  if (ctx.signal < 0.2) return ctx.signal;
  // Inverted phase: 1 at start of beat, 0 at end
  const env = 1 - ctx.beatPhase;
  return ctx.signal * env;
};

// --- Half-bar pulse ---
// Legacy preset — 1 pulse per beat, musical decay. Wrapper over unified pulse.
export const halfBarPulse: Modulator = (ctx) => pulseAtBeatRate(ctx, 1);

// --- Sine wobble ---
// Gentle 4Hz wobble, intensity scales with signal
export const sineWobble: Modulator = (ctx) => {
  const wobble = (Math.sin(2 * Math.PI * 4 * ctx.time) + 1) / 2; // 0-1
  // Scale wobble depth by signal
  const depth = ctx.signal * 0.5;
  return ctx.signal * (1 - depth) + wobble * depth;
};

// --- Director ---
// Intelligently switches between raw / strobe / pulse / wobble based on signal character.
// Holds each choice for a few beats so decisions are musically coherent.
// Raw is the default ~80% of the time.

type DirectorMod = 'raw' | 'pulse';

interface DirectorState {
  currentMod: DirectorMod;
  currentPulseRate: number;     // pulses per beat (only meaningful when mod='pulse')
  endsAtTime: number;
  signalHistory: number[];
  centroidHistory: number[];
  prevSignal: number;
  recentStrobeBeats: number;    // "strobe-ish" (rate ≥ 4) beats spent in the window
  lastChoiceTime: number;
  // v1.2: step-down ladder state.
  // Tracks the most recent fast (rate ≥ 4) commit + how many beats have been
  // spent at that rate or faster, so the next choice can be forced down the
  // ladder when we've held a fast pulse for ≥ 4 bars.
  lastCommittedFastRate: number;     // 0 if last commit was raw or slow
  beatsAtCurrentFastRate: number;    // running total at same-or-higher rate
  useRawSignal: boolean;             // true → render loop should use raw stem energy
  rawSignalHistory: number[];        // raw stem energy history for variance detection
  lastSectionLabel: string | null;   // detect section transitions
}

let _directorState: DirectorState = {
  currentMod: 'raw',
  currentPulseRate: 0,
  endsAtTime: 0,
  signalHistory: [],
  centroidHistory: [],
  prevSignal: 0,
  recentStrobeBeats: 0,
  lastChoiceTime: 0,
  lastCommittedFastRate: 0,
  beatsAtCurrentFastRate: 0,
  useRawSignal: false,
  rawSignalHistory: [],
  lastSectionLabel: null,
};

// Rate ladder used for the step-down: higher rate → next step lower.
// Includes 5 because the legacy "high-energy rhythmic" branch uses it.
const RATE_LADDER: number[] = [16, 8, 5, 4, 2, 1, 0];

/** Given a rate, return the next step DOWN the ladder. 0 means raw. */
function stepDownRate(current: number): number {
  const idx = RATE_LADDER.indexOf(current);
  if (idx < 0) {
    // Unknown rate — find the nearest lower ladder value
    for (const r of RATE_LADDER) if (r < current) return r;
    return 0;
  }
  return RATE_LADDER[Math.min(RATE_LADDER.length - 1, idx + 1)];
}

/** 3-value enum — used as programBlock lane names. Do NOT change the
 *  return values; they feed directly into `fx:<name>` lane keys. */
export function getDirectorChoice(): 'raw' | 'beatStrobe' | 'halfBarPulse' | 'blackout' {
  if (_directorState.currentPulseRate === -1) return 'blackout';
  if (_directorState.currentMod === 'raw') return 'raw';
  return _directorState.currentPulseRate >= 6 ? 'beatStrobe' : 'halfBarPulse';
}

/** v1.2: descriptive UI label reflecting the actual rate, e.g.
 *  'raw' | 'strobe·16' | 'strobe·8' | 'pulse·5' | 'pulse·4' |
 *  'pulse·2' | 'pulse·1'. Use this for display; use
 *  `getDirectorChoice()` for lane-name equality. */
export function getDirectorChoiceLabel(): string {
  if (_directorState.currentPulseRate === -1) return 'blackout';
  const rawTag = _directorState.useRawSignal ? ' [raw]' : '';
  if (_directorState.currentMod === 'raw') return `raw${rawTag}`;
  const rate = _directorState.currentPulseRate;
  const kind = rate >= 6 ? 'strobe' : 'pulse';
  return `${kind}·${rate}${rawTag}`;
}

/** Whether the director wants raw stem energy instead of attention-shaped signal. */
export function getDirectorUseRaw(): boolean {
  return _directorState.useRawSignal;
}

/** Exposes the actual pulse rate (for the test page debug HUD). */
export function getDirectorPulseRate(): number {
  return _directorState.currentPulseRate;
}

export function resetDirector() {
  _directorState = {
    currentMod: 'raw',
    currentPulseRate: 0,
    endsAtTime: 0,
    signalHistory: [],
    centroidHistory: [],
    prevSignal: 0,
    recentStrobeBeats: 0,
    lastChoiceTime: 0,
    lastCommittedFastRate: 0,
    beatsAtCurrentFastRate: 0,
    useRawSignal: false,
    rawSignalHistory: [],
    lastSectionLabel: null,
  };
}

interface ChoiceResult {
  mod: DirectorMod;
  rate: number;           // pulses per beat (0 for raw, -1 for blackout)
  durationBeats: number;
  useRaw?: boolean;       // true → use raw stem energy instead of attention-shaped signal
}

// Each frame, when current mod expires, choose next based on character
function chooseNextMod(ctx: ModulatorContext, state: DirectorState): ChoiceResult {
  // Priority 0: Scout moment cues — anticipatory events the engine can't see coming.
  if (ctx.scoutMoment) {
    const m = ctx.scoutMoment;
    if (m.anticipating) {
      // We're in the anticipation window before the event
      if (m.type === 'drop' || m.type === 'bass_drop' || m.type === 'silence') {
        return { mod: 'raw', rate: -1, durationBeats: 2, useRaw: false }; // blackout
      }
      if (m.type === 'lift') {
        return { mod: 'pulse', rate: 1, durationBeats: 2, useRaw: false };
      }
    } else {
      // We're in the active window after the event timestamp
      if (m.type === 'fake_out') {
        // Suppress — return whatever the current state is, don't escalate
        return { mod: state.currentMod, rate: state.currentPulseRate, durationBeats: 4 };
      }
      if (m.type === 'breakdown') {
        return { mod: 'raw', rate: 0, durationBeats: 4, useRaw: false };
      }
      if (m.type === 'lift') {
        return { mod: 'pulse', rate: 2, durationBeats: 4 };
      }
      // drop/bass_drop/silence after the timestamp — let the engine react naturally
    }
  }

  // Priority 0.5: Scout section modulatorHint override
  if (ctx.scoutSection?.modulatorHint) {
    const hint = ctx.scoutSection.modulatorHint;
    if (hint === 'raw') return { mod: 'raw', rate: 0, durationBeats: 4 };
    if (hint === 'blackout') return { mod: 'raw', rate: -1, durationBeats: 4 };
    const rate = parseInt(hint.split(':')[1], 10);
    return { mod: 'pulse', rate, durationBeats: 8 };
  }

  // v1.3: Build/riser sections never get full-amplitude strobe or fast pulse.
  // A build is tension — it should feel like it's going somewhere, not already
  // there. Capping at pulse:2 preserves rhythmic movement without blowing the
  // payoff. The drop after the build is what earns the strobe.
  const isBuildSection = ctx.sectionLabel
    ? /build|riser|pre|tension/i.test(ctx.sectionLabel)
    : false;

  const sig = ctx.signal;
  const prev = state.prevSignal;

  const hist = state.signalHistory;
  // Full history for overall character (variance, sustained detection)
  const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : sig;
  const variance = hist.length
    ? hist.reduce((sum, v) => sum + Math.abs(v - mean), 0) / hist.length
    : 0;
  // SHORT history for rising-edge detection — 5 frames (~165ms) so the
  // mean can't get numb to a loud section. A clip that enters mid-song
  // after a warm-up on a loud outro should still see kick transients as
  // rising edges. Was previously using the full 30-frame mean which
  // biased the comparison.
  const shortHist = hist.slice(-5);
  const shortMean = shortHist.length
    ? shortHist.reduce((a, b) => a + b, 0) / shortHist.length
    : sig;

  // Sustained heavy-bass-synth detection: across the full ~1s history, bass
  // must be dominant AND signal must stay high AND centroid must sit in the
  // gritty/harmonic mid range. Rejects short bass hits and only fires on
  // long held synth bass — the moment that earns strobe.
  const sustainedHighSignal = hist.length >= 20
    && hist.slice(-20).every(v => v > 0.45)
    && mean > 0.55;
  const cHist = state.centroidHistory;
  const cMean = cHist.length ? cHist.reduce((a, b) => a + b, 0) / cHist.length : (ctx.centroid ?? 0);
  const sustainedMidCentroid = cHist.length >= 20 && cMean > 1500;
  const isBassFocus = ctx.dominantStem === 'bass';
  const heldBassSynth = isBassFocus && sustainedHighSignal && sustainedMidCentroid;

  // Duty-cycle cap on the high-rate (strobe-ish) pulses only.
  const strobeAllowed = state.recentStrobeBeats < 10;
  // Minimum duration for fast-rate pulses — at least 2 bars so they
  // register as a committed choice, not a flicker.
  const FAST_MIN_BEATS = 8;

  // ---------- Rate selection on a continuum ----------
  // The Director picks a rate (pulses per beat) based on signal character.
  // Each branch sets a specific rate; higher = more intense.

  // v1.3: One rate per section. No step-down ladder, no rate variation.
  // Pulse fires once at the start of a drop as a short accent, then raw.
  // If pulse already fired this section, go straight to raw.
  const alreadyPulsed = state.lastCommittedFastRate > 0;

  // Priority 1: sustained heavy bass synth → strobe (8/beat), 1 bar only
  if (heldBassSynth && strobeAllowed && !alreadyPulsed && !isBuildSection) {
    return { mod: 'pulse', rate: 8, durationBeats: 4 };
  }

  // Priority 2: hard transient or rising edge → strobe (8/beat), 1 bar
  const transient = sig - prev > 0.25 && sig > 0.5;
  const risingEdge = sig > shortMean + 0.2 && sig > 0.55;
  if ((transient || risingEdge) && strobeAllowed && !alreadyPulsed && !isBuildSection) {
    return { mod: 'pulse', rate: 8, durationBeats: 4 };
  }

  // Priority 3.4: hat-dominant intro → blackout. Hat-only intros (e.g.
  // TOO COOL to BE CARELESS) have no musical payload worth lighting yet;
  // blackout builds anticipation for the first real hit.
  if (ctx.dominantStem === 'hat' && ctx.sectionLabel === 'intro') {
    return { mod: 'raw', rate: -1, durationBeats: 4 };
  }

  // Priority 3.5 (NEW): hat-dominant → raw. The attention layer's hat
  // envelope already encodes whatever subdivision the hat is playing
  // (8ths, 16ths, triplets, variable). Imposing a fixed-rate pulse on
  // top fights the music. Raw passes the hat's natural dance through
  // directly. This specifically fixes boom-bap hi-hat sections where
  // a 2/beat pulse feels wrong.
  if (ctx.dominantStem === 'hat' && sig > 0.2) {
    return { mod: 'raw', rate: 0, durationBeats: 2 + Math.random() * 2 };
  }

  // Priority 4-6: Pulse only fires at the start of drop/high-energy sections
  // as a 1-bar punctuation, then the engine returns to raw. Pulse is an
  // accent, not a sustained mode.
  // Detect "just entered a new section" by checking if we're in the first
  // ~2 bars of a drop section (sectionLabel contains drop).
  const isDropSection = ctx.sectionLabel
    ? /drop/i.test(ctx.sectionLabel)
    : false;

  // Only pulse at the very start of drops — short burst then back to raw.
  if (isDropSection && sig > 0.5 && variance > 0.10) {
    // Short 1-bar commitment. After this expires, the engine will
    // re-evaluate — and with history filled, it'll fall to raw.
    const rate = sig > 0.7 ? 5 : 2;
    const rate2 = isBuildSection ? 2 : rate;
    return { mod: 'pulse', rate: rate2, durationBeats: 4 };
  }

  // Default: raw passthrough. Beatless ambient sections land here and
  // stay raw, which is what a good deterministic director should do.
  return { mod: 'raw', rate: 0, durationBeats: 2 + Math.random() * 3 };
}

// v1.5 EFFECTS KILLSWITCH. When true, the director always returns the raw
// signal — no pulse, no strobe, no blackout. Flip to false to re-enable
// the full decision ladder. This is a temporary debug/eval mode for
// tuning the bass-first attention layer without effect modulation
// masking what the signal actually looks like.
const EFFECTS_DISABLED = true;

export const director: Modulator = (ctx) => {
  if (EFFECTS_DISABLED) {
    // Keep state shape stable so any telemetry reader that peeks at
    // getDirectorChoice() / getDirectorPulseRate() still gets sane values.
    _directorState.currentMod = 'raw';
    _directorState.currentPulseRate = 0;
    return ctx.signal;
  }

  const state = _directorState;

  // Update history (keep ~1 second worth of frames at 30fps)
  state.signalHistory.push(ctx.signal);
  if (state.signalHistory.length > 30) state.signalHistory.shift();
  state.centroidHistory.push(ctx.centroid ?? 0);
  if (state.centroidHistory.length > 30) state.centroidHistory.shift();
  state.prevSignal = ctx.signal;

  // Track raw energy of dominant stem for raw-vs-shaped decision
  const rawDominant = ctx.rawStems?.[ctx.dominantStem ?? ''] ?? 0;
  state.rawSignalHistory.push(rawDominant);
  if (state.rawSignalHistory.length > 30) state.rawSignalHistory.shift();

  // Break current commitment on section change so drops/transitions aren't late
  const sectionChanged = ctx.sectionLabel !== state.lastSectionLabel && ctx.sectionLabel != null;
  if (sectionChanged) {
    state.lastSectionLabel = ctx.sectionLabel ?? null;
    state.endsAtTime = 0; // force re-evaluation
    state.lastCommittedFastRate = 0; // reset pulse gate for new section
  }

  // Time to choose a new modulator?
  if (ctx.time >= state.endsAtTime) {
    const beatSec = 60 / ctx.bpm;
    // Are we within the first ~quarter-beat of a bar? Only then is strobe allowed.
    const atBarStart = ctx.barPhase < 0.0625 || ctx.barPhase > 0.9375;
    // Decay strobe-budget toward zero across the previous segment
    const elapsedBeats = state.lastChoiceTime
      ? (ctx.time - state.lastChoiceTime) / beatSec
      : 0;
    state.recentStrobeBeats = Math.max(0, state.recentStrobeBeats - elapsedBeats * 0.5);

    const choice = chooseNextMod(ctx, state);
    let { mod, rate, durationBeats } = choice;

    // Scout suppressEscalation: don't go UP from current rate
    if (ctx.scoutSection?.suppressEscalation && mod === 'pulse' && rate > state.currentPulseRate && state.currentPulseRate > 0) {
      rate = state.currentPulseRate;
    }

    // A fast (rate ≥ 4) pulse is the "strobe" of the unified system and
    // still only legally starts on a downbeat — if we picked one off-beat,
    // fall back to raw until the next bar.
    const isFast = mod === 'pulse' && rate >= 4;
    if (isFast && !atBarStart) {
      mod = 'raw';
      rate = 0;
      const beatsToBarEnd = (1 - ctx.barPhase) * 4;
      durationBeats = Math.max(0.5, beatsToBarEnd);
    }
    // Round fast-pulse duration to whole bars (min 2 bars) so the decision
    // feels committed, not flickering.
    if (mod === 'pulse' && rate >= 4) {
      durationBeats = Math.max(8, Math.round(durationBeats / 4) * 4);
    }
    state.currentMod = mod;
    state.currentPulseRate = mod === 'pulse' ? rate : 0;
    state.endsAtTime = ctx.time + durationBeats * beatSec;
    state.lastChoiceTime = ctx.time;
    if (mod === 'pulse' && rate >= 4) state.recentStrobeBeats += durationBeats;

    // Raw signal decision: use raw stem energy when the stem's natural
    // dynamics have high variance (pulsing bass, punchy kicks). The
    // attention layer's envelope shaping smooths these out, but the raw
    // frame-to-frame movement is often more visually compelling.
    // Scout section signalMode takes precedence over auto-detection
    if (ctx.scoutSection?.signalMode === 'raw') {
      state.useRawSignal = true;
    } else if (ctx.scoutSection?.signalMode === 'shaped') {
      state.useRawSignal = false;
    } else if (choice.useRaw !== undefined) {
      state.useRawSignal = choice.useRaw;
    } else {
      const rh = state.rawSignalHistory;
      if (rh.length >= 10) {
        const rMean = rh.reduce((a, b) => a + b, 0) / rh.length;
        const rVar = rh.reduce((sum, v) => sum + (v - rMean) ** 2, 0) / rh.length;
        // High variance in raw energy → natural dynamics are the show.
        // Bass and kick benefit most; hat already goes raw via Priority 3.5.
        const dynamicStem = ctx.dominantStem === 'bass' || ctx.dominantStem === 'kick';
        state.useRawSignal = dynamicStem && rVar > 0.008 && rMean > 0.15;
      } else {
        state.useRawSignal = false;
      }
    }

    // v1.3: track whether pulse has fired so we don't repeat it.
    // Reset when we return to raw (new section opportunity).
    if (mod === 'pulse' && rate > 0) {
      state.lastCommittedFastRate = rate;
    } else if (mod === 'raw' && rate === 0) {
      state.lastCommittedFastRate = 0;
    }
  }

  // Apply chosen modulator
  if (state.currentPulseRate === -1) return 0; // blackout
  if (state.currentMod === 'pulse') {
    return pulseAtBeatRate(ctx, state.currentPulseRate);
  }
  return raw(ctx);
};

// v1.5 effects killswitch also applies to the named modulators so pinning
// STROBE / PULSE / BLACKOUT manually is a no-op while we're tuning the
// signal layer. Flip EFFECTS_DISABLED above to re-enable all of them.
const wrap = (fn: Modulator): Modulator =>
  EFFECTS_DISABLED ? (ctx: ModulatorContext) => ctx.signal : fn;

// --- Registry ---
export const MODULATORS: Record<string, { name: string; fn: Modulator }> = {
  raw:          { name: 'Raw',            fn: raw },
  blackout:     { name: 'Blackout',       fn: wrap(blackout) },
  beatStrobe:   { name: 'Beat Strobe',    fn: wrap(beatStrobe) },
  halfBarPulse: { name: 'Half-Bar Pulse', fn: wrap(halfBarPulse) },
  sineWobble:   { name: 'Sine Wobble',    fn: wrap(sineWobble) },
  director:     { name: 'Director',       fn: director },
};
