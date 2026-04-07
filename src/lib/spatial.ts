/**
 * Spatial Modulators
 *
 * Take the single attention signal (0-1) and distribute it across
 * the 8 tubes × 16 pixels grid in different ways.
 *
 * Each spatial modulator is a pure function:
 *   (signal, time, beatPhase, bpm) → Float32Array of length 8*16
 *
 * Output values are 0-1 brightness per pixel.
 * Pixel layout: row-major, [px * NUM_TUBES + tube]
 */

export const NUM_TUBES = 8;
export const PIXELS_PER_TUBE = 16;
export const GRID_SIZE = NUM_TUBES * PIXELS_PER_TUBE;

export interface SpatialContext {
  signal: number;
  time: number;
  beatPhase: number;
  barPhase: number;
  bpm: number;
  dt: number;
  // Spatial info from audio
  dominantStem: string;
  panPosition: number;   // -1 left, 0 center, 1 right
  panMotion: number;     // 0-1 how much pan is moving (recent stddev)
  centroid: number;      // spectral brightness 0-1 (normalized)
  energy: number;        // overall energy 0-1
}

export type SpatialModulator = (ctx: SpatialContext) => Float32Array;

// Helper: get pixel index
function idx(px: number, tube: number): number {
  return px * NUM_TUBES + tube;
}

// --- Solid: all pixels = signal value ---
export const solid: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  grid.fill(ctx.signal);
  return grid;
};

// --- Bloom: brightness radiates from center, falls off radially ---
export const bloom: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  const cx = (NUM_TUBES - 1) / 2;
  const cy = (PIXELS_PER_TUBE - 1) / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);
  // Radius scales with signal: small at low signal, fills at high signal
  const radius = ctx.signal * maxDist * 1.4;
  const sharpness = 2.5;

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    for (let t = 0; t < NUM_TUBES; t++) {
      const dx = t - cx;
      const dy = px - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // Falloff: 1 at center, fades to 0 at radius
      const falloff = Math.max(0, 1 - Math.pow(dist / Math.max(radius, 0.01), sharpness));
      grid[idx(px, t)] = falloff * ctx.signal;
    }
  }
  return grid;
};

// --- Vertical fill: bottom-up VU meter on each tube ---
export const verticalFill: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  const fillHeight = ctx.signal * PIXELS_PER_TUBE;

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      // px=0 is top, px=15 is bottom — fill from bottom
      const fromBottom = PIXELS_PER_TUBE - 1 - px;
      if (fromBottom < Math.floor(fillHeight)) {
        grid[idx(px, t)] = ctx.signal;
      } else if (fromBottom < fillHeight) {
        // Partial pixel at the top of the fill
        grid[idx(px, t)] = (fillHeight - Math.floor(fillHeight)) * ctx.signal;
      }
    }
  }
  return grid;
};

// --- Tube wipe: signal wipes across tubes left-to-right ---
export const tubeWipe: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  // Wipe position cycles every bar
  const wipePos = ctx.barPhase * NUM_TUBES;
  const width = 2.5;

  for (let t = 0; t < NUM_TUBES; t++) {
    const dist = Math.abs(t - wipePos);
    const wrappedDist = Math.min(dist, NUM_TUBES - dist);
    const intensity = Math.max(0, 1 - wrappedDist / width);
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      grid[idx(px, t)] = intensity * ctx.signal;
    }
  }
  return grid;
};

// --- Phase chase: each tube delayed by a fraction of a beat ---
// Creates a "wave" travelling across the tubes
const phaseChaseHistory: number[] = [];
const PHASE_HISTORY_SIZE = 60; // ~2 seconds at 30fps

export function resetPhaseChase() {
  phaseChaseHistory.length = 0;
}

export const phaseChase: SpatialModulator = (ctx) => {
  // Push current signal to history
  phaseChaseHistory.push(ctx.signal);
  if (phaseChaseHistory.length > PHASE_HISTORY_SIZE) phaseChaseHistory.shift();

  const grid = new Float32Array(GRID_SIZE);
  // Each tube reads from history at a different offset (1/8 beat per tube)
  const beatSec = 60 / ctx.bpm;
  const delayPerTube = (beatSec / 8) * 30; // frames

  for (let t = 0; t < NUM_TUBES; t++) {
    const historyIdx = phaseChaseHistory.length - 1 - Math.floor(t * delayPerTube);
    const value = historyIdx >= 0 ? phaseChaseHistory[historyIdx] : 0;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      grid[idx(px, t)] = value;
    }
  }
  return grid;
};

// --- Mirror split: tubes radiate from center outward ---
export const mirrorSplit: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  const center = (NUM_TUBES - 1) / 2;
  const reach = ctx.signal * (NUM_TUBES / 2 + 0.5);

  for (let t = 0; t < NUM_TUBES; t++) {
    const dist = Math.abs(t - center);
    const intensity = dist <= reach ? ctx.signal * (1 - dist / (NUM_TUBES / 2)) : 0;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      grid[idx(px, t)] = intensity;
    }
  }
  return grid;
};

