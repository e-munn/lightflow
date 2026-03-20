'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { StemAnalyzerData, STEM_CONFIG, NODE_WIDTH, NODE_HEIGHT_MD } from './types';

export function StemAnalyzerNode({ data }: NodeProps<StemAnalyzerData>) {
  const isActive = data.status === 'uploading' || data.status === 'processing';
  const canRerun = data.status === 'complete' || data.status === 'error';

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${
        data.status === 'error' ? 'border-red-600' :
        data.status === 'complete' ? 'border-emerald-500' :
        isActive ? 'border-amber-500' : 'border-gray-600'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-white !w-3 !h-3 !border-2 !border-gray-900"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-emerald-400 uppercase tracking-wide">Stem Analyzer</div>
        {isActive && (
          <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
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
        <div className="text-xs text-gray-500">Waiting for audio...</div>
      )}

      {(data.status === 'uploading' || data.status === 'processing') && (
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-300"
            style={{ width: `${data.progress}%` }}
          />
        </div>
      )}

      {data.status === 'complete' && (
        <div className="space-y-1">
          {STEM_CONFIG.map((stem) => (
            <div key={stem.key} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stem.color }} />
              <span className="text-xs text-gray-500">{stem.label}</span>
            </div>
          ))}
        </div>
      )}

      {data.status === 'error' && (
        <div className="text-xs text-red-400 truncate">{data.statusText || 'Failed'}</div>
      )}

      {/* 4 output handles for each stem */}
      {STEM_CONFIG.map((stem, i) => (
        <Handle
          key={stem.key}
          type="source"
          position={Position.Right}
          id={stem.key}
          style={{
            top: `${25 + i * 20}%`,
            backgroundColor: data.status === 'complete' ? stem.color : '#4b5563',
          }}
          className="!w-2.5 !h-2.5 !border-2 !border-gray-900 transition-colors"
          title={stem.label}
        />
      ))}
    </div>
  );
}
