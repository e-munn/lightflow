// Scenes + the scene engine.
//
// A scene is a LIVING look, not a snapshot: a base state per fixture plus an
// `energy` level. Each frame the engine eases the base toward the active scene
// (continuous params lerp, discrete params snap) and then lays a beat-synced
// MOTION layer on top that scales with energy:
//   - Spots: pan/tilt oscillate on an LFO that repeats every bar (CYCLE_BEATS).
//     Amplitude + speed grow with energy — calm scenes barely drift, hot scenes
//     sweep wide and fast.
//   - Shockers: beat-synced strobe whose rate/likelihood rises with energy.
// Motion rides the tap-tempo clock (continuous `beats`), so it locks to the music.

import { RIG, FixtureState, defaultsFor, snapKeysFor } from './fixtures';

export interface Scene {
  id: string;
  name: string;
  key: string;
  fade: number; // seconds for the base look to cross-fade
  energy: number; // 0..1 — drives movement + strobe density
  states: Record<string, Partial<FixtureState>>;
  // Optional repeating pulse: each cycle blasts to `hit`, then decays back to
  // `states` (the rest look) over cycleBeats. Recreates the 9->1 blinder->embers
  // fade as a loop. Only the params present in `hit` blend; others stay at rest.
  pulse?: { cycleBeats: number; hit: Record<string, Partial<FixtureState>> };
  // Beat-synced strobe SPEED in cycles per beat (e.g. 1 = slow/quarter-note,
  // 2 = medium, 4 = fast). RESERVED for the max scenes (8/9/0); ramp scenes
  // (4-7) grow via brightness + movement and never strobe.
  strobe?: number;
  // Per-scene spot MOVEMENT pattern (so each scene moves differently, not one
  // shared LFO). Omit = static (no movement).
  //   kind  'orbit' = pan/tilt trace a circle · 'sway' = pan sweeps while tilt
  //         bobs at 2× (alternating feel) · 'none' = hold still
  //   speed cycles per bar (0.25 = one loop per 4 bars = slow · 1 = per bar)
  //   pan/tilt  amplitude in normalized units (pan 540°, tilt 270°; ~0.055 ≈ 30°)
  //   phase optional extra tilt phase offset (radians)
  motion?: { kind: 'orbit' | 'sway' | 'none'; speed: number; pan: number; tilt: number; phase?: number };
}

const CYCLE_BEATS = 4; // spot motion loops every bar
// Deterministic, tempo-locked variation: every 16 bars the spot sweep flips
// direction + the tilt baseline nudges, and washes breathe across the cycle —
// so a long-held scene keeps evolving without relying on the mic.
const VARY_BEATS = 64; // 16 bars

// Slew limit: max change in normalized pan/tilt per second — the head's real
// mechanical speed, and the cap on how fast a sweep can look. The Spot 160 pan
// spans 540° (0..1), tilt 270°. ~0.3/s pan ≈ a full sweep in ~3.3s; ~0.42/s
// tilt — graceful, realistic head motion rather than frantic whipping. These
// cap commanded motion so fast sweeps stay physically real. Tune at the bench.
const PAN_SLEW = 0.3;
const TILT_SLEW = 0.42;

