'use client';

import { useCallback, useMemo, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Handle,
  Position,
  NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { AudioAnalysis, TimeSeriesPoint } from '@/types/analysis';
import { StemSeparationResult } from '@/lib/api';

interface FlowEditorProps {
  analysis?: AudioAnalysis | null;
  stems?: StemSeparationResult | null;
  currentTime?: number;
}

// Get value at time from time series
function getValueAtTime(data: TimeSeriesPoint[] | undefined, time: number): number {
  if (!data || data.length === 0) return 0;
  for (let i = 0; i < data.length - 1; i++) {
    if (data[i + 1].time > time) {
      const t0 = data[i].time;
      const t1 = data[i + 1].time;
      const v0 = data[i].value;
      const v1 = data[i + 1].value;
      const t = (time - t0) / (t1 - t0);
      return v0 + t * (v1 - v0);
    }
  }
  return data[data.length - 1].value;
}

// ============ CUSTOM NODES ============

// Source Node (stems, intensity)
function SourceNode({ data }: NodeProps<{ label: string; value: number; color: string }>) {
  return (
    <div className="bg-gray-900 border-2 rounded-lg p-3 min-w-[120px]" style={{ borderColor: data.color }}>
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Source</div>
      <div className="text-sm font-semibold text-white mb-2">{data.label}</div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full transition-all duration-75"
            style={{ width: `${data.value * 100}%`, backgroundColor: data.color }}
          />
        </div>
        <span className="text-xs text-gray-400 font-mono w-8">{(data.value * 100).toFixed(0)}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

// Processor Node (envelope, gain, etc.)
function ProcessorNode({ data }: NodeProps<{ label: string; type: string; params: Record<string, number> }>) {
  return (
    <div className="bg-gray-800 border border-gray-600 rounded-lg p-3 min-w-[140px]">
      <Handle type="target" position={Position.Left} className="!bg-gray-400 !w-3 !h-3" />
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Process</div>
      <div className="text-sm font-semibold text-white mb-2">{data.label}</div>
      <div className="space-y-1">
        {Object.entries(data.params).map(([key, value]) => (
          <div key={key} className="flex justify-between text-xs">
            <span className="text-gray-500">{key}</span>
            <span className="text-gray-400 font-mono">{value}</span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-gray-400 !w-3 !h-3" />
    </div>
  );
}

// Output Node (light channel)
function OutputNode({ data }: NodeProps<{ label: string; value: number; index: number }>) {
  const size = 20 + data.value * 40;
  return (
    <div className="bg-gray-900 border border-amber-500/50 rounded-lg p-3 min-w-[100px]">
      <Handle type="target" position={Position.Left} className="!bg-amber-400 !w-3 !h-3" />
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Output</div>
      <div className="text-sm font-semibold text-amber-400 mb-2">{data.label}</div>
      <div className="flex justify-center">
        <div
          className="rounded-full bg-white transition-all duration-75"
          style={{
            width: size,
            height: size,
            opacity: 0.3 + data.value * 0.7,
            boxShadow: `0 0 ${data.value * 30}px rgba(255,255,255,${data.value * 0.5})`,
          }}
        />
      </div>
    </div>
  );
}

// Blend Node (multiple inputs)
function BlendNode({ data }: NodeProps<{ label: string; weights: number[] }>) {
  return (
    <div className="bg-gray-800 border border-purple-500/50 rounded-lg p-3 min-w-[120px]">
      <Handle type="target" position={Position.Left} id="a" style={{ top: '30%' }} className="!bg-purple-400 !w-3 !h-3" />
      <Handle type="target" position={Position.Left} id="b" style={{ top: '50%' }} className="!bg-purple-400 !w-3 !h-3" />
      <Handle type="target" position={Position.Left} id="c" style={{ top: '70%' }} className="!bg-purple-400 !w-3 !h-3" />
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Blend</div>
      <div className="text-sm font-semibold text-purple-400 mb-2">{data.label}</div>
      <div className="text-xs text-gray-500">
        {data.weights.map((w, i) => `${(w * 100).toFixed(0)}%`).join(' / ')}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-purple-400 !w-3 !h-3" />
    </div>
  );
}

const nodeTypes = {
  source: SourceNode,
  processor: ProcessorNode,
  output: OutputNode,
  blend: BlendNode,
};

// ============ INITIAL FLOW ============

const initialNodes: Node[] = [
  // Sources
  { id: 'bass', type: 'source', position: { x: 50, y: 50 }, data: { label: 'Bass', value: 0, color: '#22c55e' } },
  { id: 'drums', type: 'source', position: { x: 50, y: 150 }, data: { label: 'Drums', value: 0, color: '#f59e0b' } },
  { id: 'vocals', type: 'source', position: { x: 50, y: 250 }, data: { label: 'Vocals', value: 0, color: '#3b82f6' } },

  // Processors
  { id: 'blend1', type: 'blend', position: { x: 250, y: 100 }, data: { label: 'Mix', weights: [0.5, 0.35, 0.15] } },
  { id: 'envelope1', type: 'processor', position: { x: 450, y: 100 }, data: { label: 'Envelope', type: 'envelope', params: { attack: 30, release: 400 } } },

  // Outputs
  { id: 'light1', type: 'output', position: { x: 650, y: 100 }, data: { label: 'Light 1', value: 0, index: 0 } },
];

const initialEdges: Edge[] = [
  { id: 'e-bass-blend', source: 'bass', target: 'blend1', targetHandle: 'a', animated: true, style: { stroke: '#22c55e' } },
  { id: 'e-drums-blend', source: 'drums', target: 'blend1', targetHandle: 'b', animated: true, style: { stroke: '#f59e0b' } },
  { id: 'e-vocals-blend', source: 'vocals', target: 'blend1', targetHandle: 'c', animated: true, style: { stroke: '#3b82f6' } },
  { id: 'e-blend-env', source: 'blend1', target: 'envelope1', animated: true, style: { stroke: '#a855f7' } },
  { id: 'e-env-light', source: 'envelope1', target: 'light1', animated: true, style: { stroke: '#fbbf24' } },
];

export function FlowEditor({ analysis, stems, currentTime = 0 }: FlowEditorProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Update source node values based on current stem values
  useEffect(() => {
    if (!stems?.stems) return;

    const bass = getValueAtTime(stems.stems.bass, currentTime);
    const drums = getValueAtTime(stems.stems.drums, currentTime);
    const vocals = getValueAtTime(stems.stems.vocals, currentTime);

    // Compute blended/output value
    const blended = bass * 0.5 + drums * 0.35 + vocals * 0.15;

    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === 'bass') return { ...node, data: { ...node.data, value: bass } };
        if (node.id === 'drums') return { ...node, data: { ...node.data, value: drums } };
        if (node.id === 'vocals') return { ...node, data: { ...node.data, value: vocals } };
        if (node.id === 'light1') return { ...node, data: { ...node.data, value: Math.min(1, blended) } };
        return node;
      })
    );
  }, [stems, currentTime, setNodes]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
    [setEdges]
  );

  return (
    <div className="w-full h-full bg-gray-950 rounded-lg overflow-hidden">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="!bg-gray-800 !border-gray-700 !rounded-lg" />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
      </ReactFlow>

      {/* Legend */}
      <div className="absolute top-4 right-4 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-3 text-xs">
        <div className="text-gray-500 uppercase tracking-wide mb-2">Legend</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-gray-400">Source</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-purple-500" />
            <span className="text-gray-400">Blend</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-gray-500" />
            <span className="text-gray-400">Process</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-500" />
            <span className="text-gray-400">Output</span>
          </div>
        </div>
      </div>

      {/* No stems warning */}
      {!stems?.stems && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
          <div className="text-gray-400">Waiting for stem separation...</div>
        </div>
      )}
    </div>
  );
}
