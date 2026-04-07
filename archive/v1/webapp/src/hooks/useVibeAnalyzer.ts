'use client';

import { useRef, useCallback, useState } from 'react';
import { FrequencyData, BeatInfo } from '@/types/audio';
import { VibeState, DEFAULT_VIBE } from '@/types/vibe';

// Musical time intervals (will be adjusted by BPM when available)
const DEFAULT_BPM = 120;
const MS_PER_BEAT = (bpm: number) => 60000 / bpm;
const MS_PER_BAR = (bpm: number) => MS_PER_BEAT(bpm) * 4;
const MS_PER_PHRASE = (bpm: number) => MS_PER_BAR(bpm) * 4; // 4 bars

// History sizes based on musical time (at 60fps capture rate)
const FRAMES_PER_SECOND = 60;
const beatsToFrames = (beats: number, bpm: number) =>
  Math.round((MS_PER_BEAT(bpm) * beats / 1000) * FRAMES_PER_SECOND);

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor;
}

export function useVibeAnalyzer() {
  // Energy history for phrase-level analysis (last 8 bars worth)
  const energyHistoryRef = useRef<{ value: number; time: number }[]>([]);
  const fluxHistoryRef = useRef<number[]>([]);
  const prevSpectrumRef = useRef<number[]>([]);

  // Smoothed output values
  const smoothedIntensityRef = useRef(0);
  const smoothedComplexityRef = useRef(0);
  const buildupConfidenceRef = useRef(0);

  // Timing for rate-limited updates
  const lastIntensityUpdateRef = useRef(0);
  const lastComplexityUpdateRef = useRef(0);
  const lastBuildupUpdateRef = useRef(0);

  const [vibeState, setVibeState] = useState<VibeState>(DEFAULT_VIBE);

  const analyzeVibe = useCallback((
    frequencyData: FrequencyData | null,
    beatInfo: BeatInfo
  ): VibeState => {
    if (!frequencyData) {
      return DEFAULT_VIBE;
    }

    const now = performance.now();
    const bpm = beatInfo.bpm || DEFAULT_BPM;
    const { bands, raw, energy: rawEnergy } = frequencyData;

    // === INTENSITY (updates every beat) ===
    const beatMs = MS_PER_BEAT(bpm);
    const timeSinceIntensityUpdate = now - lastIntensityUpdateRef.current;

    // Calculate raw intensity
    const rawIntensity = clamp(
      (rawEnergy * 0.6 + bands.bass * 0.3 + bands.subBass * 0.1) * 1.5
    );

    // Update intensity at beat rate with heavy smoothing
    if (timeSinceIntensityUpdate >= beatMs * 0.25) { // 4x per beat for smoothness
      const smoothFactor = 0.3; // Slower response
      smoothedIntensityRef.current = lerp(
        smoothedIntensityRef.current,
        rawIntensity,
        smoothFactor
      );
      lastIntensityUpdateRef.current = now;
    }

    // === COMPLEXITY (updates every bar) ===
    const barMs = MS_PER_BAR(bpm);
    const timeSinceComplexityUpdate = now - lastComplexityUpdateRef.current;

    // Calculate spectral flux
    let flux = 0;
    const currentSpectrum: number[] = [];
    for (let i = 0; i < Math.min(raw.length, 64); i++) {
      currentSpectrum[i] = raw[i] / 255;
      if (prevSpectrumRef.current.length > 0) {
        const diff = currentSpectrum[i] - (prevSpectrumRef.current[i] || 0);
        flux += Math.abs(diff);
      }
    }
    flux /= 64;
    prevSpectrumRef.current = currentSpectrum;

    // Track flux for averaging
    fluxHistoryRef.current.push(flux);
    const maxFluxHistory = beatsToFrames(4, bpm); // 1 bar of flux history
    if (fluxHistoryRef.current.length > maxFluxHistory) {
      fluxHistoryRef.current.shift();
    }

    // Update complexity at bar rate
    if (timeSinceComplexityUpdate >= barMs) {
      const activeBands = Object.values(bands).filter(v => v > 0.15).length;
      const bandActivity = activeBands / 6;
      const avgFlux = fluxHistoryRef.current.length > 0
        ? fluxHistoryRef.current.reduce((a, b) => a + b, 0) / fluxHistoryRef.current.length
        : 0;

      const rawComplexity = clamp(
        bandActivity * 0.5 +
        avgFlux * 10 + // Scale up flux contribution
        (beatInfo.confidence || 0) * 0.2
      );

      smoothedComplexityRef.current = lerp(
        smoothedComplexityRef.current,
        rawComplexity,
        0.4 // Moderate smoothing
      );
      lastComplexityUpdateRef.current = now;
    }

    // === BUILDUP (updates every phrase / 4 bars) ===
    const phraseMs = MS_PER_PHRASE(bpm);
    const timeSinceBuildupUpdate = now - lastBuildupUpdateRef.current;

    // Store energy with timestamp
    energyHistoryRef.current.push({ value: rawEnergy, time: now });

    // Keep 2 phrases worth of history (8 bars)
    const maxHistoryAge = phraseMs * 2;
    energyHistoryRef.current = energyHistoryRef.current.filter(
      e => now - e.time < maxHistoryAge
    );

    // Update buildup at phrase rate
    if (timeSinceBuildupUpdate >= phraseMs * 0.5) { // Update every 2 bars
      const history = energyHistoryRef.current;

      if (history.length > 10) {
        // Split history into older half and recent half
        const midpoint = Math.floor(history.length / 2);
        const olderHalf = history.slice(0, midpoint);
        const recentHalf = history.slice(midpoint);

        const olderAvg = olderHalf.reduce((a, b) => a + b.value, 0) / olderHalf.length;
        const recentAvg = recentHalf.reduce((a, b) => a + b.value, 0) / recentHalf.length;

        // Calculate trend
        const trend = recentAvg - olderAvg;

        // Buildup confidence based on sustained rising energy
        if (trend > 0.03) {
          // Energy is rising - increase buildup confidence
          buildupConfidenceRef.current = clamp(
            buildupConfidenceRef.current + 0.15,
            0, 1
          );
        } else if (trend < -0.05) {
          // Energy dropped sharply - we hit the drop, reset
          buildupConfidenceRef.current = clamp(
            buildupConfidenceRef.current - 0.4,
            0, 1
          );
        } else {
          // Energy stable - slowly decay
          buildupConfidenceRef.current = clamp(
            buildupConfidenceRef.current - 0.05,
            0, 1
          );
        }
      }

      lastBuildupUpdateRef.current = now;
    }

    const newVibe: VibeState = {
      intensity: smoothedIntensityRef.current,
      buildup: buildupConfidenceRef.current,
      complexity: smoothedComplexityRef.current,
    };

    setVibeState(newVibe);
    return newVibe;
  }, []);

  const reset = useCallback(() => {
    energyHistoryRef.current = [];
    fluxHistoryRef.current = [];
    prevSpectrumRef.current = [];
    smoothedIntensityRef.current = 0;
    smoothedComplexityRef.current = 0;
    buildupConfidenceRef.current = 0;
    lastIntensityUpdateRef.current = 0;
    lastComplexityUpdateRef.current = 0;
    lastBuildupUpdateRef.current = 0;
    setVibeState(DEFAULT_VIBE);
  }, []);

  return {
    vibeState,
    analyzeVibe,
    reset,
  };
}
