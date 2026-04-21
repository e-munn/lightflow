/**
 * Musical Signal Model v4
 *
 * Picks ONE stem. Hold time is in beats, not seconds.
 * Low energy = long holds (4 bars). High energy = short holds (1/4 bar).
 * Musical instrument, not a timer.
 */

import { StemFrame, Attention } from '@/types/v3';

const STEMS = ['bass', 'kick', 'snare', 'hat', 'other'] as const;

/**
 * Two gate styles:
 *
 *  FOLLOWER (legacy): tracks the raw signal value while open.
 *    Used for sustained stems where the signal IS the shape.
 *
 *  TRIGGERED: each rising edge above threshold fires a pre-shaped envelope
 *    that plays out independently of the raw input. The signal acts as a
 *    cue — once triggered, the envelope follows its own curve.
 *    Re-triggers update the peak value but don't restart the shape.
 *    This produces clean, musical envelopes regardless of signal noise.
 */
/**
 * Stem profile = how an instrument's envelope should feel.
 *
 * Two layers:
 *  1. Audio tracker — a peak follower with stem-specific attack/release time
 *     constants. The visual brightness FOLLOWS the actual audio energy curve,
 *     denoised by the filter. This gives natural rise/fall.
 *  2. Character shape — on rising-edge events, a synthetic curve is overlaid
 *     that has the characteristic SHAPE of that instrument (exp decay for kick,
 *     square for hat, plateau for bass, transient+tail for snare, sigmoid for
 *     pad). The output is max(tracker, shapeOverlay).
 */
type ShapeKind = 'exp' | 'plateau' | 'square' | 'transient_tail' | 'sigmoid';

interface StemProfile {
  threshold: number;       // for trigger detection
  attackTau: number;       // tracker attack time constant (seconds)
  releaseTau: number;      // tracker release time constant (seconds)
  shapeKind: ShapeKind;    // character shape on triggers
  shapeBeats: number;      // shape duration in beats
  shapeWeight: number;     // 0..1 — how prominent the shape overlay is
}

const PROFILES: Record<string, StemProfile> = {
  // Kick: instant attack, exponential decay tail (real drum behavior)
  kick:  { threshold: 0.35, attackTau: 0.005, releaseTau: 0.18, shapeKind: 'exp',            shapeBeats: 0.7, shapeWeight: 0.85 },
  // Snare: sharp transient + slower noisy tail
  snare: { threshold: 0.30, attackTau: 0.005, releaseTau: 0.22, shapeKind: 'transient_tail', shapeBeats: 0.8, shapeWeight: 0.85 },
  // Hat: near-binary clicks
  hat:   { threshold: 0.18, attackTau: 0.002, releaseTau: 0.05, shapeKind: 'square',         shapeBeats: 0.18, shapeWeight: 0.9 },
  // Bass: slow attack, plateau, slow release — sustain naturally
  bass:  { threshold: 0.28, attackTau: 0.04,  releaseTau: 0.4,  shapeKind: 'plateau',        shapeBeats: 2.0, shapeWeight: 0.6 },
  // Other: smooth pad — slow rise and fall via sigmoid
  other: { threshold: 0.28, attackTau: 0.08,  releaseTau: 0.5,  shapeKind: 'sigmoid',        shapeBeats: 1.5, shapeWeight: 0.5 },
};

// Compute character shape value at normalized phase (0 = trigger, 1 = end)
function shapeValue(kind: ShapeKind, t: number): number {
  if (t < 0 || t > 1) return 0;
  switch (kind) {
    case 'exp':
      // Sharp rise then exponential fall: 1 at t=0, decays fast
      return Math.exp(-t * 4.5);
    case 'transient_tail': {
      // Two-stage: very fast spike + slower noise tail
      const transient = Math.exp(-t * 12);     // sharp peak
      const tail = Math.exp(-t * 2.5) * 0.5;   // slower body
      return Math.min(1, transient + tail);
    }
    case 'square':
      // On for first 60% of duration, off after
      return t < 0.6 ? 1 : 0;
    case 'plateau': {
      // Quick rise → plateau → quick fall
      if (t < 0.15) return t / 0.15;
      if (t > 0.85) return (1 - t) / 0.15;
      return 1;
    }
    case 'sigmoid': {
      // Smooth S-curve up and down: peak at center
      const x = t < 0.5 ? t * 2 : (1 - t) * 2;
      return x * x * (3 - 2 * x); // smoothstep
    }
  }
}

