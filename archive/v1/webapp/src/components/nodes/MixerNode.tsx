'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { MixerData, STEM_CONFIG, NODE_WIDTH, NODE_HEIGHT_LG } from './types';

export function MixerNode({ data }: NodeProps<MixerData>) {
  const output = data.outputValue || 0;
  const inputs = data.inputValues || { bass: 0, drums: 0, vocals: 0, other: 0 };

  // Size of pulsating preview
  const previewSize = 20 + output * 40;

  return (
    <div
      className="bg-gray-900 border-2 border-pink-600 rounded-lg p-4"
      style={{ width: NODE_WIDTH * 1.2, height: NODE_HEIGHT_LG }}
    >
      {/* 4 input handles */}
      {STEM_CONFIG.map((stem, i) => (
        <Handle
          key={`in-${stem.key}`}
          type="target"
          position={Position.Left}
          id={stem.key}
          style={{ top: `${20 + i * 20}%`, backgroundColor: stem.color }}
          className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
          title={stem.label}
        />
      ))}

      <div className="text-xs text-pink-500 uppercase tracking-wide mb-3">Mixer</div>

      {/* Input levels */}
      <div className="space-y-1 mb-3">
        {STEM_CONFIG.map((stem) => {
          const val = inputs[stem.key] || 0;
          const weight = data[`${stem.key}Weight` as keyof MixerData] as number || 0;
          return (
            <div key={stem.key} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: stem.color }} />
              <div className="flex-1 h-1 bg-gray-800 rounded overflow-hidden">
                <div
                  className="h-full transition-all duration-75"
                  style={{ width: `${val * 100}%`, backgroundColor: stem.color, opacity: 0.6 }}
                />
              </div>
              <span className="text-[10px] text-gray-600 w-6">{(weight * 100).toFixed(0)}%</span>
            </div>
          );
        })}
      </div>

      {/* Output preview - pulsating dot */}
      <div className="flex items-center justify-center h-16 bg-black rounded relative overflow-hidden">
        <div
          className="absolute rounded-full transition-all duration-75"
          style={{
            width: previewSize * 1.5,
            height: previewSize * 1.5,
            backgroundColor: '#fff',
            opacity: output * 0.15,
            filter: `blur(${10 + output * 15}px)`,
          }}
        />
        <div
          className="rounded-full bg-white transition-all duration-75"
          style={{
            width: previewSize,
            height: previewSize,
            opacity: 0.3 + output * 0.7,
            boxShadow: `0 0 ${output * 30}px rgba(255,255,255,0.5)`,
          }}
        />
      </div>

      {/* Envelope settings */}
      <div className="mt-2 flex justify-between text-[10px] text-gray-500">
        <span>A:{data.attackMs}ms</span>
        <span className="text-pink-400 font-mono">{(output * 100).toFixed(0)}</span>
        <span>R:{data.releaseMs}ms</span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-pink-500 !w-3 !h-3 !border-2 !border-gray-900"
      />
    </div>
  );
}
