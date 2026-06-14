// Live reactive overlay. Scales fixture brightness by mic energy (quiet -> dim,
// loud -> full), punches the washes on bass, and pops everything on transient
// onsets. It modulates DIM ONLY — colour, position, scene and tempo are left
// alone, so it layers cleanly on top of scenes and the colour override.

import { RIG, FixtureState } from './fixtures';
import { AudioFrame } from './liveAudio';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function applyReactive(states: Record<string, FixtureState>, a: AudioFrame, amount = 1): Record<string, FixtureState> {
  if (amount <= 0) return states;
  const lift = 0.45 + 0.55 * a.energy; // overall envelope
  const pop = a.onset ? 0.3 : 0;
  const out: Record<string, FixtureState> = {};
  for (const f of RIG) {
    const s: FixtureState = { ...states[f.id] };
    let m = lift + pop;
    if (f.kind === 'shockerPanel') m = lift + a.bass * 0.45 + pop; // bass punches washes
    else if (f.kind === 'halo100x') m = lift + a.bass * 0.3;
    s.dim = clamp01((s.dim ?? 0) * mix(1, m, amount));
    out[f.id] = s;
  }
  return out;
}
