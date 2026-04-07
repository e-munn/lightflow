'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { PlaybackData, NODE_WIDTH, STEM_CONFIG, DRUM_CONFIG } from './types';
import { Volume2, VolumeX } from 'lucide-react';

// Get color for stem type (stems or drum bands)
function getStemColor(stemType: string | null): string {
  if (!stemType) return '#6b7280'; // gray-500
  const stem = STEM_CONFIG.find(s => s.key === stemType);
  if (stem) return stem.color;
  const drum = DRUM_CONFIG.find(d => d.key === stemType);
  if (drum) return drum.color;
  if (stemType === 'no_vocals') return '#a78bfa'; // violet-400
  return '#6b7280';
}

// Get label for stem type
function getStemLabel(stemType: string | null): string {
  if (!stemType) return 'No input';
  const stem = STEM_CONFIG.find(s => s.key === stemType);
  if (stem) return stem.label;
  const drum = DRUM_CONFIG.find(d => d.key === stemType);
  if (drum) return drum.label;
  if (stemType === 'no_vocals') return 'Instrumental';
  return stemType;
}

export function PlaybackNode({ data }: NodeProps<PlaybackData>) {
  const color = getStemColor(data.stemType);
  const label = getStemLabel(data.stemType);
  const hasInput = !!data.stemUrl;

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${
        data.isActive ? 'border-emerald-500' :
        hasInput ? 'border-gray-600' : 'border-gray-700'
      }`}
      style={{ width: NODE_WIDTH, height: 90 }}
    >
      {/* Input handle - accepts stem signal */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-gray-900 transition-colors"
        style={{ backgroundColor: color }}
        title="Stem input"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-violet-400 uppercase tracking-wide">Isolate</div>
        {data.isActive && (
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] text-emerald-400">SOLO</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Stem indicator with color */}
        <div className="flex items-center gap-2 flex-1">
          <div
            className="w-3 h-3 rounded-full transition-all"
            style={{
              backgroundColor: color,
              boxShadow: data.isActive ? `0 0 12px ${color}` : 'none'
            }}
          />
          <span className="text-sm text-white font-medium">{label}</span>
        </div>

        {/* Toggle button */}
        <button
          onClick={() => data.onToggle?.()}
          disabled={!hasInput}
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
            data.isActive
              ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
              : hasInput
                ? 'bg-white/10 hover:bg-white/20 text-gray-400 hover:text-white'
                : 'bg-white/5 text-gray-600 cursor-not-allowed'
          }`}
          title={data.isActive ? 'Turn off isolation' : 'Solo this stem'}
        >
          {data.isActive ? (
            <Volume2 className="w-5 h-5" />
          ) : (
            <VolumeX className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Mini amplitude bar */}
      {hasInput && (
        <div className="mt-2 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${data.inputValue * 100}%`,
              backgroundColor: data.isActive ? color : '#4b5563'
            }}
          />
        </div>
      )}

      {/* Status text for drum bands etc */}
      {data.statusText && (
        <div className="mt-1 text-[10px] text-gray-500 truncate">
          {data.statusText}
        </div>
      )}
    </div>
  );
}
