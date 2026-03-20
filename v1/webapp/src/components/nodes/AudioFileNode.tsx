'use client';

import { useRef } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import { AudioFileData, NODE_WIDTH, NODE_HEIGHT_SM } from './types';

export function AudioFileNode({ data }: NodeProps<AudioFileData>) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      data.onFileSelect(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      data.onFileSelect(file);
    }
  };

  return (
    <div
      className="bg-gray-900 border-2 border-gray-600 rounded-lg p-4 cursor-pointer hover:border-gray-500 transition-colors"
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_SM }}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!bg-blue-500 !w-3 !h-3 !border-2 !border-gray-900"
      />

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        onChange={handleChange}
        className="hidden"
      />

      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Source</div>

      {data.isLoading ? (
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-gray-400">Loading...</span>
        </div>
      ) : data.fileName ? (
        <div className="text-sm font-semibold text-white truncate">
          {data.fileName}
        </div>
      ) : (
        <div className="text-sm text-gray-400">
          Click or drop audio
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!bg-amber-500 !w-3 !h-3 !border-2 !border-gray-900"
      />
    </div>
  );
}
