'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { RefreshCw } from 'lucide-react';
import { SongMetadataData, NODE_WIDTH, NODE_HEIGHT_MD } from './types';

export function SongMetadataNode({ data }: NodeProps<SongMetadataData>) {
  const isDetecting = data.status === 'detecting';
  const canRerun = data.status === 'complete' || data.status === 'error';
  const bpm = data.manualBpm ?? data.detectedBpm ?? null;
  const beatMs = bpm ? Math.round(60000 / bpm) : null;

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${
        data.status === 'error' ? 'border-red-600' :
        data.status === 'complete' ? 'border-pink-600' :
        isDetecting ? 'border-amber-500' : 'border-gray-600'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD }}
    >
      {/* Input handle for audio source */}
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-white !w-3 !h-3 !border-2 !border-gray-900"
        title="Audio input"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-pink-500 uppercase tracking-wide">BPM Detect</div>
        {isDetecting && (
          <div className="w-3 h-3 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        )}
        {canRerun && data.onRerun && (
          <button
            onClick={(e) => { e.stopPropagation(); data.onRerun?.(); }}
            className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 transition-colors"
            title="Re-detect BPM"
          >
            <RefreshCw className="w-3 h-3 text-gray-400 hover:text-white" />
          </button>
        )}
      </div>

      {data.status === 'idle' && (
        <div className="text-xs text-gray-500">Connect audio source...</div>
      )}

      {data.status === 'detecting' && (
        <div className="space-y-1">
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full w-full bg-gradient-to-r from-pink-500 to-amber-500 rounded-full animate-pulse" />
          </div>
          <div className="text-xs text-gray-500">{data.statusText || 'Analyzing tempo...'}</div>
        </div>
      )}

      {data.status === 'complete' && bpm && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-white font-mono">{bpm.toFixed(1)}</span>
              <span className="text-xs text-gray-500">BPM</span>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500">{beatMs}ms</div>
              <div className="text-[10px] text-pink-400/60">detected</div>
            </div>
          </div>
        </div>
      )}

      {data.status === 'error' && (
        <div className="text-xs text-red-400 truncate">{data.statusText || 'Detection failed'}</div>
      )}

      {(data.title || data.artist) && (
        <div className="mt-1 text-xs text-gray-500 truncate">
          {data.artist && <span>{data.artist}</span>}
          {data.artist && data.title && <span> - </span>}
          {data.title && <span>{data.title}</span>}
        </div>
      )}

      {/* BPM output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="bpm"
        className="!w-3 !h-3 !border-2 !border-gray-900 transition-colors"
        style={{
          backgroundColor: data.status === 'complete' ? '#ec4899' : '#4b5563',
          top: '50%'
        }}
        title="BPM"
      />
    </div>
  );
}
