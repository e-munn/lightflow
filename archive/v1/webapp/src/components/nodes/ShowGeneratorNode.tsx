'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { NODE_WIDTH, NODE_HEIGHT_LG } from './types';
import { Sparkles, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { useState } from 'react';

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

export function ShowGeneratorNode({ data }: NodeProps<ShowGeneratorData>) {
  const [selectedStyle, setSelectedStyle] = useState<string>('energetic');

  const styles = [
    { value: 'energetic', label: 'Energetic' },
    { value: 'ambient', label: 'Ambient' },
    { value: 'dramatic', label: 'Dramatic' },
    { value: 'minimal', label: 'Minimal' },
  ];

  const statusColor = {
    idle: 'border-gray-600',
    analyzing: 'border-yellow-500',
    generating: 'border-purple-500',
    complete: 'border-emerald-500',
    error: 'border-red-500',
  }[data.status];

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${statusColor}`}
      style={{ width: NODE_WIDTH + 40, height: NODE_HEIGHT_LG + 40 }}
    >
      {/* Input from Audio File */}
      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#a855f7', top: '30%' }}
        title="Audio file input"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 mb-3">
        <Sparkles className="w-4 h-4 text-purple-400" />
        <span className="text-sm text-purple-400 font-medium">AI Show Generator</span>
      </div>

      {/* Status display */}
      {data.status === 'idle' && (
        <div className="space-y-3">
          <div className="text-xs text-gray-500">
            Generate an AI-choreographed light show based on the connected audio file.
          </div>

          {/* Style selector */}
          <div className="space-y-1.5">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">Style</div>
            <div className="grid grid-cols-2 gap-1">
              {styles.map((style) => (
                <button
                  key={style.value}
                  onClick={() => setSelectedStyle(style.value)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    selectedStyle === style.value
                      ? 'bg-purple-500/30 text-purple-300 border border-purple-500'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={() => data.onGenerate?.(selectedStyle)}
            className="w-full px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 text-sm rounded transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate Show
          </button>
        </div>
      )}

      {(data.status === 'analyzing' || data.status === 'generating') && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
            <span className="text-xs text-purple-400">
              {data.status === 'analyzing' ? 'Analyzing audio...' : 'Generating choreography...'}
            </span>
          </div>
          {data.statusText && (
            <div className="text-[10px] text-gray-500">{data.statusText}</div>
          )}
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-300 animate-pulse"
              style={{ width: data.status === 'analyzing' ? '40%' : '80%' }}
            />
          </div>
        </div>
      )}

      {data.status === 'complete' && data.analysisData && (
        <div className="space-y-3">
          {/* Success header */}
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-emerald-400">Show generated!</span>
          </div>

          {/* Show name */}
          {data.showName && (
            <div className="text-sm text-white font-medium truncate">
              {data.showName}
            </div>
          )}

          {/* Analysis summary */}
          <div className="space-y-1 text-[10px]">
            <div className="flex justify-between">
              <span className="text-gray-500">BPM</span>
              <span className="text-gray-300">{data.analysisData.bpm}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Duration</span>
              <span className="text-gray-300">
                {Math.floor(data.analysisData.duration / 60)}:{String(Math.floor(data.analysisData.duration % 60)).padStart(2, '0')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Sections</span>
              <span className="text-gray-300">{data.sectionCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Pattern</span>
              <span className="text-gray-300">
                {data.analysisData.patterns.four_on_floor ? '4x4' : 'Varied'}{' '}
                {data.analysisData.patterns.hat_rate}
              </span>
            </div>
          </div>

          {/* Section labels */}
          <div className="flex flex-wrap gap-1">
            {data.analysisData.sectionLabels.slice(0, 6).map((label, i) => (
              <span
                key={i}
                className={`px-1.5 py-0.5 text-[9px] rounded ${
                  label === 'drop'
                    ? 'bg-red-500/20 text-red-400'
                    : label === 'buildup'
                    ? 'bg-yellow-500/20 text-yellow-400'
                    : label === 'breakdown'
                    ? 'bg-blue-500/20 text-blue-400'
                    : 'bg-gray-700 text-gray-400'
                }`}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Apply button */}
          <button
            onClick={() => data.onApply?.()}
            className="w-full px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-xs rounded transition-colors"
          >
            Apply to Lights
          </button>

          {/* Regenerate */}
          <button
            onClick={() => data.onGenerate?.(selectedStyle)}
            className="w-full px-3 py-1 text-[10px] text-gray-500 hover:text-gray-400 transition-colors"
          >
            Regenerate
          </button>
        </div>
      )}

      {data.status === 'error' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-red-400">Generation failed</span>
          </div>
          {data.statusText && (
            <div className="text-[10px] text-red-400/80">{data.statusText}</div>
          )}
          <button
            onClick={() => data.onGenerate?.(selectedStyle)}
            className="w-full px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Output handles for light assignments */}
      <Handle
        type="source"
        position={Position.Right}
        id="show-config"
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#a855f7' }}
        title="Show configuration output"
      />
    </div>
  );
}