// The scene layout, by key:
//   1-3  ISOLATION — one fixture group at a time: 1 Halo · 2 Spots · 3 Shockers
//   4-7  RAMP — the full rig growing in intensity by brightness + movement
//        speed/amplitude (7 Pulse = the rhythmic top). NO strobe.
//   8-0  MAX — full-throttle, the ONLY scenes that strobe: 8 Peak · 9 Blinder · 0 Party
export const SCENES: Scene[] = [
  // --- 1-3 isolation: solo one fixture group, everything else dark ---
  {
    id: 'halo', name: 'Halo', key: '1', fade: 1.5, energy: 0.1,
    states: {
      halo: { dim: 0.8, cct: 0.12 },
    },
  },
  {
    id: 'spots', name: 'Spots', key: '2', fade: 1.2, energy: 0.4,
    // straight up, dead still (no motion field = static)
    states: {
      spotL: { dim: 0.75, color: 0, tilt: 0.12, pan: 0.48, shutter: 1 },
      spotR: { dim: 0.75, color: 0, tilt: 0.12, pan: 0.52, shutter: 1 },
    },
  },
  {
    id: 'shockers', name: 'Shockers', key: '3', fade: 1.2, energy: 0.2,
    states: {
      shockerL: { dim: 0.7, r: 1, g: 0.6, b: 0.3 },
      shockerR: { dim: 0.7, r: 1, g: 0.6, b: 0.3 },
    },
  },

  // --- 4-7 ramp: whole rig, growing brightness + movement (no strobe) ---
  {
    id: 'rise', name: 'Rise', key: '4', fade: 1.5, energy: 0.3,
    // slow, tight orbit near vertical (~±30°)
    motion: { kind: 'orbit', speed: 0.25, pan: 0.05, tilt: 0.06 },
    states: {
      halo: { dim: 0.5, cct: 0.15 },
      spotL: { dim: 0.42, color: 1, tilt: 0.4, pan: 0.45, shutter: 1 },
      spotR: { dim: 0.42, color: 1, tilt: 0.4, pan: 0.55, shutter: 1 },
      shockerL: { dim: 0.35, r: 1, g: 0.6, b: 0.3 },
      shockerR: { dim: 0.35, r: 1, g: 0.6, b: 0.3 },
    },
  },
  {
    id: 'surge', name: 'Surge', key: '5', fade: 1.2, energy: 0.48,
    // slow, but pan sweeps while tilt bobs at 2× — alternating pan/tilt feel
    motion: { kind: 'sway', speed: 0.25, pan: 0.06, tilt: 0.06 },
    states: {
      halo: { dim: 0.68, cct: 0.3 },
      spotL: { dim: 0.62, color: 8, tilt: 0.4, pan: 0.4, shutter: 1 },
      spotR: { dim: 0.62, color: 8, tilt: 0.4, pan: 0.6, shutter: 1 },
      shockerL: { dim: 0.52, r: 0.4, g: 0.5, b: 1 },
      shockerR: { dim: 0.52, r: 0.4, g: 0.5, b: 1 },
    },
  },
  {
    id: 'drive', name: 'Drive', key: '6', fade: 0.8, energy: 0.64,
    // medium-speed orbit, a touch wider
    motion: { kind: 'orbit', speed: 0.5, pan: 0.08, tilt: 0.07 },
    states: {
      halo: { dim: 0.82, cct: 0.45 },
      spotL: { dim: 0.85, color: 8, tilt: 0.44, pan: 0.32, shutter: 1 },
      spotR: { dim: 0.85, color: 8, tilt: 0.44, pan: 0.68, shutter: 1 },
      shockerL: { dim: 0.7, r: 0.3, g: 0.4, b: 1 },
      shockerR: { dim: 0.7, r: 0.3, g: 0.4, b: 1 },
    },
  },
  {
    id: 'pulse', name: 'Pulse', key: '7', fade: 0.3, energy: 0.78,
    // top of the ramp: rest look blasts to `hit` every bar then decays back —
    // rhythmic intensity WITHOUT strobe (strobe is reserved for 8/9/0).
    motion: { kind: 'orbit', speed: 1, pan: 0.09, tilt: 0.07 },
    states: {
      halo: { dim: 0.3, cct: 0.1 },
      spotL: { dim: 0.22, color: 0, tilt: 0.5, pan: 0.42, shutter: 1 },
      spotR: { dim: 0.22, color: 0, tilt: 0.5, pan: 0.58, shutter: 1 },
      shockerL: { dim: 0.14, r: 1, g: 0.6, b: 0.3 },
      shockerR: { dim: 0.14, r: 1, g: 0.6, b: 0.3 },
    },
    pulse: {
      cycleBeats: 4,
      hit: {
        halo: { dim: 1, cct: 0.4 },
        spotL: { dim: 1 },
        spotR: { dim: 1 },
        shockerL: { dim: 1, r: 1, g: 1, b: 1 },
        shockerR: { dim: 1, r: 1, g: 1, b: 1 },
      },
    },
  },

  // --- 8-0 max: full-throttle, the only scenes that strobe ---
  {
    id: 'peak', name: 'Peak', key: '8', fade: 0.3, energy: 0.9, strobe: 1,
    // fast, wide orbit — one loop per bar
    motion: { kind: 'orbit', speed: 1, pan: 0.14, tilt: 0.09 },
    states: {
      halo: { dim: 1, cct: 0.2 },
      spotL: { dim: 1, color: 1, tilt: 0.42, pan: 0.22, shutter: 1 },
      spotR: { dim: 1, color: 1, tilt: 0.42, pan: 0.78, shutter: 1 },
      shockerL: { dim: 0.95, r: 1, g: 0.5, b: 0.2 },
      shockerR: { dim: 0.95, r: 1, g: 0.5, b: 0.2 },
    },
  },
  {
    id: 'blinder', name: 'Blinder', key: '9', fade: 0.05, energy: 1, strobe: 2,
    states: {
      halo: { dim: 1, cct: 0.5 },
      spotL: { dim: 1, color: 0, tilt: 0.5, pan: 0.5, shutter: 1 },
      spotR: { dim: 1, color: 0, tilt: 0.5, pan: 0.5, shutter: 1 },
      shockerL: { dim: 1, r: 1, g: 1, b: 1 },
      shockerR: { dim: 1, r: 1, g: 1, b: 1 },
    },
  },
  {
    id: 'party', name: 'Party', key: '0', fade: 0.4, energy: 0.85, strobe: 4,
    // double-time wide sway — two loops per bar
    motion: { kind: 'sway', speed: 2, pan: 0.16, tilt: 0.1 },
    states: {
      halo: { dim: 0.85, cct: 0.5 },
      spotL: { dim: 1, color: 6, tilt: 0.42, pan: 0.25, shutter: 1 },
      spotR: { dim: 1, color: 2, tilt: 0.42, pan: 0.75, shutter: 1 },
      shockerL: { dim: 0.9, r: 0.6, g: 0.2, b: 1 },
      shockerR: { dim: 0.9, r: 0.2, g: 0.5, b: 1 },
    },
  },
];

