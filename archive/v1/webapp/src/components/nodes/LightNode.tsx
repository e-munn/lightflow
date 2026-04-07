'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { LightData, NODE_WIDTH, NODE_HEIGHT_LG } from './types';

export function LightNode({ data }: NodeProps<LightData>) {
  const value = data.value || 0;
  const color = data.color || '#ffffff';

  // Size ranges from 20 to 80 based on value
  const minSize = 20;
  const maxSize = 80;
  const size = minSize + value * (maxSize - minSize);

  return (
    <div
      className="bg-black border-2 border-cyan-500 rounded-lg flex flex-col items-center justify-center relative"
      style={{ width: NODE_WIDTH * 0.7, height: NODE_HEIGHT_LG * 0.8 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: color }}
      />

      {/* Glow */}
      <div
        className="absolute rounded-full transition-all duration-75"
        style={{
          width: size * 1.5,
          height: size * 1.5,
          backgroundColor: color,
          opacity: value * 0.4,
          filter: `blur(${15 + value * 25}px)`,
        }}
      />

      {/* Inner circle */}
      <div
        className="rounded-full transition-all duration-75"
        style={{
          width: size,
          height: size,
          backgroundColor: color,
          opacity: 0.4 + value * 0.6,
        }}
      />

      {/* Label */}
      <div className="absolute bottom-2 text-xs text-cyan-600">
        {data.label || 'Light'}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
