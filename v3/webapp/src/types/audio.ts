export interface FrequencyData {
  raw: Uint8Array<ArrayBuffer>;
  bands: FrequencyBands;
  energy: number;
}

export interface FrequencyBands {
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  high: number;
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