const BLACKOUT_FADE = 0.6;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
// Move `a` toward `b` by at most `maxStep` — the slew-rate clamp.
const approach = (a: number, b: number, maxStep: number) => {
  const d = b - a;
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};
const frac = (x: number) => x - Math.floor(x);

// Build a fixture's state for a pulse scene: rest look, with the params listed
// in `hit` blended toward the hit value by env (env 1 = full hit, 0 = rest).
function buildPulse(id: string, scene: Scene, env: number): FixtureState {
  const rest: FixtureState = { ...defaultsFor(id), dim: 0 };
  Object.assign(rest, scene.states[id] ?? {});
  const hit = scene.pulse!.hit[id] ?? {};
  const snap = snapKeysFor(id);
  const s: FixtureState = { ...rest };
  for (const k of Object.keys(hit)) {
    const hv = hit[k] as number;
    s[k] = snap.includes(k) ? (env > 0.5 ? hv : rest[k] ?? hv) : lerp(rest[k] ?? hv, hv, env);
  }
  return s;
}

export class SceneEngine {
  private current: Record<string, FixtureState> = {};
  private target: Record<string, FixtureState> = {};
  private fade = 1;
  private energy = 0;
  private targetEnergy = 0;
  private activeScene: Scene | null = null;
  // last slew-limited pan/tilt actually emitted, per fixture
  private emitted: Record<string, { pan: number; tilt: number }> = {};
  activeName = 'Blackout';
  activeKey: string | null = null;

  constructor() {
    for (const f of RIG) {
      this.current[f.id] = { ...defaultsFor(f.id), dim: 0 };
      this.target[f.id] = { ...this.current[f.id] };
      this.emitted[f.id] = { pan: this.current[f.id].pan ?? 0.5, tilt: this.current[f.id].tilt ?? 0.5 };
    }
  }

  setScene(scene: Scene) {
    this.fade = Math.max(scene.fade, 0.01);
    this.targetEnergy = scene.energy;
    this.activeScene = scene;
    this.activeName = scene.name;
    this.activeKey = scene.key;
    for (const f of RIG) {
      const next: FixtureState = { ...defaultsFor(f.id), dim: 0 };
      Object.assign(next, scene.states[f.id] ?? {});
      this.target[f.id] = next;
      for (const k of snapKeysFor(f.id)) if (k in next) this.current[f.id][k] = next[k];
    }
  }

  blackout() {
    this.fade = BLACKOUT_FADE;
    this.targetEnergy = 0;
    this.activeScene = null;
    this.activeName = 'Blackout';
    this.activeKey = null;
    for (const f of RIG) {
      this.target[f.id] = { ...this.target[f.id], dim: 0 };
      if (snapKeysFor(f.id).includes('shutter')) this.current[f.id].shutter = 0;
    }
  }

