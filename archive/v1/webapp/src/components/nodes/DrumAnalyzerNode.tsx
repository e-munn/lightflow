'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { DrumAnalyzerData, DRUM_CONFIG, NODE_WIDTH, NODE_HEIGHT_MD } from './types';

export function DrumAnalyzerNode({ data }: NodeProps<DrumAnalyzerData>) {
  const isActive = data.status === 'analyzing';
  const canRerun = data.status === 'complete' || data.status === 'error';

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${
        data.status === 'error' ? 'border-red-600' :
        data.status === 'complete' ? 'border-cyan-500' :
        isActive ? 'border-cyan-600' : 'border-gray-600'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#22d3ee' }}
        title="Drum input (from Stem Analyzer drums output)"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-cyan-400 uppercase tracking-wide">Drum Analyzer</div>
        {isActive && (
          <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
        )}
        {canRerun && data.onRerun && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onRerun?.(); }}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            title="Re-analyze"
          >
            <RefreshCw className="w-3 h-3 text-gray-400 hover:text-white" />
          </button>
        )}
      </div>

      {data.status === 'idle' && (
        <div className="text-xs text-gray-500">Waiting for drum input...</div>
      )}

      {data.status === 'analyzing' && (
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600 rounded-full transition-all duration-300"
            style={{ width: `${data.progress}%` }}
          />
        </div>
      )}

      {data.status === 'complete' && (
        <div className="space-y-1">
          {DRUM_CONFIG.map((drum) => (
            <div key={drum.key} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: drum.color }} />
              <span className="text-xs text-gray-500">{drum.label}</span>
            </div>
          ))}
        </div>
      )}

      {data.status === 'error' && (
        <div className="text-xs text-red-400 truncate">{data.statusText || 'Failed'}</div>
      )}

      {/* 3 output handles for kick, snare, hats */}
      {DRUM_CONFIG.map((drum, i) => (
        <Handle
          key={drum.key}
          type="source"
          position={Position.Right}
          id={drum.key}
          style={{
            top: `${30 + i * 25}%`,
            backgroundColor: data.status === 'complete' ? drum.color : '#4b5563',
          }}
          className="!w-2.5 !h-2.5 !border-2 !border-gray-900 transition-colors"
          title={drum.label}
        />
      ))}
    </div>
  );
}
