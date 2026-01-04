'use client';

import { useMemo, useRef, useEffect, useState } from 'react';
import { AudioAnalysis, TimeSeriesPoint } from '@/types/analysis';
import { StemSeparationResult } from '@/lib/api';

interface MixerViewProps {
  analysis?: AudioAnalysis | null;
  stems?: StemSeparationResult | null;
  currentTime?: number;
}

// Mixer parameters with defaults
interface MixerParams {
  // Stem weights (should sum to ~1)
  bassWeight: number;
  drumsWeight: number;
  vocalsWeight: number;

  // Envelope
  attackMs: number;
  releaseMs: number;

  // Dynamics
  sensitivity: number;    // Input gain/sensitivity
  threshold: number;      // Minimum level
  beatBoost: number;      // Extra punch on transients

  // Smoothing
  smoothing: number;      // Post-processing smoothing
}

const DEFAULT_PARAMS: MixerParams = {
  bassWeight: 0.5,
  drumsWeight: 0.35,
  vocalsWeight: 0.15,
  attackMs: 30,
  releaseMs: 400,
  sensitivity: 1.0,
  threshold: 0.05,
  beatBoost: 0.2,
  smoothing: 0.3,
};

// Get interpolated value from time series
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

// Detect if current frame is a beat/transient
function detectTransient(
  data: TimeSeriesPoint[] | undefined,
  time: number,
  lookbackMs: number = 50
): boolean {
  if (!data || data.length === 0) return false;

  const current = getValueAtTime(data, time);
  const previous = getValueAtTime(data, time - lookbackMs / 1000);

  // Transient = sudden increase
  return current > previous * 1.5 && current > 0.3;
}

// Slider component
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-gray-500 w-20 shrink-0 uppercase tracking-wide">
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
      />
      <span className="text-xs text-gray-400 w-16 text-right font-mono">
        {value.toFixed(step < 1 ? 2 : 0)}{unit || ''}
      </span>
    </div>
  );
}

// Envelope follower hook
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
      const attackCoeff = 1 - Math.exp(-deltaMs / attackMs);
      currentValueRef.current = current + (input - current) * attackCoeff;
    } else {
      const releaseCoeff = 1 - Math.exp(-deltaMs / releaseMs);
      currentValueRef.current = current + (input - current) * releaseCoeff;
    }

    setOutput(currentValueRef.current);
  }, [input, attackMs, releaseMs]);

  return output;
}

