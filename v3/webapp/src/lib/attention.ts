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
type GateStyle = 'follower' | 'triggered';

interface Gate {
  style: GateStyle;
  threshold: number;
  // Triggered envelope parameters
  attackBeats: number;   // smooth ramp from 0 to peak
  holdBeats: number;     // brief plateau at peak
  decayBeats: number;    // smooth ramp from peak back to 0
  // Curve shaping (1.0 = linear, >1 = ease-out, <1 = ease-in)
  decayCurve: number;
}

const GATES: Record<string, Gate> = {
  // Bass: smooth musical envelope on each event — longer attack + decay for fluid feel
  bass:  { style: 'triggered', threshold: 0.30, attackBeats: 1/4,  holdBeats: 0,    decayBeats: 1,    decayCurve: 2.0 },
  // Kick: punchy triggered envelope
  kick:  { style: 'triggered', threshold: 0.35, attackBeats: 1/32, holdBeats: 1/32, decayBeats: 1/4,  decayCurve: 3.0 },
  // Snare: similar to kick
  snare: { style: 'triggered', threshold: 0.30, attackBeats: 1/32, holdBeats: 1/32, decayBeats: 1/4,  decayCurve: 2.5 },
  // Hat: very short triggered envelope
  hat:   { style: 'triggered', threshold: 0.18, attackBeats: 1/64, holdBeats: 0,    decayBeats: 1/8,  decayCurve: 2.0 },
  // Other: still uses follower style — sustained content needs to track raw
  other: { style: 'follower',  threshold: 0.30, attackBeats: 1/12, holdBeats: 1/8,  decayBeats: 1/16, decayCurve: 1.0 },
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

// Triggered envelope state
let trigPeak = 0;              // captured peak value at trigger
let trigBeatsElapsed = 0;      // beats since trigger fired
let trigPhase: 'idle' | 'attack' | 'hold' | 'decay' = 'idle';
let trigPrevInput = 0;         // for rising-edge detection

// --- Channel 2: accent envelope ---
const ACCENT_STEMS = ['kick', 'snare', 'hat'] as const;
const ACCENT_THRESHOLD = 0.35;
let accentValue = 0;
let accentStem = 'kick';
let accentBeatsElapsed = 0;
let accentPhase: 'idle' | 'attack' | 'decay' = 'idle';
let accentPrevMax = 0;

// --- Per-stem parallel gate envelopes ---
// Each stem runs its own triggered envelope alongside the dominant gate.
// Used by the spectrograph scene to show all instruments simultaneously.
interface PerStemGateState {
  value: number;
  peak: number;
  beatsElapsed: number;
  phase: 'idle' | 'attack' | 'hold' | 'decay';
  prevInput: number;
}
const perStemGates: Record<string, PerStemGateState> = {};

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
  trigPeak = 0;
  trigBeatsElapsed = 0;
  trigPhase = 'idle';
  trigPrevInput = 0;
  accentValue = 0;
  accentStem = 'kick';
  accentBeatsElapsed = 0;
  accentPhase = 'idle';
  accentPrevMax = 0;
  for (const s of STEMS) {
    perStemGates[s] = { value: 0, peak: 0, beatsElapsed: 0, phase: 'idle', prevInput: 0 };
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
      trigPhase = 'idle';
    } else if (beatsHeld >= requiredHold && bestScore > currentScore * TAKEOVER_RATIO) {
      currentDominant = bestStem;
      beatsHeld = 0;
      gatePhase = 'closed';
      trigPhase = 'idle';
    }
  }

  // 8. Gate envelope — dispatch to follower or triggered style
  const gate = GATES[currentDominant] ?? GATES.bass;
  const rawInput = stems[currentDominant] ?? 0;
  const beatSec = 60 / bpm;

  if (gate.style === 'triggered') {
    // --- TRIGGERED ENVELOPE ---
    // Each rising-edge above threshold fires a smooth pre-shaped envelope.
    // The envelope plays out independently of raw input wiggles.
    const aboveThreshold = rawInput > gate.threshold;
    const risingEdge = aboveThreshold && trigPrevInput <= gate.threshold;

    // Trigger or re-trigger
    if (risingEdge) {
      // Capture peak — use the input value (or higher if a re-trigger arrives at higher peak)
      trigPeak = Math.max(rawInput, trigPhase !== 'idle' ? trigPeak * 0.7 : 0);
      trigBeatsElapsed = 0;
      trigPhase = 'attack';
    }
    // Allow re-trigger to update peak even mid-envelope
    if (aboveThreshold && rawInput > trigPeak) {
      trigPeak = rawInput;
    }

    // Advance envelope time
    trigBeatsElapsed += beatsThisFrame;

    // Render the envelope shape
    let envValue = 0;
    if (trigPhase === 'attack') {
      const t = trigBeatsElapsed / Math.max(gate.attackBeats, 1e-6);
      if (t >= 1) {
        envValue = trigPeak;
        trigPhase = 'hold';
        trigBeatsElapsed = 0;
      } else {
        // Ease-out curve for smoother attack
        envValue = trigPeak * (1 - Math.pow(1 - t, 2));
      }
    } else if (trigPhase === 'hold') {
      const t = trigBeatsElapsed / Math.max(gate.holdBeats, 1e-6);
      if (gate.holdBeats === 0 || t >= 1) {
        envValue = trigPeak;
        trigPhase = 'decay';
        trigBeatsElapsed = 0;
      } else {
        envValue = trigPeak;
      }
    } else if (trigPhase === 'decay') {
      const t = Math.min(1, trigBeatsElapsed / Math.max(gate.decayBeats, 1e-6));
      // Curve shape: t=0 → 1, t=1 → 0
      // decayCurve > 1 = ease-out (long tail), < 1 = ease-in (steep)
      const shape = Math.pow(1 - t, gate.decayCurve);
      envValue = trigPeak * shape;
      if (t >= 1) {
        trigPhase = 'idle';
        envValue = 0;
      }
    }

    gateValue = envValue;
    trigPrevInput = rawInput;
  } else {
    // --- FOLLOWER (legacy) ---
    const aboveThreshold = rawInput > gate.threshold;
    if (aboveThreshold) {
      if (gatePhase === 'closed' || gatePhase === 'release') {
        gatePhase = 'attack';
      } else if (gatePhase === 'hold') {
        gatePhase = 'open';
      }
    } else {
      if (gatePhase === 'attack' || gatePhase === 'open') {
        gatePhase = 'hold';
        gateHoldRemaining = gate.holdBeats;
      }
    }
    if (gatePhase === 'hold') {
      gateHoldRemaining -= beatsThisFrame;
      if (gateHoldRemaining <= 0) gatePhase = 'release';
    }
    if (gatePhase === 'attack') {
      const tau = Math.max(gate.attackBeats * beatSec, 0.001);
      const alpha = 1 - Math.exp(-dt / tau);
      gateValue += alpha * (rawInput - gateValue);
      if (gateValue >= rawInput - 0.01) gatePhase = 'open';
    } else if (gatePhase === 'open') {
      if (rawInput > gateValue) {
        const riseTau = Math.max(gate.attackBeats * beatSec, 0.001);
        const alpha = 1 - Math.exp(-dt / riseTau);
        gateValue += alpha * (rawInput - gateValue);
      } else {
        const leakTau = Math.max(0.25 * beatSec, 0.001);
        const alpha = 1 - Math.exp(-dt / leakTau);
        gateValue += alpha * (rawInput - gateValue);
      }
    } else if (gatePhase === 'release') {
      const tau = Math.max(gate.decayBeats * beatSec, 0.001);
      const alpha = 1 - Math.exp(-dt / tau);
      gateValue += alpha * (0 - gateValue);
      if (gateValue < 0.01) {
        gateValue = 0;
        gatePhase = 'closed';
      }
    }
  }

  // Reset gate when dominant switches
  // (handled implicitly: gate value carries over but next frame's threshold check
  //  with new stem's gate config will trigger appropriate phase)

  // --- Per-stem parallel gates ---
  // Run a triggered envelope for every stem in parallel.
  // Each uses its own GATES config (or follower for 'other').
  const stemSignals: Record<string, number> = {};
  for (const s of STEMS) {
    if (!perStemGates[s]) {
      perStemGates[s] = { value: 0, peak: 0, beatsElapsed: 0, phase: 'idle', prevInput: 0 };
    }
    const ps = perStemGates[s];
    const psGate = GATES[s] ?? GATES.bass;
    const psInput = stems[s] ?? 0;

    if (psGate.style === 'triggered') {
      const aboveThreshold = psInput > psGate.threshold;
      const risingEdge = aboveThreshold && ps.prevInput <= psGate.threshold;

      if (risingEdge) {
        ps.peak = Math.max(psInput, ps.phase !== 'idle' ? ps.peak * 0.7 : 0);
        ps.beatsElapsed = 0;
        ps.phase = 'attack';
      }
      if (aboveThreshold && psInput > ps.peak) ps.peak = psInput;
      ps.beatsElapsed += beatsThisFrame;

      if (ps.phase === 'attack') {
        const ph = ps.beatsElapsed / Math.max(psGate.attackBeats, 1e-6);
        if (ph >= 1) {
          ps.value = ps.peak;
          ps.phase = 'hold';
          ps.beatsElapsed = 0;
        } else {
          ps.value = ps.peak * (1 - Math.pow(1 - ph, 2));
        }
      } else if (ps.phase === 'hold') {
        const ph = ps.beatsElapsed / Math.max(psGate.holdBeats, 1e-6);
        if (psGate.holdBeats === 0 || ph >= 1) {
          ps.value = ps.peak;
          ps.phase = 'decay';
          ps.beatsElapsed = 0;
        } else {
          ps.value = ps.peak;
        }
      } else if (ps.phase === 'decay') {
        const ph = Math.min(1, ps.beatsElapsed / Math.max(psGate.decayBeats, 1e-6));
        ps.value = ps.peak * Math.pow(1 - ph, psGate.decayCurve);
        if (ph >= 1) {
          ps.phase = 'idle';
          ps.value = 0;
        }
      }
      ps.prevInput = psInput;
    } else {
      // Follower style (other): smooth peak track
      const target = psInput > psGate.threshold ? psInput : 0;
      const tau = (target > ps.value ? psGate.attackBeats : psGate.decayBeats) * beatSec;
      const a = 1 - Math.exp(-dt / Math.max(tau, 1e-6));
      ps.value += a * (target - ps.value);
    }

    stemSignals[s] = Math.min(1, ps.value);
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
  };
}
