// Fixture profiles, the rig, and universe composition.
//
// SINGLE SOURCE OF TRUTH: scene state -> normalized fixture state -> DMX channel
// values written into one universe buffer. That same buffer feeds BOTH the
// on-screen playground (stageRender.ts) and the Enttec bridge (dmxClient.ts).
// What you see on screen is, by construction, the data the lights receive.
//
// Everything physical (pan center, invert, ranges, dimmer curve) lives in each
// instance's `cal` block — never baked into logic — so the day-we-plug-in-real-
// lights step is "tune a few constants", not "rewrite code".

export const UNIVERSE_SIZE = 128;

export type FixtureKind = 'halo100x' | 'spot160' | 'titanTube' | 'shockerPanel';

// All fixture params are normalized numbers so the scene engine can lerp/snap
// generically. Meaning per key:
//   dim      0..1  master brightness
//   cct      0..1  warm->cool (halo)
//   gm       0..1  green/magenta (halo, 0.5 = neutral)
//   r,g,b    0..1  colour (tube / panel)
//   pan,tilt 0..1  position (0.5 = centre, pre-calibration)
//   color    index into the fixture's colour wheel (spot)
//   gobo     0..1  raw gobo-wheel value (spot; 0 = open)
//   ptSpeed  0..1  pan/tilt speed (0 = fastest)
//   shutter  0/1   closed / open (movers)
//   strobeHz 0..~  0 = no strobe
export type FixtureState = Record<string, number>;

export interface Calibration {
  panInvert?: boolean;
  tiltInvert?: boolean;
  panCenter?: number; // 0..1 value that points "centre/front" (default 0.5)
  panScale?: number; // fraction of full pan range to use (default 1)
  tiltCenter?: number;
  tiltScale?: number;
  dimGamma?: number; // dimmer curve (default 1 = linear)
}

export interface FixtureInstance {
  id: string;
  kind: FixtureKind;
  label: string;
  addr: number; // 1-based DMX start address
  cal: Calibration;
  pos: { x: number; y: number }; // 0..1 layout position in the playground
  active?: boolean; // false = owned/planned but not physically present yet
}

// What the playground draws. Decoded from post-fade fixture state.
export interface Visual {
  shape: 'wash' | 'mover' | 'tube';
  rgb: [number, number, number]; // 0..255 display colour (un-dimmed)
  intensity: number; // 0..1
  pan?: number; // -1..1 (mover beam horizontal)
  tilt?: number; // -1..1 (mover beam vertical)
  pixels?: [number, number, number][]; // tube
}

