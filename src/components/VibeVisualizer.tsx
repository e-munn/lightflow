'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { AudioAnalysis, TimeSeriesPoint } from '@/types/analysis';
import { StemSeparationResult } from '@/lib/api';

interface VibeVisualizerProps {
  analysis?: AudioAnalysis | null;
  stems?: StemSeparationResult | null;
  currentTime?: number;
}

// Get interpolated value from time series data
function getValueAtTime(data: TimeSeriesPoint[] | undefined, time: number): number {
  if (!data || data.length === 0) return 0;

  for (let i = 0; i < data.length - 1; i++) {
    if (data[i + 1].time > time) {
      const t0 = data[i].time;
      const t1 = data[i + 1].time;
      const v0 = data[i].value;
      const v1 = data[i + 1].value;
      const t = (time - t0) / (t1 - t0);
      return v0 + t * (v1 - v0);
    }
  }
  return data[data.length - 1].value;
}

// Compute blended light energy from stems
function computeLightEnergy(
  stems: StemSeparationResult | null | undefined,
  intensity: TimeSeriesPoint[] | undefined,
  currentTime: number
): number {
  if (stems?.stems) {
    const bass = getValueAtTime(stems.stems.bass, currentTime);
    const drums = getValueAtTime(stems.stems.drums, currentTime);
    const vocals = getValueAtTime(stems.stems.vocals, currentTime);

    // Blend: bass provides foundation, drums add punch, vocals add texture
    // Bass is weighted heavily for the "pulse", drums for transients
    const blended = bass * 0.5 + drums * 0.35 + vocals * 0.15;
    return Math.min(1, blended);
  }

  // Fallback to intensity
  return getValueAtTime(intensity, currentTime);
}

// Envelope follower with fast attack, slow release
function useEnvelopeFollower(input: number, attackMs: number, releaseMs: number): number {
  const [output, setOutput] = useState(0);
  const lastTimeRef = useRef(performance.now());
  const currentValueRef = useRef(0);

  useEffect(() => {
    const now = performance.now();
    const deltaMs = now - lastTimeRef.current;
    lastTimeRef.current = now;

    const current = currentValueRef.current;

    if (input > current) {
      // Attack: fast rise
      const attackCoeff = 1 - Math.exp(-deltaMs / attackMs);
      currentValueRef.current = current + (input - current) * attackCoeff;
    } else {
      // Release: slow decay
      const releaseCoeff = 1 - Math.exp(-deltaMs / releaseMs);
      currentValueRef.current = current + (input - current) * releaseCoeff;
    }

    setOutput(currentValueRef.current);
  }, [input, attackMs, releaseMs]);

  return output;
}

export function VibeVisualizer({ analysis, stems, currentTime = 0 }: VibeVisualizerProps) {
  // Compute raw energy from stems
  const rawEnergy = useMemo(() => {
    return computeLightEnergy(stems, analysis?.intensity, currentTime);
  }, [stems, analysis?.intensity, currentTime]);

  // Apply envelope: fast attack (30ms) for snare punch, slow release (400ms) for smooth decay
  const energy = useEnvelopeFollower(rawEnergy, 30, 400);

  // White light - let the energy do the talking
  const color = '#ffffff';

  // Map energy to visual properties
  const minSize = 40;
  const maxSize = 300;
  const size = minSize + energy * (maxSize - minSize);
  const opacity = 0.3 + energy * 0.7;
  const glowSize = energy * 120;

  return (
    <div className="w-full h-full flex items-center justify-center bg-black rounded-lg overflow-hidden">
      {/* Single pulsating light */}
      <div className="relative flex items-center justify-center">
        {/* Outer glow */}
        <div
          className="absolute rounded-full transition-all duration-75"
          style={{
            width: size * 2,
            height: size * 2,
            backgroundColor: color,
            opacity: energy * 0.15,
            filter: `blur(${40 + energy * 40}px)`,
          }}
        />

        {/* Main light body */}
        <div
          className="rounded-full transition-all duration-75"
          style={{
            width: size,
            height: size,
            backgroundColor: color,
            opacity: opacity,
            boxShadow: `0 0 ${glowSize}px ${color}`,
          }}
        />

        {/* Bright core */}
        <div
          className="absolute rounded-full transition-all duration-75"
          style={{
            width: size * 0.4,
            height: size * 0.4,
            backgroundColor: '#fff',
            opacity: energy * 0.9,
          }}
        />
      </div>

    </div>
  );
}