  // Ease the base look, then overlay beat-synced motion scaled by energy.
  tick(dt: number, beats: number): Record<string, FixtureState> {
    const t = Math.min(1, dt / this.fade);
    this.energy += (this.targetEnergy - this.energy) * t;

    for (const f of RIG) {
      const cur = this.current[f.id];
      const tgt = this.target[f.id];
      const snap = snapKeysFor(f.id);
      for (const k of Object.keys(tgt)) {
        if (snap.includes(k)) cur[k] = tgt[k];
        else cur[k] = lerp(cur[k] ?? tgt[k], tgt[k], t);
      }
    }

    const scene = this.activeScene;
    const pulseEnv = scene?.pulse ? Math.pow(1 - frac(beats / scene.pulse.cycleBeats), 1.8) : null;
    // Per-scene movement rides the bpm-locked beat clock (TapTempo, 120 fallback),
    // so motion.speed is a musical multiple of tempo — speed = cycles per bar, i.e.
    // 0.5 half-time, 1 per-bar, 2 double-time. Phase here is in bars.
    const motion = scene?.motion;
    const mAng = motion ? (beats / CYCLE_BEATS) * motion.speed * Math.PI * 2 : 0;
    // Strobe is a per-scene property — ONLY the max scenes (8/9/0) strobe; the
    // ramp scenes grow by brightness + movement and never strobe.
    const strobeRate = scene && !scene.pulse ? scene.strobe ?? 0 : 0; // cycles/beat (0 = off)
    const strobing = strobeRate > 0;
    // 16-bar variation: flip the orbit direction so a long hold re-shapes itself
    // (slew eases the flip). Washes breathe slowly across the cycle.
    const vseg = Math.floor(beats / VARY_BEATS);
    const vDir = vseg % 2 === 0 ? 1 : -1; // reverse orbit each 16 bars
    const breathe = 0.96 + 0.04 * Math.sin((beats / VARY_BEATS) * Math.PI * 2);
    const out: Record<string, FixtureState> = {};
    for (const f of RIG) {
      const s: FixtureState = pulseEnv != null && scene ? buildPulse(f.id, scene, pulseEnv) : { ...this.current[f.id] };
      if (f.kind === 'spot160') {
        const side = (f.pos.x < 0.5 ? 1 : -1) * vDir; // L/R mirror, flips each 16 bars
        let wantPan = s.pan ?? 0.5;
        let wantTilt = s.tilt ?? 0.5;
        if (motion && motion.kind !== 'none') {
          wantPan = clamp01(wantPan + Math.sin(mAng) * side * motion.pan);
          // orbit = tilt on cosine (traces a circle); sway = tilt bobs at 2× the pan
          const tiltWave = motion.kind === 'orbit' ? Math.cos(mAng) : Math.sin(mAng * 2 + (motion.phase ?? 0));
          wantTilt = clamp01(wantTilt + tiltWave * motion.tilt);
        }
        // slew-limit to the head's real mechanical speed (also eases static holds)
        const prev = this.emitted[f.id];
        s.pan = approach(prev.pan, wantPan, PAN_SLEW * dt);
        s.tilt = approach(prev.tilt, wantTilt, TILT_SLEW * dt);
        prev.pan = s.pan;
        prev.tilt = s.tilt;
        // spots strobe at the scene's speed, offset 0.5 beat from the shockers
        // so they interleave.
        if (strobing && (s.dim ?? 0) > 0.01) {
          const gate = (beats * strobeRate + 0.5) % 1 < 0.5 ? 1 : 0;
          s.dim = (s.dim ?? 0) * gate;
        }
      } else if (f.kind === 'shockerPanel' && strobing && (s.dim ?? 0) > 0.01) {
        const gate = (beats * strobeRate) % 1 < 0.5 ? 1 : 0;
        s.dim = (s.dim ?? 0) * gate;
      } else if ((f.kind === 'halo100x' || f.kind === 'shockerPanel') && (s.dim ?? 0) > 0.01) {
        s.dim = (s.dim ?? 0) * breathe; // slow 16-bar wash breathing (non-strobing)
      }
      out[f.id] = s;
    }
    return out;
  }
}

export const SCENE_BY_KEY: Record<string, Scene> = Object.fromEntries(SCENES.map((s) => [s.key, s]));
