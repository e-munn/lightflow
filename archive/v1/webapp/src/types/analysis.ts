export interface TimeSeriesPoint {
  time: number;
  value: number;
}

// Alias for backwards compatibility
export type EnergyPoint = TimeSeriesPoint;

export interface Segment {
  start: number;   // Start time in seconds
  end: number;     // End time in seconds
  label: number;   // Section label (0, 1, 2, ...)
}

export interface AudioAnalysis {
  success: boolean;
  duration: number;
  bpm: number;
  beats: number[];              // Beat times in seconds
  energy: TimeSeriesPoint[];    // Energy envelope over time
  intensity?: TimeSeriesPoint[]; // Smoothed intensity (0-1)
  buildup?: TimeSeriesPoint[];   // Energy trend/buildup (0-1, 0.5 = neutral)
  complexity?: TimeSeriesPoint[]; // Spectral complexity (0-1)
  segments?: Segment[];          // Song sections
}