// --- Pulse rings: concentric rings expanding on the beat ---
export const pulseRings: SpatialModulator = (ctx) => {
  const grid = new Float32Array(GRID_SIZE);
  const cx = (NUM_TUBES - 1) / 2;
  const cy = (PIXELS_PER_TUBE - 1) / 2;
  // Ring radius cycles each beat
  const ringRadius = ctx.beatPhase * 12;
  const ringWidth = 1.8;

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    for (let t = 0; t < NUM_TUBES; t++) {
      const dx = t - cx;
      const dy = px - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const intensity = Math.max(0, 1 - Math.abs(dist - ringRadius) / ringWidth);
      grid[idx(px, t)] = intensity * ctx.signal;
    }
  }
  return grid;
};

// --- Spatial Director ---
// Picks a spatial modulator based on the audio's spatial character:
//   - stereo width / pan motion (the audio's own physical space)
//   - dominant stem identity
//   - spectral brightness
//   - energy level
// Holds each choice for several beats so it feels intentional.

type SpatialKey = 'solid' | 'bloom' | 'phaseChase' | 'mirrorSplit';

interface SpatialDirectorState {
  current: SpatialKey;
  endsAtTime: number;
  recentChoices: SpatialKey[]; // anti-repetition memory
}

let _spatialDirState: SpatialDirectorState = {
  current: 'solid',
  endsAtTime: 0,
  recentChoices: [],
};

export function resetSpatialDirector() {
  _spatialDirState = { current: 'solid', endsAtTime: 0, recentChoices: [] };
}

// Score each option based on conditions, then weighted random pick.
// Anti-repetition: recently used choices get a penalty.
function chooseSpatial(ctx: SpatialContext, recent: SpatialKey[]): { key: SpatialKey; durationBeats: number } {
  const { dominantStem, panMotion, panPosition, centroid, energy, signal } = ctx;

  // Default scores — solid is reserved for peak intensity, bloom is the baseline
  const scores: Record<SpatialKey, number> = {
    solid: 0.0,
    bloom: 1.0,
    phaseChase: 0.5,
    mirrorSplit: 0.5,
  };

  // Solid only earns weight at very high intensity (peak drops/hits)
  if (signal > 0.75 && energy > 0.6) {
    // Quadratic ramp so it really only kicks in at the top
    scores.solid = Math.pow((signal - 0.75) / 0.25, 2) * 4;
  }

  // Pan motion → traveling effects
  if (panMotion > 0.25) {
    scores.phaseChase += 1.5 * (panMotion - 0.25) * 4;
    scores.mirrorSplit += 0.8 * (panMotion - 0.25) * 4;
  }

  // Off-center pan → mirror split
  if (Math.abs(panPosition) > 0.2) {
    scores.mirrorSplit += Math.abs(panPosition) * 1.5;
  }

  // Bright + energetic → phaseChase
  if (centroid > 0.45) {
    scores.phaseChase += (centroid - 0.45) * 3 * energy;
  }

  // Hi-hat dominant → bloom or phaseChase, never solid
  if (dominantStem === 'hat') {
    scores.bloom += 1.5;
    scores.phaseChase += 1.0;
    scores.solid *= 0.1; // strongly suppress
  }

  // Snare dominant → mirrorSplit or phaseChase
  if (dominantStem === 'snare') {
    scores.mirrorSplit += 0.8;
    scores.phaseChase += 0.5;
  }

  // Bass/kick + signal → bloom
  if ((dominantStem === 'kick' || dominantStem === 'bass') && signal > 0.35) {
    scores.bloom += (signal - 0.35) * 4;
  }

  // Anti-repetition penalty
  for (const r of recent) {
    if (scores[r] !== undefined) scores[r] *= 0.6;
  }

  // Weighted random pick
  const keys = Object.keys(scores) as SpatialKey[];
  let total = 0;
  for (const k of keys) total += scores[k];
  let pick: SpatialKey = 'solid';
  let r = Math.random() * total;
  for (const k of keys) {
    r -= scores[k];
    if (r <= 0) { pick = k; break; }
  }

  // Hold time varies by choice and energy
  const baseHold = pick === 'solid' ? 4 : 4 + Math.random() * 4; // 4-8 beats for non-solid
  const energyAdjust = 1 + (1 - energy) * 0.5; // longer holds at low energy
  const durationBeats = baseHold * energyAdjust;

  return { key: pick, durationBeats };
}

export const spatialDirector: SpatialModulator = (ctx) => {
  const state = _spatialDirState;
  if (ctx.time >= state.endsAtTime) {
    const { key, durationBeats } = chooseSpatial(ctx, state.recentChoices);
    state.current = key;
    state.recentChoices.push(key);
    if (state.recentChoices.length > 3) state.recentChoices.shift();
    const beatSec = 60 / ctx.bpm;
    state.endsAtTime = ctx.time + durationBeats * beatSec;
  }

  switch (state.current) {
    case 'bloom':        return bloom(ctx);
    case 'phaseChase':   return phaseChase(ctx);
    case 'mirrorSplit':  return mirrorSplit(ctx);
    default:             return solid(ctx);
  }
};

export function getSpatialDirectorChoice(): SpatialKey {
  return _spatialDirState.current;
}

// --- Registry ---
export const SPATIAL_MODULATORS: Record<string, { name: string; fn: SpatialModulator }> = {
  director:    { name: 'Director',     fn: spatialDirector },
  solid:       { name: 'Solid',        fn: solid },
  bloom:       { name: 'Bloom',        fn: bloom },
  phaseChase:  { name: 'Phase Chase',  fn: phaseChase },
  mirrorSplit: { name: 'Mirror Split', fn: mirrorSplit },
};