const BASE_PRIORITY: Record<string, number> = {
  bass: 1.4,
  kick: 1.3,
  snare: 1.0,
  hat: 0.8,
  other: 0.5,
};

let PRIORITY: Record<string, number> = { ...BASE_PRIORITY };

export function configureAttention(scoutWeights?: Record<string, number>): void {
  PRIORITY = { ...BASE_PRIORITY };
  if (!scoutWeights) return;
  for (const [stem, weight] of Object.entries(scoutWeights)) {
    if (PRIORITY[stem] !== undefined) {
      PRIORITY[stem] = BASE_PRIORITY[stem] * weight;
    }
  }
}

// --- State ---
let currentDominant = 'bass';
let beatsHeld = 0;
let avgEnergy: Record<string, number> = {};
let avgVariance: Record<string, number> = {};
let initialized = false;
let silentFrames = 0;
let prevDominantEnergy = 0; // for energy derivative

// Main dominant-stem follower state (audio tracker for the channel-1 signal)
interface FollowerState {
  trackerValue: number;     // smoothed audio tracker
  prevInput: number;        // for rising-edge detection
  shapeBeatsElapsed: number;
  shapePeak: number;
  shapeActive: boolean;
}
const mainFollower: FollowerState = {
  trackerValue: 0,
  prevInput: 0,
  shapeBeatsElapsed: 0,
  shapePeak: 0,
  shapeActive: false,
};
let gateValue = 0;

// --- Channel 2: accent envelope ---
const ACCENT_STEMS = ['kick', 'snare', 'hat'] as const;
const ACCENT_THRESHOLD = 0.35;
let accentValue = 0;
let accentStem = 'kick';
let accentBeatsElapsed = 0;
let accentPhase: 'idle' | 'attack' | 'decay' = 'idle';
let accentPrevMax = 0;

// --- Per-stem parallel followers ---
// Each stem runs its own audio tracker + character shape state, used by
// the spectrograph scene to show all instruments simultaneously.
const perStemFollowers: Record<string, FollowerState> = {};

// Hold range in beats
const MAX_HOLD_BEATS = 16;   // 4 bars — intros, low energy
const MIN_HOLD_BEATS = 2;    // 1/2 bar — drops, high energy
const TAKEOVER_RATIO = 2.1;
const ONSET_OVERRIDE = 0.7;

/**
 * Run one frame of the stem profile processing.
 * Layer 1: peak follower with stem-specific time constants.
 * Layer 2: character shape overlaid on rising-edge events.
 * Output is max of the two so the shape can punch above the tracker.
 */
function processProfile(
  state: FollowerState,
  rawInput: number,
  dt: number,
  beatsThisFrame: number,
  profile: StemProfile,
): number {
  // Layer 1: stem-aware peak follower (asymmetric rise/fall time constants)
  const tau = rawInput > state.trackerValue ? profile.attackTau : profile.releaseTau;
  const alpha = 1 - Math.exp(-dt / Math.max(tau, 0.001));
  state.trackerValue += alpha * (rawInput - state.trackerValue);
  if (state.trackerValue < 0) state.trackerValue = 0;

  // Layer 2: character shape — fire on rising edge through threshold
  const aboveNow = rawInput > profile.threshold;
  const aboveBefore = state.prevInput > profile.threshold;
  const risingEdge = aboveNow && !aboveBefore;

  if (risingEdge) {
    state.shapeBeatsElapsed = 0;
    state.shapePeak = Math.max(rawInput, state.shapePeak * 0.6);
    state.shapeActive = true;
  } else if (aboveNow && rawInput > state.shapePeak) {
    state.shapePeak = rawInput;
  }

  let shapeContribution = 0;
  if (state.shapeActive) {
    state.shapeBeatsElapsed += beatsThisFrame;
    const t = state.shapeBeatsElapsed / Math.max(profile.shapeBeats, 1e-6);
    if (t >= 1) {
      state.shapeActive = false;
    } else {
      shapeContribution = shapeValue(profile.shapeKind, t) * state.shapePeak * profile.shapeWeight;
    }
  }

  state.prevInput = rawInput;
  // Combine: tracker is the base, shape can punch above it
  return Math.min(1, Math.max(state.trackerValue, shapeContribution));
}

