'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { MeterData, NODE_WIDTH, NODE_HEIGHT_LG } from './types';

// 20 segments for the meter
const SEGMENT_COUNT = 20;

// Color thresholds (from bottom to top)
// Green: 0-60%, Yellow: 60-80%, Red: 80-100%
function getSegmentColor(segmentIndex: number, isLit: boolean): string {
  if (!isLit) return '#1f2937'; // gray-800 for unlit

  const percent = (segmentIndex / SEGMENT_COUNT) * 100;

  if (percent >= 80) {
    return '#ef4444'; // red-500
  } else if (percent >= 60) {
    return '#f59e0b'; // amber-500
  } else {
    return '#22c55e'; // green-500
  }
}

export function MeterNode({ data }: NodeProps<MeterData>) {
  const value = data.value || 0;
  const litSegments = Math.round(value * SEGMENT_COUNT);

  // Create segments array (bottom to top)
  const segments = Array.from({ length: SEGMENT_COUNT }, (_, i) => ({
    index: i,
    isLit: i < litSegments,
  }));

  return (
    <div
      className="bg-gray-900 border-2 border-gray-700 rounded-lg p-3"
      style={{ width: NODE_WIDTH * 0.6, height: NODE_HEIGHT_LG }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-gray-900 !bg-gray-400"
      />

      <div className="text-xs text-gray-400 uppercase tracking-wide mb-2 text-center">
        {data.label || 'Meter'}
      </div>

      {/* Segmented meter */}
      <div className="flex flex-col items-center h-[calc(100%-40px)]">
        <div className="w-10 flex-1 bg-black rounded p-1 flex flex-col-reverse gap-[2px]">
          {segments.map((seg) => (
            <div
              key={seg.index}
              className="w-full flex-1 rounded-sm transition-colors duration-75"
              style={{
                backgroundColor: getSegmentColor(seg.index, seg.isLit),
                boxShadow: seg.isLit ? `0 0 4px ${getSegmentColor(seg.index, true)}` : 'none',
              }}
            />
          ))}
        </div>

        {/* dB scale markers on the side */}
        <div className="flex justify-between w-full mt-1 px-1">
          <div className="text-[8px] text-gray-600 font-mono">-∞</div>
          <div className="text-[8px] text-gray-600 font-mono">0</div>
        </div>

        <div className="text-xs text-gray-400 font-mono mt-1">
          {value > 0 ? (20 * Math.log10(value)).toFixed(0) : '-∞'} dB
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !border-gray-900 !bg-gray-400"
      />
    </div>
  );
}
