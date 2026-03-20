import { useMemo, useRef } from 'react';
import { FrequencyData, BeatInfo } from '@/types/audio';
import { LightShow, LightOutput, AudioFrame } from '@/types/show';
import { computeShowFrame } from '@/lib/showEngine';

interface SmoothedOutput {
  color: [number, number, number];
  intensity: number;
}

/**
 * Hook that runs the show engine each frame, producing smoothed per-light outputs.
 */
export function useShowEngine(
  show: LightShow,
  frequencyData: FrequencyData | null,
  beatInfo: BeatInfo,
  lightCount: number
): LightOutput[] {
  const prevOutputs = useRef<SmoothedOutput[]>(
    Array.from({ length: lightCount }, () => ({
      color: [0, 0, 0] as [number, number, number],
      intensity: 0,
    }))
  );

  const outputs = useMemo(() => {
    if (!frequencyData) {
      return Array.from({ length: lightCount }, () => ({
        color: [0, 0, 0] as [number, number, number],
        intensity: 0,
      }));
    }

    const frame: AudioFrame = {
      bands: frequencyData.bands,
      energy: frequencyData.energy,
      isBeat: beatInfo.isBeat,
      timeSinceLastBeat: beatInfo.timeSinceLastBeat,
      bpm: beatInfo.bpm,
    };

    const raw = computeShowFrame(show, frame, lightCount);

    const smoothed = raw.map((output, i) => {
      const prev = prevOutputs.current[i] || { color: [0, 0, 0], intensity: 0 };

      const attackFactor = 0.6;
      const releaseFactor = 0.15;
      const factor = output.intensity > prev.intensity ? attackFactor : releaseFactor;

      const smoothedIntensity = prev.intensity + (output.intensity - prev.intensity) * factor;
      const colorFactor = output.intensity > prev.intensity ? 0.4 : 0.1;
      const smoothedColor: [number, number, number] = [
        prev.color[0] + (output.color[0] - prev.color[0]) * colorFactor,
        prev.color[1] + (output.color[1] - prev.color[1]) * colorFactor,
        prev.color[2] + (output.color[2] - prev.color[2]) * colorFactor,
      ];

      return { color: smoothedColor, intensity: smoothedIntensity };
    });

    prevOutputs.current = smoothed;
    return smoothed;
  }, [frequencyData, beatInfo, show, lightCount]);

  return outputs;
}
