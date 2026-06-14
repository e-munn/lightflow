// AutoPilot — turns the live AudioFrame stream into automatic scene + colour
// selection, so the show tracks the music with no operator input (manual keys
// override; toggle off with A).
//
// Why a state machine, not a neural net: the useful signals (energy / bands /
// onset / build) are already extracted by liveAudio; the hard part is MUSICAL
// PHRASING — identifying the drop, holding a look, escalating at the right time.
// That's a hysteresis + min-hold machine, at zero added latency.
//
// KEY IDEA — relative level: we judge energy against the track's OWN running
// peak (eMax), not an absolute threshold. So a drop (near the loudest the track
// has been) reads as "high" no matter the input gain, and quiet intros don't.
//
// Scenes: 1 Halo · 2 Spots (breakdown/iso) · 4 Rise 5 Surge 6 Drive 7 Pulse
// (ramp) · 8 Peak 9 Blinder 0 Party (max + strobe — the drops).

import { AudioFrame } from './liveAudio';

const REL_PEAK = 0.72; // ≥ this fraction of recent-peak energy = top tier (drop)
const REL_DRIVE = 0.5;
const REL_SURGE = 0.32;
const ABS_FLOOR = 0.1; // below this raw energy, never "high" (quiet-intro guard)
const HOLD_BEATS = 8; // min beats between non-drop changes (~2 bars) — anti-flicker
const VARY_BARS = 8; // re-pick the top scene every N bars while a drop sustains
const MANUAL_HOLD_BARS = 8; // after the operator overrides, AutoPilot yields this long

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const isTop = (k: string) => k === '8' || k === '9' || k === '0';

// scene key (or null = no change), and colour key (null = amber, undefined = leave)
export interface AutoDecision {
  scene: string | null;
  color: string | null | undefined;
}
const HOLD: AutoDecision = { scene: null, color: undefined };

export interface AutoStatus {
  rel: number; // current energy as a fraction of recent peak
  dropping: boolean; // currently holding a max scene
  suppressed: boolean; // yielding to a manual override
  scene: string; // current scene key
  bias: number; // -1 low · 0 default · +1 high intensity
}

// How much one bias step shifts the effective level. The tier gaps are ~0.2,
// so 0.26 moves the SAME music by more than a full tier between low↔high — a
// clearly visible difference, not a subtle nudge.
const BIAS_STEP = 0.26;

export class AutoPilot {
  private lastChangeAt = -1e9;
  private current = '';
  private baseline = 0; // slow energy average
  private eMax = 0.05; // slow-decay running peak — the relative-level reference
  private lowAt = -1e9; // last time we were clearly quiet (for "came from a lull")
  private dropUntil = 0; // hold a top scene until this time
  private topCount = 0; // rotates the top scene + party colour for variety
  private suppressUntil = 0; // operator overrode — yield until this time
  private bias = 0; // -1 low · 0 default · +1 high — a persistent intensity lean
  // status (for the readout)
  private lastRel = 0;
  private dropping = false;
  private suppressed = false;

  reset() {
    this.lastChangeAt = -1e9;
    this.current = '';
    this.baseline = 0;
    this.eMax = 0.05;
    this.lowAt = -1e9;
    this.dropUntil = 0;
    this.topCount = 0;
    this.suppressUntil = 0;
    this.lastRel = 0;
    this.dropping = false;
    this.suppressed = false;
  }

  getStatus(): AutoStatus {
    return { rel: this.lastRel, dropping: this.dropping, suppressed: this.suppressed, scene: this.current, bias: this.bias };
  }

  // Nudge the intensity lean (↑ more intense, ↓ less). Persists indefinitely —
  // NOT cleared by reset(), so the operator's chosen mode survives scrubs.
  adjustBias(dir: number): number {
    this.bias = Math.max(-1, Math.min(1, this.bias + Math.sign(dir)));
    return this.bias;
  }

  setBias(b: number): number {
    this.bias = Math.max(-1, Math.min(1, Math.round(b)));
    return this.bias;
  }

  // The operator hand-picked a look — yield to it for MANUAL_HOLD_BARS before
  // taking back over, and remember what they set as the current look.
  noteManual(now: number, bpm: number | null, key: string) {
    const bar = (bpm ? 60000 / bpm : 500) * 4;
    this.suppressUntil = now + bar * MANUAL_HOLD_BARS;
    this.current = key;
    this.lastChangeAt = now;
    this.dropUntil = 0;
  }

