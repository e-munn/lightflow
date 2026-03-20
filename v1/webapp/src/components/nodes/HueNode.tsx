'use client';

import { Handle, Position, NodeProps } from 'reactflow';
import { HueData, NODE_WIDTH, NODE_HEIGHT_MD } from './types';
import { Wifi, WifiOff, Lightbulb, ChevronDown } from 'lucide-react';
import { useState } from 'react';

export function HueNode({ data }: NodeProps<HueData>) {
  const [showLightPicker, setShowLightPicker] = useState(false);
  const value = data.inputValue || 0;

  const statusColor = {
    disconnected: 'border-gray-600',
    connecting: 'border-yellow-500',
    connected: 'border-emerald-500',
    error: 'border-red-500',
  }[data.status];

  const statusIcon = data.status === 'connected' ? (
    <Wifi className="w-3 h-3 text-emerald-400" />
  ) : (
    <WifiOff className="w-3 h-3 text-gray-500" />
  );

  return (
    <div
      className={`bg-gray-900 border-2 rounded-lg p-3 transition-colors ${statusColor}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT_MD + 30 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !border-2 !border-gray-900"
        style={{ backgroundColor: '#f59e0b' }}
        title="Brightness input (0-1)"
      />

      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-xs text-amber-400 uppercase tracking-wide">Hue</span>
        </div>
        {statusIcon}
      </div>

      {data.status === 'disconnected' && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">Not connected</div>
          <button
            onClick={() => data.onConnect?.()}
            className="w-full px-2 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 text-xs rounded transition-colors"
          >
            Connect to Bridge
          </button>
        </div>
      )}

      {data.status === 'connecting' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-yellow-400">Connecting...</span>
          </div>
          {data.statusText && (
            <div className="text-[10px] text-gray-500">{data.statusText}</div>
          )}
        </div>
      )}

      {data.status === 'connected' && (
        <div className="space-y-2">
          {/* Bridge info */}
          <div className="text-[10px] text-gray-500 truncate">
            {data.bridgeName || data.bridgeIp}
          </div>

          {/* Light selector */}
          <div className="relative">
            <button
              onClick={() => setShowLightPicker(!showLightPicker)}
              className="w-full flex items-center justify-between px-2 py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-xs text-white transition-colors"
            >
              <span className="truncate">
                {data.selectedLightName || 'Select light...'}
              </span>
              <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
            </button>

            {showLightPicker && data.lights.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                {data.lights.map((light) => (
                  <button
                    key={light.id}
                    onClick={() => {
                      data.onSelectLight?.(light.id);
                      setShowLightPicker(false);
                    }}
                    className={`w-full px-2 py-1.5 text-left text-xs hover:bg-gray-700 transition-colors flex items-center gap-2 ${
                      light.id === data.selectedLightId ? 'bg-gray-700 text-amber-400' : 'text-white'
                    } ${!light.reachable ? 'opacity-50' : ''}`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${light.on ? 'bg-amber-400' : 'bg-gray-600'}`}
                    />
                    <span className="truncate">{light.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Brightness indicator + Test button */}
          {data.selectedLightId && (
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[10px]">
                <span className="text-gray-500">Brightness</span>
                <div className="flex items-center gap-2">
                  <span className="text-amber-400">{Math.round(value * 100)}%</span>
                  <button
                    onClick={() => data.onTest?.()}
                    className="px-1.5 py-0.5 bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 text-[10px] rounded transition-colors"
                    title="Toggle light on/off"
                  >
                    Test
                  </button>
                </div>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-400 rounded-full transition-all duration-75"
                  style={{ width: `${value * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {data.status === 'error' && (
        <div className="space-y-2">
          <div className="text-xs text-red-400 truncate">
            {data.statusText || 'Connection error'}
          </div>
          <button
            onClick={() => data.onConnect?.()}
            className="w-full px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs rounded transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Output handle for pass-through chaining */}
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !border-2 !border-gray-900"
        style={{ backgroundColor: '#f59e0b' }}
        title="Pass-through output"
      />
    </div>
  );
}
