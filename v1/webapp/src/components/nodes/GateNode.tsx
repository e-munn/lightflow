'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { GateData, NODE_WIDTH, NODE_HEIGHT_MD } from './types';

// Sensitivity presets for the slider
const SENSITIVITY_LABELS = ['Hard', '', 'Medium', '', 'Soft'];

export function GateNode({ data }: NodeProps<GateData>) {
  const bpm = data.bpm;
  const sensitivity = data.sensitivity ?? 0.5;
  const isOpen = data.isOpen ?? false;
  const threshold = data.threshold ?? 0.5;
  const inputVal = data.inputValue ?? 0;
  const outputVal = data.outputValue ?? 0;

  // Calculate timing display
  const attackMs = data.attackMs ?? 30;
  const releaseMs = data.releaseMs ?? 200;

  const handleSensitivityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    const value = parseFloat(e.target.value);
    data.onSensitivityChange?.(value);
  };

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${
        isOpen ? 'border-emerald-500' : 'border-violet-600'
      }`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD + 20 }}
    >
      {/* Signal input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="signal"
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#8b5cf6', top: '25%' }}
        title="Signal input"
      />

      {/* BPM input handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="bpm"
        className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
        style={{ backgroundColor: '#ec4899', top: '45%' }}
        title="BPM (optional)"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-xs text-violet-400 uppercase tracking-wide">Gate</div>
          {isOpen && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-[9px] text-emerald-400">OPEN</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {bpm && <span className="text-xs text-pink-500 font-mono">{Math.round(bpm)}</span>}
          <span className="text-xs text-gray-500 font-mono">{attackMs}/{releaseMs}ms</span>
        </div>
      </div>

      {/* Sensitivity slider */}
      <div className="mb-2 nodrag nopan">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Sensitivity</span>
          <span className="text-[10px] text-violet-400 font-mono">
            {sensitivity < 0.33 ? 'Hard' : sensitivity < 0.66 ? 'Medium' : 'Soft'}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sensitivity}
          onChange={handleSensitivityChange}
          className="nodrag nopan w-full h-1.5 rounded-lg appearance-none bg-gray-700 cursor-pointer
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-3
                     [&::-webkit-slider-thumb]:h-3
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-violet-500
                     [&::-webkit-slider-thumb]:hover:bg-violet-400
                     [&::-webkit-slider-thumb]:cursor-pointer"
        />
      </div>

      {/* Threshold indicator */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-gray-500">Threshold</span>
          <span className="text-[10px] text-gray-400 font-mono">{Math.round(threshold * 100)}%</span>
        </div>
        <div className="relative h-4 bg-gray-800 rounded overflow-hidden">
          {/* Input signal bar */}
          <div
            className="absolute bottom-0 left-0 right-0 transition-all duration-75"
            style={{
              height: `${inputVal * 100}%`,
              backgroundColor: isOpen ? '#22c55e' : '#6b7280',
              opacity: 0.6,
            }}
          />
          {/* Threshold line */}
          <div
            className="absolute left-0 right-0 h-0.5 bg-violet-400"
            style={{ bottom: `${threshold * 100}%` }}
          />
        </div>
      </div>

      {/* Output visualization */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-75"
            style={{
              width: `${outputVal * 100}%`,
              backgroundColor: isOpen ? '#22c55e' : '#4b5563',
            }}
          />
        </div>
        <span className="text-[10px] text-gray-400 font-mono w-8 text-right">
          {Math.round(outputVal * 100)}%
        </span>
      </div>

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#8b5cf6' }}
      />
    </div>
  );
}
