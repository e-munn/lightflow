import {
  LightShow,
  Layer,
  LightOutput,
  AudioFrame,
  LightPosition,
  BlendMode,
} from '@/types/show';

// Get the raw energy value for a layer's source from the audio frame
function getSourceValue(source: Layer['source'], frame: AudioFrame): number {
  switch (source) {
    case 'bass':
      return frame.bands.subBass * 0.4 + frame.bands.bass * 0.6;
    case 'drums':
      return frame.bands.lowMid * 0.5 + frame.bands.bass * 0.3 + (frame.isBeat ? 0.3 : 0);
    case 'vocals':
      return frame.bands.mid * 0.6 + frame.bands.highMid * 0.4;
    case 'intensity':
      return frame.energy;
    case 'section':
      return frame.energy;
  }
}

// Apply response curve to a raw value
function applyResponse(
  curve: Layer['response'],
  value: number,
  frame: AudioFrame
): number {
  switch (curve) {
    case 'pulse':
      return value;
    case 'flash': {
      const threshold = 0.4;
      if (frame.isBeat && value > 0.2) return 1;
      const decay = Math.max(0, 1 - frame.timeSinceLastBeat / 150);
      return value > threshold ? decay : 0;
    }
    case 'smooth':
      return Math.sqrt(value) * 0.7;
    case 'inverse':
      return 1 - value;
  }
}

// How much weight a layer gets at a given light position based on spatial hint
function getSpatialWeight(
  spatial: Layer['spatial'],
  pos: LightPosition
): number {
  const n = pos.normalized;
  switch (spatial) {
    case 'center': {
      const d = Math.abs(n - 0.5) * 2;
      return 1 - d * d;
    }
    case 'all':
      return 1;
    case 'stereo': {
      const d = Math.abs(n - 0.5) * 2;
      return 0.3 + d * 0.7;
    }
    case 'edges': {
      const d = Math.abs(n - 0.5) * 2;
      return d * d;
    }
    case 'random':
      return 0.5 + Math.sin(pos.index * 137.5) * 0.5;
  }
}

// Blend two RGB colors
function blendColors(
  a: [number, number, number],
  b: [number, number, number],
  mode: BlendMode,
  aWeight: number,
  bWeight: number
): [number, number, number] {
  switch (mode) {
    case 'add':
      return [
        Math.min(1, a[0] * aWeight + b[0] * bWeight),
        Math.min(1, a[1] * aWeight + b[1] * bWeight),
        Math.min(1, a[2] * aWeight + b[2] * bWeight),
      ];
    case 'max':
      return [
        Math.max(a[0] * aWeight, b[0] * bWeight),
        Math.max(a[1] * aWeight, b[1] * bWeight),
        Math.max(a[2] * aWeight, b[2] * bWeight),
      ];
    case 'multiply':
      return [
        a[0] * aWeight * b[0] * bWeight,
        a[1] * aWeight * b[1] * bWeight,
        a[2] * aWeight * b[2] * bWeight,
      ];
  }
}

// Get the color for a layer given its energy level
function getLayerColor(layer: Layer, energy: number): [number, number, number] {
  const { base, reactive } = layer.color;
  if (!reactive) return base;
  return [
    base[0] + (reactive[0] - base[0]) * energy,
    base[1] + (reactive[1] - base[1]) * energy,
    base[2] + (reactive[2] - base[2]) * energy,
  ];
}

/**
 * Core show engine: takes a show definition + audio frame + light count
 * and produces per-light output (color + intensity).
 */
export function computeShowFrame(
  show: LightShow,
  frame: AudioFrame,
  lightCount: number
): LightOutput[] {
  const sortedLayers = [...show.layers].sort((a, b) => a.priority - b.priority);

  const positions: LightPosition[] = Array.from({ length: lightCount }, (_, i) => ({
    index: i,
    normalized: lightCount === 1 ? 0.5 : i / (lightCount - 1),
    total: lightCount,
  }));

  const outputs: LightOutput[] = positions.map((pos) => {
    let finalColor: [number, number, number] = [0, 0, 0];
    let finalIntensity = 0;
    let hasContribution = false;

    for (const layer of sortedLayers) {
      const rawValue = getSourceValue(layer.source, frame);
      const shaped = applyResponse(layer.response, rawValue, frame);
      const spatialWeight = getSpatialWeight(layer.spatial, pos);
      const layerIntensity = shaped * spatialWeight;

      if (layerIntensity < 0.01) continue;

      const layerColor = getLayerColor(layer, shaped);

      if (!hasContribution) {
        finalColor = [
          layerColor[0] * layerIntensity,
          layerColor[1] * layerIntensity,
          layerColor[2] * layerIntensity,
        ];
        finalIntensity = layerIntensity;
        hasContribution = true;
      } else {
        finalColor = blendColors(finalColor, layerColor, show.blendMode, 1, layerIntensity);
        finalIntensity = show.blendMode === 'max'
          ? Math.max(finalIntensity, layerIntensity)
          : Math.min(1, finalIntensity + layerIntensity);
      }
    }

    return {
      color: finalColor,
      intensity: Math.min(1, finalIntensity),
    };
  });

  return outputs;
}

/**
 * Convert LightOutput color to a CSS hex string.
 */
export function lightOutputToHex(output: LightOutput): string {
  const r = Math.round(Math.min(1, output.color[0]) * 255);
  const g = Math.round(Math.min(1, output.color[1]) * 255);
  const b = Math.round(Math.min(1, output.color[2]) * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}