  // Returns a scene+colour to apply, or HOLD. Call every frame while a live
  // source (mic/sim) runs.
  step(now: number, a: AudioFrame, bpm: number | null): AutoDecision {
    if (now < this.suppressUntil) {
      this.suppressed = true;
      return HOLD; // operator override holds the floor
    }
    this.suppressed = false;

    const beat = bpm ? 60000 / bpm : 500;
    const bar = beat * 4;

    // adaptive level: energy as a fraction of the track's recent peak
    this.baseline += (a.energy - this.baseline) * 0.01;
    this.eMax = Math.max(a.energy, this.eMax * 0.9995); // ~halves over ~20s
    const rel = a.energy < ABS_FLOOR ? 0 : clamp01(a.energy / (this.eMax + 1e-6));
    this.lastRel = rel; // status shows the TRUE level; bias only shifts decisions
    // effective level after the intensity lean (HIGH reads louder, LOW quieter)
    const r = rel <= 0 ? 0 : clamp01(rel + this.bias * BIAS_STEP);
    if (r < REL_SURGE) this.lowAt = now;

    // DROP: near-peak energy WITH bass, off a lull / build / transient. The mode
    // leans how eagerly drops fire AND how long a max scene is held:
    //   low  → only real drops off a lull, held briefly (calmer)
    //   high → fires on any energetic onset, held long (relentless)
    const cameFromLow = now - this.lowAt < bar * 4;
    const trig =
      this.bias < 0
        ? cameFromLow
        : this.bias > 0
          ? cameFromLow || a.build > 0.2 || a.onset || a.bass > 0.45
          : cameFromLow || a.build > 0.3 || a.onset;
    const isDrop = r >= REL_PEAK && a.bass >= 0.28 && trig;
    const stillHot = r >= REL_DRIVE && a.bass >= 0.22;
    const topHold = this.bias > 0 ? 6 : this.bias < 0 ? 2 : 4; // bars a max scene is held
    if (isDrop) this.dropUntil = Math.max(this.dropUntil, now + bar * topHold);
    else if (stillHot && now < this.dropUntil) this.dropUntil = now + bar * (this.bias > 0 ? 3 : 2);
    this.dropping = now < this.dropUntil;

    let key: string | null = null;
    if (this.dropping) {
      // stay on a MAX scene, rotating it for life
      if (!isTop(this.current) || now - this.lastChangeAt > bar * VARY_BARS) key = this.commitTop(now, a, r);
    } else {
      const target = this.classify(a, r);
      const fastCut = (target === '1' || target === '2') && a.bass < 0.1 && r < REL_SURGE;
      if (target !== this.current && (fastCut || now - this.lastChangeAt > beat * HOLD_BEATS)) key = this.commit(target, now);
    }
    return key ? { scene: key, color: this.colorFor(key) } : HOLD;
  }

  private commitTop(now: number, a: AudioFrame, rel: number): string | null {
    let key = '8'; // Peak — the default drop
    if (rel >= 0.9 && a.bass >= 0.4) key = '9'; // absolute peak -> Blinder
    else if (this.topCount % 2 === 1) key = '0'; // alternate -> Party (colour + variety)
    this.topCount++;
    return this.commit(key, now);
  }

  private commit(key: string, now: number): string | null {
    if (key === this.current) return null;
    this.current = key;
    this.lastChangeAt = now;
    return key;
  }

  // Colour that suits each look: warm groove, atmospheric breakdown, white
  // peaks, a rotating pop on Party. null = amber (the resting colour).
  private colorFor(key: string): string | null {
    switch (key) {
      case '2': return 'b'; // spots breakdown -> cool blue beams
      case '7': return 'w'; // riser -> white tension
      case '8': return 'w'; // peak -> white
      case '9': return 'w'; // blinder -> white
      case '0': return ['b', 'r', 'g', 'y'][this.topCount % 4]; // party -> rotating colour pop
      default: return null; // halo + ramp groove (1/4/5/6) -> amber
    }
  }

  private classify(a: AudioFrame, rel: number): string {
    if (a.bass < 0.12 && rel < REL_SURGE) return a.mid > 0.2 ? '2' : '1'; // breakdown / quiet
    if (a.build > 0.45 && rel < REL_PEAK) return '7'; // riser building toward a drop
    if (rel >= REL_PEAK) return '8';
    if (rel >= REL_DRIVE) return '6';
    if (rel >= REL_SURGE) return '5';
    return '4';
  }
}
