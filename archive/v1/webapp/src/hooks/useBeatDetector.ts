'use client';

import { useRef, useCallback, useState } from 'react';
import { FrequencyData, BeatInfo } from '@/types/audio';

// Constants for beat detection
const ONSET_THRESHOLD = 0.08;        // Minimum spectral flux to consider as onset
const MIN_BPM = 60;
const MAX_BPM = 180;
const TEMPO_SMOOTH_FACTOR = 0.9;     // How much to weight previous tempo estimate
const BASS_THRESHOLD = 0.15;         // Minimum bass energy for onset

interface BeatState {
  // Spectral flux history for onset detection
  fluxHistory: number[];
  prevSpectrum: number[];

  // Onset times for autocorrelation
  onsetTimes: number[];
  onsetStrengths: number[];

  // Tempo tracking
  currentTempo: number | null;
  tempoConfidence: number;

  // Phase tracking (when is the next beat expected)
  lastBeatTime: number;
  beatPhase: number;        // 0-1, where in the beat cycle we are
  phaseLocked: boolean;
}

function createInitialState(): BeatState {
  return {
    fluxHistory: [],
    prevSpectrum: [],
    onsetTimes: [],
    onsetStrengths: [],
    currentTempo: null,
    tempoConfidence: 0,
    lastBeatTime: 0,
    beatPhase: 0,
    phaseLocked: false,
  };
}

// Calculate spectral flux (sum of positive differences between frames)
function calculateSpectralFlux(current: number[], previous: number[]): number {
  if (previous.length === 0) return 0;

  let flux = 0;
  const len = Math.min(current.length, previous.length, 128); // Focus on lower frequencies

  for (let i = 0; i < len; i++) {
    const diff = current[i] - previous[i];
    if (diff > 0) {
      // Weight lower frequencies more (where kick drums live)
      const weight = 1 - (i / len) * 0.5;
      flux += diff * weight;
    }
  }

  return flux / len;
}

// Find tempo using autocorrelation of onset signal
function estimateTempo(onsetTimes: number[], onsetStrengths: number[], now: number): { bpm: number; confidence: number } | null {
  if (onsetTimes.length < 4) return null;

  // Only use recent onsets (last 10 seconds)
  const recentCutoff = now - 10000;
  const recentOnsets: { time: number; strength: number }[] = [];

  for (let i = 0; i < onsetTimes.length; i++) {
    if (onsetTimes[i] > recentCutoff) {
      recentOnsets.push({ time: onsetTimes[i], strength: onsetStrengths[i] });
    }
  }

  if (recentOnsets.length < 4) return null;

  // Calculate inter-onset intervals
  const intervals: number[] = [];
  for (let i = 1; i < recentOnsets.length; i++) {
    intervals.push(recentOnsets[i].time - recentOnsets[i - 1].time);
  }

  // Build histogram of tempo candidates
  // Each interval votes for its corresponding BPM and integer multiples/divisions
  const tempoVotes: Map<number, number> = new Map();

  for (const interval of intervals) {
    if (interval < 50) continue; // Skip very short intervals (noise)

    // This interval corresponds to this BPM
    const baseBpm = 60000 / interval;

    // Vote for this tempo and reasonable multiples/divisions
    const candidates = [baseBpm, baseBpm / 2, baseBpm * 2];

    for (const bpm of candidates) {
      if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
        const roundedBpm = Math.round(bpm);
        const currentVotes = tempoVotes.get(roundedBpm) || 0;
        tempoVotes.set(roundedBpm, currentVotes + 1);

        // Also vote for nearby tempos (tolerance of ±2 BPM)
        for (let offset = -2; offset <= 2; offset++) {
          if (offset !== 0) {
            const nearbyBpm = roundedBpm + offset;
            const nearbyVotes = tempoVotes.get(nearbyBpm) || 0;
            tempoVotes.set(nearbyBpm, nearbyVotes + 0.5);
          }
        }
      }
    }
  }

  // Find the BPM with most votes
  let bestBpm = 0;
  let bestVotes = 0;
  let totalVotes = 0;

  tempoVotes.forEach((votes, bpm) => {
    totalVotes += votes;
    if (votes > bestVotes) {
      bestVotes = votes;
      bestBpm = bpm;
    }
  });

  if (bestBpm === 0) return null;

  // Confidence based on how dominant the winning tempo is
  const confidence = Math.min(1, bestVotes / (totalVotes * 0.3));

  return { bpm: bestBpm, confidence };
}

