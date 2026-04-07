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

// --- Beat strobe (gated switch) ---
// When signal crosses high threshold, strobe is ON (full intensity, beat-synced).
// Stays on until signal drops below low threshold (hysteresis).
let _beatStrobeOn = false;
let _beatStrobeLastSignal = 0;

export function resetBeatStrobe() {
  _beatStrobeOn = false;
  _beatStrobeLastSignal = 0;
}

export const beatStrobe: Modulator = (ctx) => {
  // Hysteresis: turn on at 0.55, turn off at 0.25
  if (!_beatStrobeOn && ctx.signal > 0.55) _beatStrobeOn = true;
  else if (_beatStrobeOn && ctx.signal < 0.25) _beatStrobeOn = false;
  _beatStrobeLastSignal = ctx.signal;

  if (!_beatStrobeOn) return ctx.signal; // pass through underlying signal

  // Strobe ON: full-intensity square wave at 8 strobes per beat
  const strobePhase = (ctx.beatPhase * 8) % 1;
  return strobePhase < 0.5 ? 1.0 : 0.0;
};

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
// Long pulses, two per bar
export const halfBarPulse: Modulator = (ctx) => {
  // Always pulse on quarter notes (4 per bar) — this is the universal musical
  // grid for ~all 4/4 popular music, so the pulse aligns with the listener's
  // expected beat regardless of the section's energy.
  const phase = ctx.beatPhase;             // already 0-1 within current beat
  const env = Math.pow(1 - phase, 2);      // square decay
  const amp = 0.8 + ctx.signal * 0.2;      // tiny signal bias
  return env * amp;
};

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

interface DirectorState {
  currentMod: 'raw' | 'beatStrobe' | 'halfBarPulse';
  endsAtTime: number;
  signalHistory: number[];      // recent signal values for character analysis
  centroidHistory: number[];    // recent centroid values for adaptive threshold
  prevSignal: number;
  recentStrobeBeats: number;    // strobe beats spent in the last ~16-beat window
  lastChoiceTime: number;
}

let _directorState: DirectorState = {
  currentMod: 'raw',
  endsAtTime: 0,
  signalHistory: [],
  centroidHistory: [],
  prevSignal: 0,
  recentStrobeBeats: 0,
  lastChoiceTime: 0,
};

export function getDirectorChoice(): DirectorState['currentMod'] {
  return _directorState.currentMod;
}

export function resetDirector() {
  _directorState = {
    currentMod: 'raw',
    endsAtTime: 0,
    signalHistory: [],
    centroidHistory: [],
    prevSignal: 0,
    recentStrobeBeats: 0,
    lastChoiceTime: 0,
  };
}

// Each frame, when current mod expires, choose next based on character
function chooseNextMod(ctx: ModulatorContext, state: DirectorState): { mod: DirectorState['currentMod']; durationBeats: number } {
  const sig = ctx.signal;

  const hist = state.signalHistory;
  const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : sig;
  const variance = hist.length
    ? hist.reduce((sum, v) => sum + Math.abs(v - mean), 0) / hist.length
    : 0;

  // Sustained heavy-bass-synth detection: across the full ~1s history, bass
  // must be dominant AND signal must stay high AND centroid must sit in the
  // gritty/harmonic mid range. This rejects short bass hits (kicks, transient
  // 808s) and only fires on long held synth bass — the moment that earns strobe.
  const sustainedHighSignal = hist.length >= 20
    && hist.slice(-20).every(v => v > 0.45)
    && mean > 0.55;
  const cHist = state.centroidHistory;
  const cMean = cHist.length ? cHist.reduce((a, b) => a + b, 0) / cHist.length : (ctx.centroid ?? 0);
  const sustainedMidCentroid = cHist.length >= 20 && cMean > 1500;
  const isBassFocus = ctx.dominantStem === 'bass';
  const heldBassSynth = isBassFocus && sustainedHighSignal && sustainedMidCentroid;

  // Duty-cycle cap: don't let strobe consume more than ~30% of recent time.
  const strobeAllowed = state.recentStrobeBeats < 6;

  // Priority 1: sustained heavy bass synth → STROBE (the payoff moment)
  if (heldBassSynth && strobeAllowed) {
    return { mod: 'beatStrobe', durationBeats: 4 + Math.random() * 4 };
  }

  // Priority 2: very sharp rising edge on top of already-elevated signal → strobe burst
  const risingEdge = sig > mean + 0.35 && sig > 0.65 && variance > 0.1;
  if (risingEdge && strobeAllowed) {
    return { mod: 'beatStrobe', durationBeats: 2 + Math.random() * 2 };
  }

  // Mid energy + rhythmic → half-bar pulse
  if (sig > 0.3 && variance > 0.12) {
    return { mod: 'halfBarPulse', durationBeats: 2 + Math.random() * 2 };
  }

  return { mod: 'raw', durationBeats: 4 + Math.random() * 4 };
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

    let { mod, durationBeats } = chooseNextMod(ctx, state);
    // Strobe may only START on a downbeat. If we picked strobe but we're not
    // at a bar boundary, fall back to raw for the rest of this bar so the
    // next decision lands on the downbeat.
    if (mod === 'beatStrobe' && !atBarStart) {
      mod = 'raw';
      const beatsToBarEnd = (1 - ctx.barPhase) * 4;
      durationBeats = Math.max(0.5, beatsToBarEnd);
    }
    // Round strobe duration to whole bars so it also ENDS on a downbeat.
    if (mod === 'beatStrobe') {
      durationBeats = Math.max(4, Math.round(durationBeats / 4) * 4);
    }
    state.currentMod = mod;
    state.endsAtTime = ctx.time + durationBeats * beatSec;
    state.lastChoiceTime = ctx.time;
    if (mod === 'beatStrobe') state.recentStrobeBeats += durationBeats;
  }

  // Apply chosen modulator
  switch (state.currentMod) {
    case 'beatStrobe':   return beatStrobe(ctx);
    case 'halfBarPulse': return halfBarPulse(ctx);
    default:             return raw(ctx);
  }
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
