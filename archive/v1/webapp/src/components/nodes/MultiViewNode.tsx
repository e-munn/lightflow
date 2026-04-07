'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { MultiViewData, CHANNEL_COLORS, NODE_HEIGHT_LG } from './types';

export function MultiViewNode({ data }: NodeProps<MultiViewData>) {
  const channelCount = data.channelCount || 2;
  const values = data.values || [0, 0, 0, 0];
  const colors = data.colors || CHANNEL_COLORS;

  // Size calculation for each light
  const minSize = 16;
  const maxSize = 50;

  return (
    <div
      className="bg-black border-2 border-violet-600 rounded-lg p-3 flex flex-col"
      style={{ width: 60 + channelCount * 60, height: NODE_HEIGHT_LG }}
    >
      {/* 4 input handles */}
      {[0, 1, 2, 3].map((i) => (
        <Handle
          key={`ch-${i}`}
          type="target"
          position={Position.Left}
          id={`ch${i + 1}`}
          style={{
            top: `${20 + i * 20}%`,
            backgroundColor: i < channelCount ? CHANNEL_COLORS[i] : '#374151',
            opacity: i < channelCount ? 1 : 0.3,
          }}
          className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
          title={`Channel ${i + 1}`}
        />
      ))}

      <div className="text-xs text-violet-400 uppercase tracking-wide mb-2">Multi View</div>

      {/* Channel count slider */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] text-gray-500">Channels</span>
        <input
          type="range"
          min={1}
          max={4}
          step={1}
          value={channelCount}
          className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
          onChange={(e) => data.onChannelCountChange?.(parseInt(e.target.value))}
        />
        <span className="text-xs text-violet-400 font-mono w-4">{channelCount}</span>
      </div>

      {/* Lights display - adaptive row */}
      <div className="flex-1 flex items-center justify-center gap-2 bg-gray-950 rounded relative overflow-hidden">
        {Array.from({ length: channelCount }).map((_, i) => {
          const value = values[i] || 0;
          const size = minSize + value * (maxSize - minSize);
          const color = colors[i] || CHANNEL_COLORS[i];

          return (
            <div key={i} className="relative flex items-center justify-center" style={{ width: 50, height: 80 }}>
              {/* Glow */}
              <div
                className="absolute rounded-full transition-all duration-75"
                style={{
                  width: size * 1.6,
                  height: size * 1.6,
                  backgroundColor: color,
                  opacity: value * 0.2,
                  filter: `blur(${10 + value * 15}px)`,
                }}
              />
              {/* Main dot */}
              <div
                className="rounded-full transition-all duration-75"
                style={{
                  width: size,
                  height: size,
                  backgroundColor: color,
                  opacity: 0.3 + value * 0.7,
                  boxShadow: `0 0 ${value * 25}px ${color}`,
                }}
              />
              {/* Core */}
              <div
                className="absolute rounded-full bg-white transition-all duration-75"
                style={{
                  width: size * 0.3,
                  height: size * 0.3,
                  opacity: value * 0.8,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Channel labels */}
      <div className="flex justify-center gap-2 mt-2">
        {Array.from({ length: channelCount }).map((_, i) => (
          <span
            key={i}
            className="text-[10px] font-mono"
            style={{ color: CHANNEL_COLORS[i], width: 50, textAlign: 'center' }}
          >
            {((values[i] || 0) * 100).toFixed(0)}
          </span>
        ))}
      </div>
    </div>
  );
}
