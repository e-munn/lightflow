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
}

export type Modulator = (ctx: ModulatorContext) => number;

// --- Identity (raw single channel) ---
export const raw: Modulator = (ctx) => ctx.signal;

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
  if (ctx.signal < 0.2) return ctx.signal;
  const phase = (ctx.barPhase * 2) % 1; // two pulses per bar
  const env = Math.pow(1 - phase, 2); // square decay
  return ctx.signal * env;
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
  currentMod: 'raw' | 'beatStrobe' | 'halfBarPulse' | 'sineWobble';
  endsAtTime: number;
  signalHistory: number[];      // recent signal values for character analysis
  prevSignal: number;
}

let _directorState: DirectorState = {
  currentMod: 'raw',
  endsAtTime: 0,
  signalHistory: [],
  prevSignal: 0,
};

export function resetDirector() {
  _directorState = { currentMod: 'raw', endsAtTime: 0, signalHistory: [], prevSignal: 0 };
}

// Each frame, when current mod expires, choose next based on character
function chooseNextMod(ctx: ModulatorContext, state: DirectorState): { mod: DirectorState['currentMod']; durationBeats: number } {
  const sig = ctx.signal;

  // Compute character from history
  const hist = state.signalHistory;
  const mean = hist.length ? hist.reduce((a, b) => a + b, 0) / hist.length : sig;
  const variance = hist.length
    ? hist.reduce((sum, v) => sum + Math.abs(v - mean), 0) / hist.length
    : 0;

  // Detect a sharp rising edge — current signal much higher than recent average
  const risingEdge = sig > mean + 0.25 && sig > 0.5;

  // Decision tree:
  // - Sharp rising edge into high signal → fire a strobe burst
  // - Sustained high signal with low variance (drone-like) → sine wobble
  // - Steady mid-energy with rhythmic pulsing → half-bar pulse
  // - Otherwise → raw (default, most common)

  if (risingEdge) {
    return { mod: 'beatStrobe', durationBeats: 2 + Math.random() * 2 }; // 2-4 beats
  }

  if (sig > 0.5 && variance < 0.08) {
    // Sustained loud + flat = drone → wobble
    return { mod: 'sineWobble', durationBeats: 4 + Math.random() * 4 }; // 4-8 beats
  }

  if (sig > 0.3 && variance > 0.12) {
    // Mid energy + rhythmic = pulse
    return { mod: 'halfBarPulse', durationBeats: 2 + Math.random() * 2 };
  }

  // Default: raw — pick a reasonable hold (matches the section feel)
  return { mod: 'raw', durationBeats: 4 + Math.random() * 4 };
}

export const director: Modulator = (ctx) => {
  const state = _directorState;

  // Update history (keep ~1 second worth of frames at 30fps)
  state.signalHistory.push(ctx.signal);
  if (state.signalHistory.length > 30) state.signalHistory.shift();
  state.prevSignal = ctx.signal;

  // Time to choose a new modulator?
  if (ctx.time >= state.endsAtTime) {
    const { mod, durationBeats } = chooseNextMod(ctx, state);
    state.currentMod = mod;
    const beatSec = 60 / ctx.bpm;
    state.endsAtTime = ctx.time + durationBeats * beatSec;
  }

  // Apply chosen modulator
  switch (state.currentMod) {
    case 'beatStrobe':   return beatStrobe(ctx);
    case 'halfBarPulse': return halfBarPulse(ctx);
    case 'sineWobble':   return sineWobble(ctx);
    default:             return raw(ctx);
  }
};

// --- Registry ---
export const MODULATORS: Record<string, { name: string; fn: Modulator }> = {
  raw:          { name: 'Raw',            fn: raw },
  beatStrobe:   { name: 'Beat Strobe',    fn: beatStrobe },
  halfBarPulse: { name: 'Half-Bar Pulse', fn: halfBarPulse },
  sineWobble:   { name: 'Sine Wobble',    fn: sineWobble },
  director:     { name: 'Director',       fn: director },
};
