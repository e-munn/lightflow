'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { SmootherData, NODE_WIDTH, NODE_HEIGHT_MD } from './types';

// Beat division options: factor value -> label
const BEAT_DIVISIONS = [
  { factor: 16, label: '1/16' },
  { factor: 8, label: '1/8' },
  { factor: 4, label: '1/4' },
  { factor: 2, label: '1/2' },
  { factor: 1, label: '1' },
];

function getFactorIndex(factor: number): number {
  const idx = BEAT_DIVISIONS.findIndex(d => d.factor === factor);
  return idx >= 0 ? idx : 0;
}

function getFactorLabel(factor: number): string {
  const div = BEAT_DIVISIONS.find(d => d.factor === factor);
  return div?.label || '1/16';
}

export function SmootherNode({ data }: NodeProps<SmootherData>) {
  const bpm = data.bpm;
  const bpmFactor = data.bpmFactor || 16;

  // If BPM is connected, calculate timing from BPM; otherwise use manual values
  const beatMs = bpm ? Math.round(60000 / bpm) : null;
  const attack = beatMs ? Math.round(beatMs / bpmFactor) : (data.attackMs || 30);
  const release = beatMs ? beatMs : (data.releaseMs || 400);

  const color = data.color || '#f59e0b';
  const inputVal = data.inputValue || 0;
  const outputVal = data.outputValue || 0;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const idx = parseInt(e.target.value, 10);
    const newFactor = BEAT_DIVISIONS[idx].factor;
    data.onBpmFactorChange?.(newFactor);
  };

  return (
    <div
      className="bg-gray-900 border-2 border-amber-600 rounded-lg p-3"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD }}
    >
      {/* Signal input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="signal"
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: color, top: '25%' }}
      />

      {/* BPM input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="bpm"
        className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
        style={{ backgroundColor: '#ec4899', top: '45%' }}
        title="BPM"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-amber-500 uppercase tracking-wide">Smoother</div>
        <div className="flex items-center gap-1">
          {bpm && <span className="text-xs text-pink-500 font-mono">{Math.round(bpm)}</span>}
          <span className="text-xs text-gray-500 font-mono">{attack}/{release}ms</span>
        </div>
      </div>

      {/* Beat division slider */}
      <div className="mb-2 nodrag nopan">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Attack</span>
          <span className={`text-[10px] font-mono ${bpm ? 'text-amber-400' : 'text-gray-600'}`}>
            {getFactorLabel(bpmFactor)} beat
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={BEAT_DIVISIONS.length - 1}
          step={1}
          value={getFactorIndex(bpmFactor)}
          onChange={handleSliderChange}
          disabled={!bpm}
          className={`nodrag nopan w-full h-1.5 rounded-lg appearance-none
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-3
                     [&::-webkit-slider-thumb]:h-3
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:cursor-pointer
                     ${bpm
                       ? 'bg-gray-700 cursor-pointer [&::-webkit-slider-thumb]:bg-amber-500 [&::-webkit-slider-thumb]:hover:bg-amber-400'
                       : 'bg-gray-800 cursor-not-allowed [&::-webkit-slider-thumb]:bg-gray-600'}`}
        />
        {!bpm && (
          <div className="text-[9px] text-gray-600 mt-0.5">Connect BPM to enable</div>
        )}
      </div>

      {/* Mini visualization: input vs output */}
      <div className="flex items-end gap-1 h-6">
        <div className="flex-1 h-full bg-gray-800 rounded overflow-hidden flex items-end">
          <div
            className="w-full transition-all duration-75"
            style={{ height: `${inputVal * 100}%`, backgroundColor: color, opacity: 0.4 }}
          />
        </div>
        <div className="text-gray-600 text-xs">→</div>
        <div className="flex-1 h-full bg-gray-800 rounded overflow-hidden flex items-end">
          <div
            className="w-full transition-all duration-75"
            style={{ height: `${outputVal * 100}%`, backgroundColor: color }}
          />
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}