interface Profile {
  channels: number;
  defaults: FixtureState;
  snapKeys: string[]; // params that jump (not lerped) on a scene change
  encode: (s: FixtureState, cal: Calibration) => number[]; // length === channels, 0..255
  decode: (s: FixtureState) => Visual;
  applyColor?: (s: FixtureState, ov: ColorOverride) => void; // colour-override hook (colour-capable fixtures only)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const clamp255 = (v: number) => clamp(Math.round(v), 0, 255);
const u01 = (v: number) => clamp(v, 0, 1);

// Warm (~2700K) -> cool (~6500K) white as a display colour.
function cctToRGB(cct: number): [number, number, number] {
  const t = u01(cct);
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
  return [lerp(255, 196), lerp(168, 214), lerp(94, 255)];
}

// Spot 160 colour wheel — DMX centre value + a display colour for each slot.
// Values from the Chauvet Intimidator Spot 160 manual (11CH).
export const SPOT_COLORS: { name: string; dmx: number; rgb: [number, number, number] }[] = [
  { name: 'white', dmx: 3, rgb: [255, 255, 255] },
  { name: 'orange', dmx: 10, rgb: [255, 140, 0] },
  { name: 'lime', dmx: 17, rgb: [170, 255, 40] },
  { name: 'cyan', dmx: 24, rgb: [0, 200, 255] },
  { name: 'red', dmx: 31, rgb: [255, 30, 30] },
  { name: 'green', dmx: 38, rgb: [30, 220, 60] },
  { name: 'magenta', dmx: 45, rgb: [255, 40, 200] },
  { name: 'yellow', dmx: 52, rgb: [255, 225, 0] },
  { name: 'blue', dmx: 59, rgb: [30, 60, 220] },
];

export interface ColorOverride {
  name: string;
  rgb: [number, number, number]; // 0..1 — for RGB fixtures (tube / panel)
  spotIndex: number; // index into SPOT_COLORS — for colour-wheel fixtures (spot)
}

const spotIdx = (name: string) => Math.max(0, SPOT_COLORS.findIndex((c) => c.name === name));

// Live colour-override keys (R/G/B/Y/O). Pressing one recolours ONLY colour-
// capable fixtures; dim, position, movement, scene and tempo are untouched.
export const COLOR_KEYS: Record<string, ColorOverride> = {
  r: { name: 'Red', rgb: [1, 0, 0], spotIndex: spotIdx('red') },
  g: { name: 'Green', rgb: [0, 1, 0.1], spotIndex: spotIdx('green') },
  b: { name: 'Blue', rgb: [0, 0.25, 1], spotIndex: spotIdx('blue') },
  y: { name: 'Yellow', rgb: [1, 0.9, 0], spotIndex: spotIdx('yellow') },
  o: { name: 'Orange', rgb: [1, 0.45, 0], spotIndex: spotIdx('orange') },
  w: { name: 'White', rgb: [1, 1, 1], spotIndex: spotIdx('white') },
};

// The rig's resting colour — a warm amber it always returns to. This is the
// default override (not "scene's own colours"): live colour keys are momentary
// departures, and clearing / re-pressing the active colour comes home to amber.
export const AMBER: ColorOverride = { name: 'Amber', rgb: [1, 0.55, 0.12], spotIndex: spotIdx('orange') };

// 16-bit value split across coarse + fine channels, after applying calibration.
function pos16(value01: number, center = 0.5, scale = 1, invert = false): [number, number] {
  let p = center + (value01 - 0.5) * scale;
  if (invert) p = 1 - p;
  const v = Math.round(clamp(p, 0, 1) * 65535);
  return [(v >> 8) & 0xff, v & 0xff];
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

const haloProfile: Profile = {
  channels: 3,
  defaults: { dim: 0, cct: 0.15, gm: 0.5 },
  snapKeys: [],
  encode: (s, cal) => {
    const dim = Math.pow(u01(s.dim), cal.dimGamma ?? 1);
    return [clamp255(dim * 255), clamp255(u01(s.cct) * 255), clamp255(u01(s.gm) * 255)];
  },
  decode: (s) => ({ shape: 'wash', rgb: cctToRGB(s.cct), intensity: u01(s.dim) }),
};

// Chauvet Intimidator Spot 160 — 11CH:
// 1 Pan, 2 PanFine, 3 Tilt, 4 TiltFine, 5 Pan/TiltSpeed, 6 Colour, 7 Gobo,
// 8 Dimmer, 9 Shutter/Strobe, 10 Control, 11 Macro
const spot160Profile: Profile = {
  channels: 11,
  defaults: { dim: 0, pan: 0.5, tilt: 0.5, color: 0, gobo: 0, ptSpeed: 0, shutter: 1, strobeHz: 0 },
  snapKeys: ['color', 'gobo', 'shutter'],
  encode: (s, cal) => {
    const [panC, panF] = pos16(u01(s.pan), cal.panCenter, cal.panScale ?? 1, cal.panInvert);
    const [tiltC, tiltF] = pos16(u01(s.tilt), cal.tiltCenter, cal.tiltScale ?? 1, cal.tiltInvert);
    const colorDmx = SPOT_COLORS[clamp(Math.round(s.color), 0, SPOT_COLORS.length - 1)].dmx;
    const dim = Math.pow(u01(s.dim), cal.dimGamma ?? 1);
    // Shutter: 4-7 open, 8-76 strobe slow->fast, 0-3 closed.
    let shutter = 0;
    if (s.strobeHz > 0) shutter = Math.round(8 + clamp(s.strobeHz / 20, 0, 1) * (76 - 8));
    else if (s.shutter >= 0.5) shutter = 5;
    return [
      panC, panF, tiltC, tiltF,
      clamp255(u01(s.ptSpeed) * 255),
      colorDmx,
      clamp255(u01(s.gobo) * 255),
      clamp255(dim * 255),
      shutter,
      0, // control
      0, // macro
    ];
  },
  decode: (s) => {
    const col = SPOT_COLORS[clamp(Math.round(s.color), 0, SPOT_COLORS.length - 1)].rgb;
    const lit = s.shutter >= 0.5 || s.strobeHz > 0 ? u01(s.dim) : 0;
    return { shape: 'mover', rgb: col, intensity: lit, pan: u01(s.pan) * 2 - 1, tilt: u01(s.tilt) * 2 - 1 };
  },
  applyColor: (s, ov) => {
    s.color = ov.spotIndex;
  },
};

// STUB — Astera Titan Tube (not yet owned). Placeholder 4CH RGB+dimmer so the
// playground and scenes can target it now. Replace channels/encode with the
// real AX1 chart + chosen pixel mode when purchased. See project_live_branch.
const titanTubeProfile: Profile = {
  channels: 4,
  defaults: { dim: 0, r: 0.6, g: 0.3, b: 0.9 },
  snapKeys: [],
  encode: (s, cal) => {
    const dim = Math.pow(u01(s.dim), cal.dimGamma ?? 1);
    return [clamp255(dim * 255), clamp255(u01(s.r) * 255), clamp255(u01(s.g) * 255), clamp255(u01(s.b) * 255)];
  },
  decode: (s) => {
    const rgb: [number, number, number] = [u01(s.r) * 255, u01(s.g) * 255, u01(s.b) * 255];
    return { shape: 'tube', rgb, intensity: u01(s.dim), pixels: Array.from({ length: 12 }, () => rgb) };
  },
  applyColor: (s, ov) => {
    s.r = ov.rgb[0];
    s.g = ov.rgb[1];
    s.b = ov.rgb[2];
  },
};

// Chauvet DJ Shocker Panel FX — 8CH mode:
// 1 Master Dimmer · 2 RGB Strobe Rate · 3 Red · 4 Green · 5 Blue · 6 White
// 7 RGBW Program (MUST be 0 for DMX control) · 8 Program Speed.
const shockerPanelProfile: Profile = {
  channels: 8,
  defaults: { dim: 0, r: 1, g: 0.7, b: 0.4, white: 0, strobeHz: 0 },
  snapKeys: [],
  encode: (s, cal) => {
    const dim = Math.pow(u01(s.dim), cal.dimGamma ?? 1);
    // ch2: 0 = steady, higher = faster strobe
    const strobe = s.strobeHz > 0 ? clamp255(20 + clamp(s.strobeHz / 20, 0, 1) * (255 - 20)) : 0;
    return [
      clamp255(dim * 255), // 1 master dimmer
      strobe, // 2 RGB strobe rate
      clamp255(u01(s.r) * 255), // 3 red
      clamp255(u01(s.g) * 255), // 4 green
      clamp255(u01(s.b) * 255), // 5 blue
      clamp255(u01(s.white ?? 0) * 255), // 6 white blinder
      0, // 7 RGBW program — keep 0 = DMX control (else it ignores colour)
      0, // 8 program speed
    ];
  },
  decode: (s) => ({ shape: 'wash', rgb: [u01(s.r) * 255, u01(s.g) * 255, u01(s.b) * 255], intensity: u01(s.dim) }),
  applyColor: (s, ov) => {
    s.r = ov.rgb[0];
    s.g = ov.rgb[1];
    s.b = ov.rgb[2];
  },
};

export const PROFILES: Record<FixtureKind, Profile> = {
  halo100x: haloProfile,
  spot160: spot160Profile,
  titanTube: titanTubeProfile,
  shockerPanel: shockerPanelProfile,
};

// ---------------------------------------------------------------------------
// the rig — physical addressing + playground layout
// ---------------------------------------------------------------------------
//
// Chain order is independent of address order. Addresses (set in each fixture's
// menu): Halo @1 (3ch), Spot #1 @4 (11ch), Spot #2 @15 (11ch), Shocker L @26
// (stub), Shocker R @31 (stub), Tube @40 (stub, not owned). Each Spot 160 must
// be set to 11CH mode. Shocker addresses are provisional until the real chart
// is confirmed (the stub is 5ch — real footprint will shift @31/@40).
export const RIG: FixtureInstance[] = [
  { id: 'halo', kind: 'halo100x', label: 'Amaran Halo', addr: 1, cal: {}, pos: { x: 0.5, y: 0.3 }, active: false }, // not at this event — shockers cover the warm wash
  { id: 'spotL', kind: 'spot160', label: 'Spot 160 · L', addr: 17, cal: { tiltCenter: 0.55 }, pos: { x: 0.2, y: 0.16 }, active: true }, // 11CH → 17-27
  { id: 'spotR', kind: 'spot160', label: 'Spot 160 · R', addr: 28, cal: { tiltCenter: 0.55 }, pos: { x: 0.8, y: 0.16 }, active: true }, // 11CH → 28-38
  { id: 'shockerL', kind: 'shockerPanel', label: 'Shocker · L', addr: 1, cal: {}, pos: { x: 0, y: 0.5 }, active: true }, // 8CH → 1-8
  { id: 'shockerR', kind: 'shockerPanel', label: 'Shocker · R', addr: 9, cal: {}, pos: { x: 1, y: 0.5 }, active: true }, // 8CH → 9-16
  { id: 'tube', kind: 'titanTube', label: 'Titan Tube (stub)', addr: 40, cal: {}, pos: { x: 0.5, y: 0.85 }, active: false },
];

export function defaultsFor(id: string): FixtureState {
  const f = RIG.find((x) => x.id === id);
  return f ? { ...PROFILES[f.kind].defaults } : {};
}

// Compose the full DMX universe from per-fixture states.
export function composeUniverse(states: Record<string, FixtureState>): Uint8Array {
  const u = new Uint8Array(UNIVERSE_SIZE);
  for (const f of RIG) {
    if (f.active === false) continue; // fixture not present (e.g. Halo this event)
    const prof = PROFILES[f.kind];
    const st = { ...prof.defaults, ...states[f.id] };
    const bytes = prof.encode(st, f.cal);
    for (let i = 0; i < bytes.length; i++) {
      const a = f.addr - 1 + i;
      if (a >= 0 && a < u.length) u[a] = clamp255(bytes[i]);
    }
  }
  return u;
}

// Apply a colour override on top of the base states — colour channels ONLY.
// Returns a NEW map; engine state is never mutated, so clearing the override
// simply reveals the scene's own colours again. dim/pan/tilt/tempo unaffected.
export function applyColorOverride(
  states: Record<string, FixtureState>,
  ov: ColorOverride | null,
): Record<string, FixtureState> {
  if (!ov) return states;
  const out: Record<string, FixtureState> = {};
  for (const f of RIG) {
    const prof = PROFILES[f.kind];
    const base = states[f.id];
    if (prof.applyColor) {
      const cloned = { ...base };
      prof.applyColor(cloned, ov);
      out[f.id] = cloned;
    } else {
      out[f.id] = base; // not colour-capable (e.g. Halo CCT) — passes through
    }
  }
  return out;
}

export function visualFor(f: FixtureInstance, st: FixtureState): Visual {
  const prof = PROFILES[f.kind];
  return prof.decode({ ...prof.defaults, ...st });
}

export function snapKeysFor(id: string): string[] {
  const f = RIG.find((x) => x.id === id);
  return f ? PROFILES[f.kind].snapKeys : [];
}
