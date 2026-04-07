export interface VibeState {
  // Overall brightness/energy level (0-1)
  intensity: number;

  // Tension/anticipation level - rises before drops (0-1)
  buildup: number;

  // Simple vs intricate patterns - how much is happening (0-1)
  complexity: number;
}

export const DEFAULT_VIBE: VibeState = {
  intensity: 0,
  buildup: 0,
  complexity: 0,
};

export const VIBE_LABELS: Record<keyof VibeState, string> = {
  intensity: 'Intensity',
  buildup: 'Buildup',
  complexity: 'Complexity',
};

// Tailwind color values
export const VIBE_COLORS: Record<keyof VibeState, string> = {
  intensity: '#22c55e',  // green-500
  buildup: '#eab308',    // yellow-500
  complexity: '#f97316', // orange-500
};
