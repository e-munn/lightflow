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
 * Gate envelope per stem (Logic Pro noise gate style)
 *  - threshold:    signal must exceed this to open the gate
 *  - attackBeats:  time to ramp from current to full when opening
 *  - holdBeats:    keep gate open this long after signal drops below threshold
 *  - releaseBeats: time to ramp down to zero after hold expires
 *
 * All times are beat-relative so they scale with BPM.
 */
interface Gate {
  threshold: number;
  attackBeats: number;
  holdBeats: number;
  releaseBeats: number;
}

const GATES: Record<string, Gate> = {
  // All gates near-binary: snap on, hold briefly, snap off
  bass:  { threshold: 0.25, attackBeats: 1/64, holdBeats: 1/8,  releaseBeats: 1/16 },
  kick:  { threshold: 0.30, attackBeats: 1/64, holdBeats: 1/16, releaseBeats: 1/16 },
  snare: { threshold: 0.25, attackBeats: 1/64, holdBeats: 1/16, releaseBeats: 1/16 },
  hat:   { threshold: 0.15, attackBeats: 1/64, holdBeats: 0,    releaseBeats: 1/32 },
  other: { threshold: 0.30, attackBeats: 1/32, holdBeats: 1/8,  releaseBeats: 1/16 },
};

const PRIORITY: Record<string, number> = {
  bass: 1.4,
  kick: 1.3,
  snare: 1.0,
  hat: 0.8,
  other: 0.5,
};

// --- Gate state ---
type GatePhase = 'closed' | 'attack' | 'open' | 'hold' | 'release';

// --- State ---
let currentDominant = 'bass';
let beatsHeld = 0;
let avgEnergy: Record<string, number> = {};
let avgVariance: Record<string, number> = {};
let initialized = false;
let silentFrames = 0;        // count of consecutive near-silent frames

// Gate envelope state (one shared, follows current dominant)
let gateValue = 0;             // 0-1 current envelope output
let gatePhase: GatePhase = 'closed';
let gateHoldRemaining = 0;     // beats remaining in hold phase

// Hold range in beats
const MAX_HOLD_BEATS = 16;   // 4 bars — intros, low energy
const MIN_HOLD_BEATS = 1;    // 1/4 bar — drops, high energy
const TAKEOVER_RATIO = 1.8;
const ONSET_OVERRIDE = 0.7;

// Energy window for scoring (seconds)
const AVG_TAU = 1.5;

// Per-stem previous frame energies for variance computation
let prevFrameEnergy: Record<string, number> = {};

export function resetAttention(): void {
  currentDominant = 'bass';
  beatsHeld = 0;
  avgEnergy = {};
  avgVariance = {};
  prevFrameEnergy = {};
  initialized = false;
  gateValue = 0;
  gatePhase = 'closed';
  gateHoldRemaining = 0;
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

  // 3. Score stems by avg energy × priority + rhythmic variance bonus
  // Variance bonus rewards pulsing/rhythmic stems over flatlined sustained ones
  const scores: Record<string, number> = {};
  for (const s of STEMS) {
    const baseScore = avgEnergy[s] * (PRIORITY[s] ?? 1.0);
    // Variance bonus: a pulsing stem with mid energy beats a flat sustained one
    // Multiplied by avg energy so silent stems don't get false credit
    const varianceBonus = avgVariance[s] * 8.0 * Math.min(1, avgEnergy[s] * 2);
    scores[s] = baseScore + varianceBonus;
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
      gatePhase = 'closed';
    } else if (beatsHeld >= requiredHold && bestScore > currentScore * TAKEOVER_RATIO) {
      currentDominant = bestStem;
      beatsHeld = 0;
      gatePhase = 'closed';
    }
  }

  // 8. Gate envelope (per-stem threshold + ADHR)
  const gate = GATES[currentDominant] ?? GATES.bass;
  const rawInput = stems[currentDominant] ?? 0;
  const aboveThreshold = rawInput > gate.threshold;

  // State transitions
  if (aboveThreshold) {
    if (gatePhase === 'closed' || gatePhase === 'release') {
      gatePhase = 'attack';
    } else if (gatePhase === 'hold') {
      gatePhase = 'open'; // re-trigger
    }
  } else {
    if (gatePhase === 'attack' || gatePhase === 'open') {
      gatePhase = 'hold';
      gateHoldRemaining = gate.holdBeats;
    }
  }

  // Time update for hold
  if (gatePhase === 'hold') {
    gateHoldRemaining -= beatsThisFrame;
    if (gateHoldRemaining <= 0) {
      gatePhase = 'release';
    }
  }

  // Apply ramp based on phase
  // Convert beats → seconds → tau
  const beatSec = 60 / bpm;
  if (gatePhase === 'attack') {
    const tau = Math.max(gate.attackBeats * beatSec, 0.001);
    const alpha = 1 - Math.exp(-dt / tau);
    // Track raw input as target during attack
    gateValue += alpha * (rawInput - gateValue);
    if (gateValue >= rawInput - 0.01) {
      gatePhase = 'open';
    }
  } else if (gatePhase === 'open') {
    // Follow input directly while open (smooth tracking)
    const tau = Math.max(gate.attackBeats * beatSec, 0.001);
    const alpha = 1 - Math.exp(-dt / tau);
    gateValue += alpha * (rawInput - gateValue);
  } else if (gatePhase === 'hold') {
    // Hold current value
  } else if (gatePhase === 'release') {
    const tau = Math.max(gate.releaseBeats * beatSec, 0.001);
    const alpha = 1 - Math.exp(-dt / tau);
    gateValue += alpha * (0 - gateValue);
    if (gateValue < 0.01) {
      gateValue = 0;
      gatePhase = 'closed';
    }
  }

  // Reset gate when dominant switches
  // (handled implicitly: gate value carries over but next frame's threshold check
  //  with new stem's gate config will trigger appropriate phase)

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
    holdBeats: requiredHold,
    beatsHeld,
    overallEnergy,
    scores,
    avgEnergy: { ...avgEnergy },
  };
}