export function MixerView({ analysis, stems, currentTime = 0 }: MixerViewProps) {
  const [params, setParams] = useState<MixerParams>(DEFAULT_PARAMS);

  // Update a single parameter
  const updateParam = (key: keyof MixerParams, value: number) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  // Reset to defaults
  const resetParams = () => setParams(DEFAULT_PARAMS);

  // Get current stem values
  const stemValues = useMemo(() => {
    if (!stems?.stems) return { bass: 0, drums: 0, vocals: 0 };
    return {
      bass: getValueAtTime(stems.stems.bass, currentTime),
      drums: getValueAtTime(stems.stems.drums, currentTime),
      vocals: getValueAtTime(stems.stems.vocals, currentTime),
    };
  }, [stems, currentTime]);

  // Detect beat/transient on drums
  const isTransient = useMemo(() => {
    return detectTransient(stems?.stems?.drums, currentTime);
  }, [stems, currentTime]);

  // Compute raw mixed value
  const rawMix = useMemo(() => {
    const weighted =
      stemValues.bass * params.bassWeight +
      stemValues.drums * params.drumsWeight +
      stemValues.vocals * params.vocalsWeight;

    // Apply sensitivity
    let value = weighted * params.sensitivity;

    // Apply beat boost
    if (isTransient) {
      value = Math.min(1, value + params.beatBoost);
    }

    // Apply threshold
    if (value < params.threshold) value = 0;

    return Math.min(1, value);
  }, [stemValues, params, isTransient]);

  // Apply envelope
  const envelopedValue = useEnvelopeFollower(rawMix, params.attackMs, params.releaseMs);

  // Apply smoothing (simple exponential)
  const [smoothedValue, setSmoothedValue] = useState(0);
  useEffect(() => {
    setSmoothedValue((prev) => prev + (envelopedValue - prev) * (1 - params.smoothing));
  }, [envelopedValue, params.smoothing]);

  const finalOutput = smoothedValue;

  // Visual sizing
  const minSize = 60;
  const maxSize = 280;
  const size = minSize + finalOutput * (maxSize - minSize);

  return (
    <div className="w-full h-full flex bg-black rounded-lg overflow-hidden">
      {/* Left: Light preview */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* Outer glow */}
        <div
          className="absolute rounded-full transition-all duration-75"
          style={{
            width: size * 2,
            height: size * 2,
            backgroundColor: '#fff',
            opacity: finalOutput * 0.15,
            filter: `blur(${40 + finalOutput * 40}px)`,
          }}
        />

        {/* Main light */}
        <div
          className="rounded-full transition-all duration-75"
          style={{
            width: size,
            height: size,
            backgroundColor: '#fff',
            opacity: 0.3 + finalOutput * 0.7,
            boxShadow: `0 0 ${finalOutput * 120}px rgba(255,255,255,${finalOutput * 0.8})`,
          }}
        />

        {/* Core */}
        <div
          className="absolute rounded-full bg-white transition-all duration-75"
          style={{
            width: size * 0.4,
            height: size * 0.4,
            opacity: finalOutput,
          }}
        />

        {/* Beat indicator */}
        {isTransient && (
          <div className="absolute top-4 right-4 w-3 h-3 rounded-full bg-amber-500 animate-ping" />
        )}

        {/* Output value */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center">
          <div className="text-4xl font-mono text-white font-bold">
            {(finalOutput * 100).toFixed(0)}
          </div>
        </div>
      </div>

      {/* Right: Mixer controls */}
      <div className="w-80 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Mixer</h3>
          <button
            onClick={resetParams}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Reset
          </button>
        </div>

        {/* Stem Meters */}
        <div className="mb-6">
          <div className="text-xs text-gray-600 uppercase tracking-wide mb-2">Input Levels</div>
          <div className="space-y-2">
            {[
              { label: 'Bass', value: stemValues.bass, color: 'bg-green-500' },
              { label: 'Drums', value: stemValues.drums, color: 'bg-amber-500' },
              { label: 'Vocals', value: stemValues.vocals, color: 'bg-blue-500' },
            ].map((meter) => (
              <div key={meter.label} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-12">{meter.label}</span>
                <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${meter.color} transition-all duration-75`}
                    style={{ width: `${meter.value * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600 w-8 text-right font-mono">
                  {(meter.value * 100).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Blend Weights */}
        <div className="mb-6">
          <div className="text-xs text-gray-600 uppercase tracking-wide mb-3">Blend</div>
          <div className="space-y-3">
            <Slider
              label="Bass"
              value={params.bassWeight}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateParam('bassWeight', v)}
            />
            <Slider
              label="Drums"
              value={params.drumsWeight}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateParam('drumsWeight', v)}
            />
            <Slider
              label="Vocals"
              value={params.vocalsWeight}
              min={0}
              max={1}
              step={0.05}
              onChange={(v) => updateParam('vocalsWeight', v)}
            />
          </div>
        </div>

        {/* Envelope */}
        <div className="mb-6">
          <div className="text-xs text-gray-600 uppercase tracking-wide mb-3">Envelope</div>
          <div className="space-y-3">
            <Slider
              label="Attack"
              value={params.attackMs}
              min={5}
              max={200}
              step={5}
              unit="ms"
              onChange={(v) => updateParam('attackMs', v)}
            />
            <Slider
              label="Release"
              value={params.releaseMs}
              min={50}
              max={1000}
              step={25}
              unit="ms"
              onChange={(v) => updateParam('releaseMs', v)}
            />
          </div>
        </div>

        {/* Dynamics */}
        <div className="mb-6">
          <div className="text-xs text-gray-600 uppercase tracking-wide mb-3">Dynamics</div>
          <div className="space-y-3">
            <Slider
              label="Sensitivity"
              value={params.sensitivity}
              min={0.5}
              max={2}
              step={0.1}
              unit="x"
              onChange={(v) => updateParam('sensitivity', v)}
            />
            <Slider
              label="Threshold"
              value={params.threshold}
              min={0}
              max={0.3}
              step={0.01}
              onChange={(v) => updateParam('threshold', v)}
            />
            <Slider
              label="Beat Boost"
              value={params.beatBoost}
              min={0}
              max={0.5}
              step={0.05}
              onChange={(v) => updateParam('beatBoost', v)}
            />
          </div>
        </div>

        {/* Smoothing */}
        <div className="mb-6">
          <div className="text-xs text-gray-600 uppercase tracking-wide mb-3">Output</div>
          <div className="space-y-3">
            <Slider
              label="Smoothing"
              value={params.smoothing}
              min={0}
              max={0.9}
              step={0.05}
              onChange={(v) => updateParam('smoothing', v)}
            />
          </div>
        </div>

        {/* No stems warning */}
        {!stems?.stems && (
          <div className="text-center py-4 text-gray-600 text-sm">
            Waiting for stem separation...
          </div>
        )}
      </div>
    </div>
  );
}
