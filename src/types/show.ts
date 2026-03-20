export type Source =
  | 'bass'
  | 'drums'
  | 'vocals'
  | 'intensity'
  | 'section';

export type SpatialHint =
  | 'center'
  | 'all'
  | 'stereo'
  | 'edges'
  | 'random';

export type ResponseCurve =
  | 'pulse'
  | 'flash'
  | 'smooth'
  | 'inverse';

export type BlendMode = 'add' | 'max' | 'multiply';

export interface ColorRule {
  base: [number, number, number]; // RGB 0-1
  reactive?: [number, number, number]; // shifts toward this color at high energy
}

export interface Layer {
  name: string;
  source: Source;
  priority: number; // lower = more important
  spatial: SpatialHint;
  response: ResponseCurve;
  color: ColorRule;
}

export interface LightShow {
  name: string;
  description: string;
  layers: Layer[];
  blendMode: BlendMode;
}

// What the engine outputs per light per frame
export interface LightOutput {
  color: [number, number, number]; // RGB 0-1
  intensity: number; // 0-1
}

// Audio state the engine needs each frame
export interface AudioFrame {
  bands: {
    subBass: number;
    bass: number;
    lowMid: number;
    mid: number;
    highMid: number;
    high: number;
  };
  energy: number;
  isBeat: boolean;
  timeSinceLastBeat: number;
  bpm: number | null;
}

// A light's position in the rig (0-1 normalized)
export interface LightPosition {
  index: number;
  normalized: number; // 0 = leftmost, 1 = rightmost
  total: number;
}
