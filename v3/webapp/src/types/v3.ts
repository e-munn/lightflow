// Grid constants
export const NUM_TUBES = 8;
export const PIXELS_PER_TUBE = 16;

export interface StemEnergies {
  bass: number;
  kick: number;
  snare: number;
  hat: number;
  vocals: number;
  other: number;
}

export interface StemOnsets {
  kick: number;
  snare: number;
  hat: number;
}

export interface StemPans {
  bass: number;
  vocals: number;
  other: number;
}

export interface StemBrightness {
  vocals: number;
  other: number;
}

export interface StemFrame {
  time: number;
  stems: StemEnergies;
  centroid: number;
  onsets: StemOnsets;
  pans: StemPans;
  brightness: StemBrightness;
  spectral_flux: number;
}

export interface Section {
  start: number;
  end: number;
  label: string; // "intro" | "verse" | "buildup" | "drop" | "breakdown" | "outro"
  energy_level: number;
  bass_presence: number;
  has_vocals: boolean;
}

export interface RhythmicPattern {
  four_on_floor: boolean;
  backbeat: boolean;
  hat_rate: string;
  syncopation_level: number;
  pattern_confidence: number;
}

export interface AnalysisResult {
  song: string;
  source_file: string;
  duration: number;
  bpm: number;
  bpm_confidence: number;
  fps: number;
  sections: Section[];
  patterns: RhythmicPattern;
  frames: StemFrame[];
}

export type BlendMode = 'max' | 'add' | 'replace';

export interface Region {
  preset?: string | null;
  tubes?: number[] | null;
  pixel_range?: [number, number] | null;
}

export interface Color {
  r: number;
  g: number;
  b: number;
}

export interface EffectInstance {
  effect: string;
  color: Color;
  secondary_color?: Color | null;
  intensity_source: string;
  region: Region;
  speed: number;
  direction: string;
  blend_mode: BlendMode;
  intensity: number;
  attack_ms: number;
  release_ms: number;
  attack_beats?: number | null;
  release_beats?: number | null;
  pan_follow: boolean;
  onset_mode: boolean;
}

export type TransitionType = 'crossfade' | 'hard_cut';

export interface SectionPlan {
  section_label: string;
  start: number;
  end: number;
  effects: EffectInstance[];
  transition_in: TransitionType;
  transition_duration: number;
}

export interface ShowPlan {
  song: string;
  bpm: number;
  style: string;
  sections: SectionPlan[];
}

// Runtime types
export interface Attention {
  weights: Record<string, number>;
  dominant: string;
  novelty: Record<string, number>;
  signal: number;
  holdBeats: number;
  beatsHeld: number;
  overallEnergy: number;
  scores: Record<string, number>;       // raw scores used for switching
  avgEnergy: Record<string, number>;    // smoothed per-stem energy
}

export interface EffectContext {
  frame: StemFrame;
  time: number;
  bpm: number;
  dt: number;
  beatPhase: number;
  barPhase: number;
  soloStem?: string | null;
  attention?: Attention;
}

// 16x8x3 grid as flat Float32Array (row-major: [px][tube][channel])
export type Grid = Float32Array;

export function createGrid(): Grid {
  return new Float32Array(NUM_TUBES * PIXELS_PER_TUBE * 3);
}

export function getPixel(grid: Grid, px: number, tube: number): [number, number, number] {
  const i = (px * NUM_TUBES + tube) * 3;
  return [grid[i], grid[i + 1], grid[i + 2]];
}

export function setPixel(grid: Grid, px: number, tube: number, r: number, g: number, b: number): void {
  const i = (px * NUM_TUBES + tube) * 3;
  grid[i] = r;
  grid[i + 1] = g;
  grid[i + 2] = b;
}

export function maxPixel(grid: Grid, px: number, tube: number, r: number, g: number, b: number): void {
  const i = (px * NUM_TUBES + tube) * 3;
  grid[i] = Math.max(grid[i], r);
  grid[i + 1] = Math.max(grid[i + 1], g);
  grid[i + 2] = Math.max(grid[i + 2], b);
}