export function useBeatDetector() {
  const stateRef = useRef<BeatState>(createInitialState());

  const [beatInfo, setBeatInfo] = useState<BeatInfo>({
    isBeat: false,
    bpm: null,
    confidence: 0,
    lastBeatTime: 0,
    timeSinceLastBeat: 0,
  });

  const detectBeat = useCallback((frequencyData: FrequencyData | null): BeatInfo => {
    if (!frequencyData) {
      return beatInfo;
    }

    const now = performance.now();
    const state = stateRef.current;
    const { bands, raw } = frequencyData;

    // Convert raw to number array for spectral flux
    const currentSpectrum: number[] = [];
    for (let i = 0; i < Math.min(raw.length, 128); i++) {
      currentSpectrum.push(raw[i] / 255);
    }

    // Calculate spectral flux
    const flux = calculateSpectralFlux(currentSpectrum, state.prevSpectrum);
    state.prevSpectrum = currentSpectrum;

    // Add to flux history
    state.fluxHistory.push(flux);
    if (state.fluxHistory.length > 30) {
      state.fluxHistory.shift();
    }

    // Adaptive threshold: flux must be above local average
    const avgFlux = state.fluxHistory.reduce((a, b) => a + b, 0) / state.fluxHistory.length;
    const fluxThreshold = Math.max(ONSET_THRESHOLD, avgFlux * 1.5);

    // Detect onset
    const isOnset = flux > fluxThreshold && flux > (state.fluxHistory[state.fluxHistory.length - 2] || 0);

    // Also check bass energy for kick detection
    const bassEnergy = (bands.subBass * 2 + bands.bass) / 3;
    const hasBass = bassEnergy > BASS_THRESHOLD;

    // Combined onset detection - either spectral flux OR bass hit
    const isStrongOnset = isOnset || (hasBass && flux > ONSET_THRESHOLD * 0.5);

    // Record onset
    if (isStrongOnset) {
      // Debounce: don't record onsets too close together
      const lastOnsetTime = state.onsetTimes[state.onsetTimes.length - 1] || 0;
      if (now - lastOnsetTime > 100) { // Minimum 100ms between onsets (~600 BPM max)
        state.onsetTimes.push(now);
        state.onsetStrengths.push(flux);

        // Keep only recent onsets
        while (state.onsetTimes.length > 100) {
          state.onsetTimes.shift();
          state.onsetStrengths.shift();
        }
      }
    }

    // Estimate tempo from onset history
    const tempoEstimate = estimateTempo(state.onsetTimes, state.onsetStrengths, now);

    if (tempoEstimate && tempoEstimate.confidence > 0.15) {
      if (state.currentTempo === null) {
        state.currentTempo = tempoEstimate.bpm;
        state.tempoConfidence = tempoEstimate.confidence;
      } else {
        // Smooth tempo changes
        state.currentTempo = state.currentTempo * TEMPO_SMOOTH_FACTOR +
                            tempoEstimate.bpm * (1 - TEMPO_SMOOTH_FACTOR);
        state.tempoConfidence = state.tempoConfidence * TEMPO_SMOOTH_FACTOR +
                               tempoEstimate.confidence * (1 - TEMPO_SMOOTH_FACTOR);
      }
    }

    // Beat phase tracking
    let isBeat = false;
    const timeSinceLastBeat = now - state.lastBeatTime;

    if (state.currentTempo) {
      const beatInterval = 60000 / state.currentTempo;

      // Update phase
      state.beatPhase = (timeSinceLastBeat % beatInterval) / beatInterval;

      // Predict when next beat should occur
      const expectedBeatWindow = beatInterval * 0.15; // ±15% tolerance
      const timeSinceExpectedBeat = timeSinceLastBeat % beatInterval;
      const nearExpectedBeat = timeSinceExpectedBeat < expectedBeatWindow ||
                               timeSinceExpectedBeat > beatInterval - expectedBeatWindow;

      // Trigger beat if:
      // 1. We detect a strong onset near where we expect a beat, OR
      // 2. We're phase-locked and it's time for a beat (even without onset)
      if (isStrongOnset && nearExpectedBeat) {
        isBeat = true;
        state.lastBeatTime = now;
        state.phaseLocked = true;
      } else if (state.phaseLocked && state.tempoConfidence > 0.5) {
        // Phase-locked mode: trigger beat at expected time even without strong onset
        if (timeSinceLastBeat >= beatInterval * 0.95) {
          isBeat = true;
          state.lastBeatTime = now;
        }
      } else if (isStrongOnset && timeSinceLastBeat > 200) {
        // Not phase-locked yet: trigger on any strong onset
        isBeat = true;
        state.lastBeatTime = now;
      }
    } else {
      // No tempo yet: just trigger on strong onsets
      if (isStrongOnset && timeSinceLastBeat > 200) {
        isBeat = true;
        state.lastBeatTime = now;
      }
    }

    const newBeatInfo: BeatInfo = {
      isBeat,
      bpm: state.currentTempo ? Math.round(state.currentTempo) : null,
      confidence: state.tempoConfidence,
      lastBeatTime: state.lastBeatTime,
      timeSinceLastBeat,
    };

    setBeatInfo(newBeatInfo);
    return newBeatInfo;
  }, []);

  const reset = useCallback(() => {
    stateRef.current = createInitialState();
    setBeatInfo({
      isBeat: false,
      bpm: null,
      confidence: 0,
      lastBeatTime: 0,
      timeSinceLastBeat: 0,
    });
  }, []);

  return {
    beatInfo,
    detectBeat,
    reset,
  };
}