function makeFollower(): FollowerState {
  return {
    trackerValue: 0,
    prevInput: 0,
    shapeBeatsElapsed: 0,
    shapePeak: 0,
    shapeActive: false,
  };
}

// Energy window for scoring (seconds)
const AVG_TAU = 1.5;

// Per-stem previous frame energies for variance computation
let prevFrameEnergy: Record<string, number> = {};

export function resetAttention(): void {
  PRIORITY = { ...BASE_PRIORITY };
  currentDominant = 'bass';
  beatsHeld = 0;
  avgEnergy = {};
  avgVariance = {};
  prevFrameEnergy = {};
  initialized = false;
  prevDominantEnergy = 0;
  gateValue = 0;
  // Reset main follower
  mainFollower.trackerValue = 0;
  mainFollower.prevInput = 0;
  mainFollower.shapeBeatsElapsed = 0;
  mainFollower.shapePeak = 0;
  mainFollower.shapeActive = false;
  accentValue = 0;
  accentStem = 'kick';
  accentBeatsElapsed = 0;
  accentPhase = 'idle';
  accentPrevMax = 0;
  for (const s of STEMS) {
    perStemFollowers[s] = makeFollower();
  }
}

/**
 * Map energy to hold duration, snapped to musical multiples: 1, 2, 4, 8, 16 beats.
 * Low energy → long holds (16/8). High energy → short holds (1/2).
 */
const HOLD_STEPS = [16, 8, 4, 2, 1];

function holdBeatsForEnergy(energy: number): number {
  const t = Math.max(0, Math.min(1, energy));
  // 0.0-0.2 → 16 beats, 0.2-0.4 → 8, 0.4-0.6 → 4, 0.6-0.8 → 2, 0.8-1.0 → 1
  const idx = Math.min(HOLD_STEPS.length - 1, Math.floor(t * HOLD_STEPS.length));
  return HOLD_STEPS[idx];
}

