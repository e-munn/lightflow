export interface FrequencyData {
  // Raw frequency data from analyser
  raw: Uint8Array<ArrayBuffer>;
  // Grouped into bands (sub-bass, bass, low-mid, mid, high-mid, high)
  bands: FrequencyBands;
  // Overall energy level (0-1)
  energy: number;
}

export interface FrequencyBands {
  subBass: number;   // 20-60 Hz
  bass: number;      // 60-250 Hz
  lowMid: number;    // 250-500 Hz
  mid: number;       // 500-2000 Hz
  highMid: number;   // 2000-4000 Hz
  high: number;      // 4000-20000 Hz
}

export interface BeatInfo {
  isBeat: boolean;
  bpm: number | null;
  confidence: number;
  lastBeatTime: number;
  timeSinceLastBeat: number;
}

export interface AudioState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  source: 'file' | 'microphone' | null;
}

export interface LightFixture {
  id: number;
  type: 'par' | 'strip' | 'spot';
  color: { r: number; g: number; b: number };
  intensity: number;
  position: { x: number; y: number };
}

export interface LightScene {
  fixtures: LightFixture[];
  timestamp: number;
}
