import { useMemo, useCallback } from 'react';
import { ShowConfig, ShowSection, LightAssignment } from '@/lib/api';

export interface ActiveShowState {
  activeSection: ShowSection | null;
  lightAssignments: Record<string, LightAssignment>;
  sectionProgress: number; // 0-1 progress through current section
  nextSection: ShowSection | null;
  timeToNextSection: number; // seconds until next section
}

export interface StemValues {
  kick: number;
  snare: number;
  hats: number;
  bass: number;
  drums: number;
  vocals: number;
  other: number;
  energy: number;
}

export interface SmoothedValue {
  current: number;
  target: number;
  attackMs: number;
  releaseMs: number;
}

/**
 * Hook for executing an LLM-generated light show configuration.
 *
 * Takes a show config and current playback time, returns the active
 * section and light assignments for that moment.
 */
export function useShowExecutor(showConfig: ShowConfig | null) {
  /**
   * Get the active show state for a given time.
   */
  const getActiveState = useCallback((currentTime: number): ActiveShowState => {
    if (!showConfig || showConfig.sections.length === 0) {
      return {
        activeSection: null,
        lightAssignments: {},
        sectionProgress: 0,
        nextSection: null,
        timeToNextSection: 0,
      };
    }

    // Find active section
    let activeSection: ShowSection | null = null;
    let nextSection: ShowSection | null = null;

    for (let i = 0; i < showConfig.sections.length; i++) {
      const section = showConfig.sections[i];
      if (currentTime >= section.start && currentTime < section.end) {
        activeSection = section;
        nextSection = showConfig.sections[i + 1] || null;
        break;
      }
    }

    // If no active section, check if we're past all sections
    if (!activeSection && showConfig.sections.length > 0) {
      const lastSection = showConfig.sections[showConfig.sections.length - 1];
      if (currentTime >= lastSection.end) {
        // Past the end, use last section
        activeSection = lastSection;
      } else {
        // Before first section, use first
        activeSection = showConfig.sections[0];
        nextSection = showConfig.sections[1] || null;
      }
    }

    const sectionProgress = activeSection
      ? (currentTime - activeSection.start) / (activeSection.end - activeSection.start)
      : 0;

    const timeToNextSection = nextSection
      ? nextSection.start - currentTime
      : 0;

    return {
      activeSection,
      lightAssignments: activeSection?.lights || {},
      sectionProgress: Math.max(0, Math.min(1, sectionProgress)),
      nextSection,
      timeToNextSection,
    };
  }, [showConfig]);

  /**
   * Calculate light brightness values based on active assignments and stem values.
   * Handles smoothing with per-light attack/release settings.
   */
  const calculateLightValues = useCallback((
    assignments: Record<string, LightAssignment>,
    stemValues: StemValues,
    smoothedState: Record<string, SmoothedValue>,
    deltaMs: number
  ): Record<string, number> => {
    const result: Record<string, number> = {};

    for (const [lightName, assignment] of Object.entries(assignments)) {
      // Get raw value from source
      let rawValue: number;
      switch (assignment.source) {
        case 'kick':
          rawValue = stemValues.kick;
          break;
        case 'snare':
          rawValue = stemValues.snare;
          break;
        case 'hats':
          rawValue = stemValues.hats;
          break;
        case 'bass':
          rawValue = stemValues.bass;
          break;
        case 'vocals':
          rawValue = stemValues.vocals;
          break;
        case 'energy':
          rawValue = stemValues.energy;
          break;
        case 'off':
        default:
          rawValue = 0;
      }

      // Apply intensity scaling
      rawValue = rawValue * assignment.intensity;

      // Get or initialize smoothed state
      const prevState = smoothedState[lightName] || {
        current: 0,
        target: 0,
        attackMs: assignment.attack_ms,
        releaseMs: assignment.release_ms,
      };

      // Apply envelope smoothing
      const target = rawValue;
      let current = prevState.current;

      if (target > current) {
        // Attack (rising)
        const attackCoef = 1 - Math.exp(-deltaMs / assignment.attack_ms);
        current = current + (target - current) * attackCoef;
      } else {
        // Release (falling)
        const releaseCoef = 1 - Math.exp(-deltaMs / assignment.release_ms);
        current = current + (target - current) * releaseCoef;
      }

      // Update smoothed state
      smoothedState[lightName] = {
        current,
        target,
        attackMs: assignment.attack_ms,
        releaseMs: assignment.release_ms,
      };

      result[lightName] = Math.max(0, Math.min(1, current));
    }

    return result;
  }, []);

  /**
   * Get section label for display
   */
  const getSectionLabel = useCallback((section: ShowSection | null): string => {
    if (!section) return 'No Section';
    return section.label.charAt(0).toUpperCase() + section.label.slice(1);
  }, []);

  return {
    getActiveState,
    calculateLightValues,
    getSectionLabel,
    showName: showConfig?.show_name || null,
    sectionCount: showConfig?.sections.length || 0,
  };
}

/**
 * Parse stem time series data to get value at a specific time.
 */
export function getStemValueAtTime(
  timeSeries: { time: number; value: number }[] | undefined,
  currentTime: number
): number {
  if (!timeSeries || timeSeries.length === 0) return 0;

  // Binary search for the closest time
  let left = 0;
  let right = timeSeries.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (timeSeries[mid].time < currentTime) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Interpolate between points
  if (left === 0) return timeSeries[0].value;
  if (left >= timeSeries.length) return timeSeries[timeSeries.length - 1].value;

  const before = timeSeries[left - 1];
  const after = timeSeries[left];
  const t = (currentTime - before.time) / (after.time - before.time);

  return before.value + (after.value - before.value) * t;
}
