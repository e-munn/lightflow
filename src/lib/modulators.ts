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
export const DIRECTOR_VERSION = 'v1.0-2026-04-09';
export const DIRECTOR_DESCRIPTION =
  'Clean baseline after iterative tuning. Features: unified pulse with ' +
  'beat-locked rate continuum (1/2/4/5/8/16 per beat), smooth decay ' +
  'envelope that scales with rate (hard square only at ≥6/beat), ' +
  'beatless-section → raw, hat-dominant → raw, per-frame transient ' +
  'detector for boom-bap attacks, beat-offset grid fitting, 2-bar ' +
  'minimum commit on fast pulses. Increment minor (v1.1) for tuning, ' +
  'major (v2.0) for architectural changes.';

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
};

/** Back-compat: map the unified (mod, rate) state to the legacy label
 *  strings the webapp UI timeline expects. Matches the envelope shape
 *  cutoff in pulseAtBeatRate (rate ≥ 6 = hard square = "strobe"). */
export function getDirectorChoice(): 'raw' | 'beatStrobe' | 'halfBarPulse' {
  if (_directorState.currentMod === 'raw') return 'raw';
  return _directorState.currentPulseRate >= 6 ? 'beatStrobe' : 'halfBarPulse';
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
  };
}

interface ChoiceResult {
  mod: DirectorMod;
  rate: number;           // pulses per beat (0 for raw)
  durationBeats: number;
}

// Each frame, when current mod expires, choose next based on character
function chooseNextMod(ctx: ModulatorContext, state: DirectorState): ChoiceResult {
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

  // Priority 1: sustained heavy bass synth → hardest strobe (16/beat)
  if (heldBassSynth && strobeAllowed) {
    return { mod: 'pulse', rate: 16, durationBeats: FAST_MIN_BEATS + Math.random() * 8 };
  }

  // Priority 2: hard per-frame transient → full strobe (8/beat)
  const transient = sig - prev > 0.25 && sig > 0.5;
  if (transient && strobeAllowed) {
    return { mod: 'pulse', rate: 8, durationBeats: FAST_MIN_BEATS + Math.random() * 4 };
  }

  // Priority 3: rising edge vs recent mean → strobe (8/beat)
  const risingEdge = sig > shortMean + 0.2 && sig > 0.55;
  if (risingEdge && strobeAllowed) {
    return { mod: 'pulse', rate: 8, durationBeats: FAST_MIN_BEATS + Math.random() * 4 };
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

  // Priority 4: high-energy rhythmic → fast pulse (5/beat) — "building"
  // intensity. Gets the new smooth decay envelope (exp 4.3) so it's fast
  // but still musical, not a mechanical square wave.
  if (sig > 0.5 && variance > 0.10) {
    return { mod: 'pulse', rate: 5, durationBeats: 4 + Math.random() * 4 };
  }

  // Priority 5: rhythmic mid-energy → 8ths (2/beat)
  if (sig > 0.22 && variance > 0.08) {
    return { mod: 'pulse', rate: 2, durationBeats: 2 + Math.random() * 2 };
  }

  // Priority 6: sustained mid-energy — soft 1-per-beat musical pulse,
  // BUT only when there's at least *some* rhythmic evidence (variance ≥ 0.04
  // OR the attention layer is locked on a drum-like stem). Pure pad/vocal
  // ambient sections with flat variance fall through to raw so beatless
  // breakdowns (e.g., Dancing On My Own's ethereal section) stop pulsing.
  const drumLike =
    ctx.dominantStem === 'kick' ||
    ctx.dominantStem === 'snare' ||
    ctx.dominantStem === 'bass';
  const hasRhythm = variance >= 0.04 || drumLike;
  if (sig > 0.25 && mean > 0.25 && hasRhythm) {
    return { mod: 'pulse', rate: 1, durationBeats: 3 + Math.random() * 2 };
  }

  // Default: raw passthrough. Beatless ambient sections land here and
  // stay raw, which is what a good deterministic director should do.
  return { mod: 'raw', rate: 0, durationBeats: 2 + Math.random() * 3 };
}

export const director: Modulator = (ctx) => {
  const state = _directorState;

  // Update history (keep ~1 second worth of frames at 30fps)
  state.signalHistory.push(ctx.signal);
  if (state.signalHistory.length > 30) state.signalHistory.shift();
  state.centroidHistory.push(ctx.centroid ?? 0);
  if (state.centroidHistory.length > 30) state.centroidHistory.shift();
  state.prevSignal = ctx.signal;

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

    let { mod, rate, durationBeats } = chooseNextMod(ctx, state);
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
  }

  // Apply chosen modulator
  if (state.currentMod === 'pulse') {
    return pulseAtBeatRate(ctx, state.currentPulseRate);
  }
  return raw(ctx);
};

// --- Registry ---
export const MODULATORS: Record<string, { name: string; fn: Modulator }> = {
  raw:          { name: 'Raw',            fn: raw },
  blackout:     { name: 'Blackout',       fn: blackout },
  beatStrobe:   { name: 'Beat Strobe',    fn: beatStrobe },
  halfBarPulse: { name: 'Half-Bar Pulse', fn: halfBarPulse },
  sineWobble:   { name: 'Sine Wobble',    fn: sineWobble },
  director:     { name: 'Director',       fn: director },
};
