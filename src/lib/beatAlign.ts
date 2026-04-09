/**
 * Beat-offset estimator.
 *
 * Most songs don't have a downbeat exactly at t=0 — there's an intro/pickup
 * that shifts the musical bar grid away from the recording's time axis.
 * Without compensating, our beat-phase math (used by the Director for
 * bar-snapped transitions) aligns to the wrong grid, and effects land
 * fractions of a beat off.
 *
 * This function grid-fits the first ~6 seconds of kick onsets against the
 * song's BPM to find the offset (in seconds) where the beat grid best
 * explains the kick pattern. Subtract the returned offset from `t` before
 * computing `beatPhase` / `barPhase`.
 *
 * Returns 0 if there's not enough onset data to fit.
 */

import { AnalysisResult } from '@/types/v3';

export function estimateBeatOffset(res: AnalysisResult): number {
  if (!res.frames.length) return 0;
  const beatSec = 60 / res.bpm;

  // Collect early kick onsets (first 6s, strength > 0.15)
  const samples: { t: number; v: number }[] = [];
  for (const f of res.frames) {
    if (f.time > 6.0) break;
    const v = f.onsets?.kick ?? 0;
    if (v > 0.15) samples.push({ t: f.time, v });
  }
  if (samples.length < 2) return 0;

  // Grid-fit: for each candidate offset (in beatSec/24 steps),
  // score by total onset strength that lands within ±1/8 beat of a grid line.
  const step = beatSec / 24;
  const tol = beatSec / 8;
  let bestOff = 0;
  let bestScore = -1;
  for (let o = 0; o < beatSec; o += step) {
    let score = 0;
    for (const s of samples) {
      const rel = ((s.t - o) % beatSec + beatSec) % beatSec;
      const dist = Math.min(rel, beatSec - rel);
      if (dist < tol) score += s.v * (1 - dist / tol);
    }
    if (score > bestScore) {
      bestScore = score;
      bestOff = o;
    }
  }
  return bestOff;
}

/**
 * Compute beat-phase + bar-phase for a time `t`, corrected by the
 * song's beat offset. Returns values in [0, 1).
 */
export function beatPhases(t: number, bpm: number, beatOffset: number) {
  const bt = t - beatOffset;
  const bpb = (bt * bpm) / 60;
  const beatPhase = ((bpb % 1) + 1) % 1;
  const barPhase = (((bpb / 4) % 1) + 1) % 1;
  return { beatPhase, barPhase };
}
