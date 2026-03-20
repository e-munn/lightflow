import { NodeProps } from 'reactflow';

// ============ NODE DIMENSIONS ============
export const NODE_WIDTH = 200;
export const NODE_HEIGHT_SM = 80;
export const NODE_HEIGHT_MD = 120;
export const NODE_HEIGHT_LG = 200;

// ============ STEM TYPES ============
export interface StemValues {
  bass: number;
  drums: number;
  vocals: number;
  other: number;
}

export interface StemTimeSeries {
  bass?: { time: number; value: number }[];
  drums?: { time: number; value: number }[];
  vocals?: { time: number; value: number }[];
  other?: { time: number; value: number }[];
}

export const STEM_CONFIG = [
  { key: 'bass' as const, label: 'Bass', color: '#67e8f9' },   // cyan-300
  { key: 'drums' as const, label: 'Drums', color: '#22d3ee' }, // cyan-400
  { key: 'vocals' as const, label: 'Vocals', color: '#06b6d4' }, // cyan-500
  { key: 'other' as const, label: 'Other', color: '#0891b2' },  // cyan-600
];

export const CHANNEL_COLORS = ['#67e8f9', '#22d3ee', '#06b6d4', '#0891b2'];

// ============ NODE DATA TYPES ============
export interface AudioFileData {
  fileName: string | null;
  duration: number | null;
  isLoading: boolean;
  onFileSelect: (file: File) => void;
}

export interface StemAnalyzerData {
  status: 'idle' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  statusText?: string;
  stems: StemValues | null;
  stemTimeSeries?: StemTimeSeries | null;
  onRerun?: () => void;
}

export interface SmootherData {
  inputValue: number;
  outputValue: number;
  attackMs: number;
  releaseMs: number;
  color: string;
  bpm?: number;  // Optional BPM input for beat-synced timing
  bpmFactor?: number;  // Multiplier: attack = beatMs / bpmFactor (default 16)
  onBpmFactorChange?: (factor: number) => void;
}

export interface MeterData {
  label: string;
  value: number;
  color: string;
}

export interface LightData {
  label: string;
  value: number;
  color: string;
}

export interface MixerData {
  bassWeight: number;
  drumsWeight: number;
  vocalsWeight: number;
  otherWeight: number;
  attackMs: number;
  releaseMs: number;
  inputValues: StemValues | null;
  outputValue: number;
}

export interface MultiViewData {
  channelCount: number;
  values: number[];
  colors: string[];
  onChannelCountChange?: (count: number) => void;
}

export interface SongMetadataData {
  status: 'idle' | 'detecting' | 'complete' | 'error';
  detectedBpm: number | null;
  manualBpm?: number; // User override
  title?: string;
  artist?: string;
  key?: string;
  statusText?: string;
  onRerun?: () => void;
}

// ============ DRUM ANALYZER TYPES ============
export interface DrumValues {
  kick: number;
  snare: number;
  hats: number;
}

export interface DrumTimeSeries {
  kick?: { time: number; value: number }[];
  snare?: { time: number; value: number }[];
  hats?: { time: number; value: number }[];
}

export const DRUM_CONFIG = [
  { key: 'kick' as const, label: 'Kick', color: '#67e8f9' },   // cyan-300
  { key: 'snare' as const, label: 'Snare', color: '#22d3ee' }, // cyan-400
  { key: 'hats' as const, label: 'Hats', color: '#06b6d4' },   // cyan-500
];

export interface DrumAnalyzerData {
  status: 'idle' | 'analyzing' | 'complete' | 'error';
  progress: number;
  statusText?: string;
  drums: DrumValues | null;
  drumTimeSeries?: DrumTimeSeries | null;
  onRerun?: () => void;
}

// ============ ISOLATE NODE ============
export type StemType = 'bass' | 'drums' | 'vocals' | 'other' | 'no_vocals';

export interface PlaybackData {
  stemType: StemType | string | null;  // Which stem is connected
  stemUrl: string | null;     // URL to the stem audio file
  isActive: boolean;          // Is this isolate currently active (soloed)
  inputValue: number;         // Current amplitude from connected stem
  onToggle?: () => void;      // Toggle isolate on/off
  statusText?: string;        // Optional status message (e.g., "Drum bands have no audio")
}

// ============ HUE LIGHT NODE ============
export interface HueLight {
  id: number;
  name: string;
  on: boolean;
  brightness: number;
  reachable: boolean;
  type: string;
}

export interface HueData {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  bridgeIp: string | null;
  bridgeName: string | null;
  selectedLightId: number | null;
  selectedLightName: string | null;
  lights: HueLight[];
  inputValue: number;
  statusText?: string;
  onConnect?: () => void;
  onSelectLight?: (lightId: number) => void;
  onDiscover?: () => void;
  onTest?: () => void;  // Toggle light on/off for testing
}

// ============ GATE/PULSE NODE ============
// Converts continuous signal to clean on/off pulses with smooth envelopes
export interface GateData {
  inputValue: number;           // Raw input signal (0-1)
  outputValue: number;          // Gated output with envelope (0-1)
  threshold: number;            // Current threshold (0-1)
  isOpen: boolean;              // Is gate currently open (triggered)

  // Envelope settings
  attackMs: number;             // Rise time when gate opens (20-100ms typical)
  releaseMs: number;            // Fall time when gate closes (100-400ms typical)

  // Anti-strobe settings
  minHoldMs: number;            // Minimum time gate stays open (50-150ms)
  retriggerMs: number;          // Minimum time between triggers (30-100ms)

  // Threshold detection
  sensitivity: number;          // 0-1, lower = harder to trigger
  autoThreshold: boolean;       // Auto-detect threshold from signal

  // Optional BPM sync
  bpm?: number;                 // If connected, sync timing to beats

  // Callbacks
  onSensitivityChange?: (value: number) => void;
  onAutoThresholdChange?: (enabled: boolean) => void;
}

// ============ SHOW GENERATOR NODE ============
export interface ShowGeneratorData {
  status: 'idle' | 'analyzing' | 'generating' | 'complete' | 'error';
  statusText?: string;
  showName?: string;
  sectionCount?: number;
  analysisData?: {
    bpm: number;
    duration: number;
    patterns: {
      four_on_floor: boolean;
      backbeat: boolean;
      hat_rate: string;
    };
    sectionLabels: string[];
  };
  onGenerate?: (style: string) => void;
  onApply?: () => void;
}

// Re-export NodeProps for convenience
export type { NodeProps };