export function computeAttention(frame: StemFrame, dt: number, bpm: number): Attention {
  const stems = frame.stems as unknown as Record<string, number>;
  const onsets = frame.onsets as unknown as Record<string, number>;

  if (!initialized) {
    silentFrames = 0;
    for (const s of STEMS) {
      avgEnergy[s] = stems[s] ?? 0;
      avgVariance[s] = 0;
      prevFrameEnergy[s] = stems[s] ?? 0;
    }
    let best = 'bass', bestScore = 0;
    for (const s of STEMS) {
      const score = (stems[s] ?? 0) * (PRIORITY[s] ?? 1);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    currentDominant = best;
    initialized = true;
  }

  // 1. Track beats elapsed
  const beatsPerSecond = bpm / 60;
  const beatsThisFrame = dt * beatsPerSecond;
  beatsHeld += beatsThisFrame;

  // Silence detection: if everything is near-zero, count silent frames
  let totalNow = 0;
  for (const s of STEMS) totalNow += stems[s] ?? 0;
  if (totalNow < 0.08) {
    silentFrames++;
  } else {
    // Just exited silence — unlock so next decision can happen immediately
    if (silentFrames >= 3) {
      beatsHeld = MAX_HOLD_BEATS; // pretend we've held forever, allowing instant switch
    }
    silentFrames = 0;
  }

  // 2. Update slow-moving average energy + variance per stem
  const alpha = dt > 0 ? 1 - Math.exp(-dt / AVG_TAU) : 1;
  // Variance smoothing is faster — we want to detect rhythmic activity quickly
  const varAlpha = dt > 0 ? 1 - Math.exp(-dt / 0.5) : 1;
  let totalEnergy = 0;
  for (const s of STEMS) {
    const energy = stems[s] ?? 0;
    avgEnergy[s] += alpha * (energy - avgEnergy[s]);
    // Variance proxy: smoothed absolute frame-to-frame change
    const delta = Math.abs(energy - prevFrameEnergy[s]);
    avgVariance[s] += varAlpha * (delta - avgVariance[s]);
    prevFrameEnergy[s] = energy;
    totalEnergy += energy;
  }
  // Overall energy level (0-1 range, average across stems)
  const overallEnergy = Math.min(1, totalEnergy / STEMS.length * 2);

  // Bass spectral richness: full-spectrum bass synths (gritty/distorted) have
  // mid-range centroids (~1500-4000 Hz). Pure sub-bass has centroids ~500 Hz.
  // We want full-spectrum bass to dominate attention more strongly than clean
  // sub-bass at the same amplitude.
  const centroid = frame.centroid ?? 1000;
  const bassRichness = centroid > 1500
    ? 1.0 + Math.min(1.0, (centroid - 1500) / 2500) * 0.8 // up to 1.8x
    : 1.0;

  // 3. Score stems by avg energy × priority + rhythmic variance bonus
  // Variance bonus rewards pulsing/rhythmic stems over flatlined sustained ones
  // Bass also gets a spectral richness boost
  // v1.4: Novelty bonus — when a stem's current energy is much higher than
  // its running average, it just entered the arrangement. Boost its score
  // so the attention layer jumps to the new element (e.g. hat entering
  // over an established kick/bass groove 4-8 bars into a drop).
  const scores: Record<string, number> = {};
  for (const s of STEMS) {
    let baseScore = avgEnergy[s] * (PRIORITY[s] ?? 1.0);
    if (s === 'bass') baseScore *= bassRichness;
    const varianceBonus = avgVariance[s] * 5.0 * Math.min(1, avgEnergy[s] * 2);
    const currentEnergy = stems[s] ?? 0;
    const novelty = Math.max(0, currentEnergy - avgEnergy[s]);
    const noveltyBonus = novelty * 8.0;
    scores[s] = baseScore + varianceBonus + noveltyBonus;
  }

  // 4. Adaptive hold: how many beats before we allow a switch
  const requiredHold = holdBeatsForEnergy(overallEnergy);

  // 5. Find best candidate
  let bestStem = currentDominant;
  let bestScore = 0;
  for (const s of STEMS) {
    if (scores[s] > bestScore) { bestScore = scores[s]; bestStem = s; }
  }
  const currentScore = scores[currentDominant] ?? 0;

  // 6. Check for onset override (big musical event, any energy level)
  let onsetOverride = false;
  for (const s of STEMS) {
    if (s !== currentDominant && (onsets[s] ?? 0) > ONSET_OVERRIDE && (stems[s] ?? 0) > 0.3) {
      bestStem = s;
      onsetOverride = true;
      break;
    }
  }

  // 7. Switch logic
  if (bestStem !== currentDominant) {
    if (onsetOverride) {
      currentDominant = bestStem;
      beatsHeld = 0;
      // Reset main follower so the new stem's profile starts clean
      mainFollower.trackerValue = 0;
      mainFollower.shapeActive = false;
      mainFollower.prevInput = 0;
    } else if (beatsHeld >= requiredHold && bestScore > currentScore * TAKEOVER_RATIO) {
      currentDominant = bestStem;
      beatsHeld = 0;
      mainFollower.trackerValue = 0;
      mainFollower.shapeActive = false;
      mainFollower.prevInput = 0;
    }
  }

  // 8. Run the dominant stem's profile (audio tracker + character shape)
  const profile = PROFILES[currentDominant] ?? PROFILES.bass;
  const rawInput = stems[currentDominant] ?? 0;
  gateValue = processProfile(mainFollower, rawInput, dt, beatsThisFrame, profile);

  // v1.4: Energy derivative — positive = attack phase, peaks at transient instant
  const dEnergy = dt > 0 ? Math.max(0, (rawInput - prevDominantEnergy) / dt) : 0;
  prevDominantEnergy = rawInput;

  // v1.4: Onset-locked hard snap — when the analysis reports a strong onset
  // for the dominant stem, bypass the envelope entirely and snap to the raw
  // energy. This makes transient hits frame-perfect instead of smoothed.
  const dominantOnset = onsets[currentDominant as keyof typeof onsets] ?? 0;
  const onsetSnap = dominantOnset > 0.4 && rawInput > 0.25;
  if (onsetSnap) {
    gateValue = Math.max(gateValue, rawInput);
  }

  // --- Per-stem parallel followers ---
  // Each stem runs its own audio tracker + character shape, used by the
  // spectrograph scene to show all instruments simultaneously.
  const stemSignals: Record<string, number> = {};
  for (const s of STEMS) {
    if (!perStemFollowers[s]) {
      perStemFollowers[s] = makeFollower();
    }
    const psProfile = PROFILES[s] ?? PROFILES.bass;
    const psInput = stems[s] ?? 0;
    let psOut = processProfile(perStemFollowers[s], psInput, dt, beatsThisFrame, psProfile);
    if (s === 'bass') psOut *= bassRichness;
    stemSignals[s] = Math.min(1, psOut);
  }

  // --- Channel 2: accent envelope from strongest onset ---
  // Pure event-driven: each strong onset triggers a brief envelope.
  // Tracks which stem fired so the visual layer can color-code.
  let maxOnset = 0;
  let maxOnsetStem = accentStem;
  for (const s of ACCENT_STEMS) {
    const v = onsets[s] ?? 0;
    if (v > maxOnset) { maxOnset = v; maxOnsetStem = s; }
  }

  // Rising edge above threshold → trigger
  if (maxOnset > ACCENT_THRESHOLD && accentPrevMax <= ACCENT_THRESHOLD) {
    accentStem = maxOnsetStem;
    accentBeatsElapsed = 0;
    accentPhase = 'attack';
  } else if (maxOnset > ACCENT_THRESHOLD && maxOnset > accentPrevMax + 0.1 && accentPhase !== 'attack') {
    // Re-trigger if a stronger hit comes during decay
    accentStem = maxOnsetStem;
    accentBeatsElapsed = 0;
    accentPhase = 'attack';
  }
  accentPrevMax = maxOnset;
  accentBeatsElapsed += beatsThisFrame;

  // Render accent envelope shape
  const ATK = 1/64;  // very fast attack
  const DEC = 1/8;   // short decay
  if (accentPhase === 'attack') {
    const t = accentBeatsElapsed / ATK;
    if (t >= 1) {
      accentValue = 1;
      accentPhase = 'decay';
      accentBeatsElapsed = 0;
    } else {
      accentValue = t;
    }
  } else if (accentPhase === 'decay') {
    const t = Math.min(1, accentBeatsElapsed / DEC);
    accentValue = Math.pow(1 - t, 2.5);
    if (t >= 1) {
      accentPhase = 'idle';
      accentValue = 0;
    }
  } else {
    accentValue = 0;
  }

  // Output
  let total = 0;
  for (const s of STEMS) total += scores[s];
  const weights: Record<string, number> = {};
  const novelties: Record<string, number> = {};
  for (const s of STEMS) {
    weights[s] = total > 0 ? scores[s] / total : 1 / STEMS.length;
    novelties[s] = Math.max(0, (stems[s] ?? 0) - avgEnergy[s]);
  }

  return {
    weights,
    dominant: currentDominant,
    novelty: novelties,
    signal: Math.min(1.0, gateValue),
    accent: Math.min(1, accentValue),
    accentStem,
    stemSignals,
    holdBeats: requiredHold,
    beatsHeld,
    overallEnergy,
    scores,
    avgEnergy: { ...avgEnergy },
    onsetSnap,
    dEnergy: Math.min(1, dEnergy * 0.3),
  };
}
