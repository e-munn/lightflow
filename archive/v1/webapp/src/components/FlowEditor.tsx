'use client';

import { useCallback, useRef, DragEvent, useEffect, useState } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  useReactFlow,
  ReactFlowProvider,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { Timer, GitFork, Waves, SlidersHorizontal, Gauge, Lightbulb, LayoutGrid, Drum, Headphones, Lamp, Zap, Sparkles } from 'lucide-react';
import { startStemSeparation, getStemSeparationStatus, detectBpm, API_URL, hueDiscover, hueConnect, hueGetLights, hueControl, hueStatus, generateShow, ShowConfig } from '@/lib/api';

// Import node components
import {
  AudioFileNode,
  StemAnalyzerNode,
  DrumAnalyzerNode,
  SmootherNode,
  GateNode,
  MeterNode,
  LightNode,
  MultiViewNode,
  MixerNode,
  SongMetadataNode,
  PlaybackNode,
  HueNode,
  ShowGeneratorNode,
  StemValues,
  StemTimeSeries,
  DrumValues,
  DrumTimeSeries,
  StemType,
  HueLight,
  CHANNEL_COLORS,
} from './nodes';

// ============ SESSION STORAGE ============
const FLOW_STORAGE_KEY = 'lightflow_graph_state';

interface SavedFlowState {
  nodes: Array<{ id: string; type: string; position: { x: number; y: number } }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
}

function saveFlowState(nodes: Node[], edges: Edge[]) {
  if (typeof window === 'undefined') return;
  try {
    const state: SavedFlowState = {
      nodes: nodes.map(n => ({ id: n.id, type: n.type!, position: n.position })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
      })),
    };
    sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Failed to save flow state:', err);
  }
}

function loadFlowState(): SavedFlowState | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(FLOW_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.warn('Failed to load flow state:', err);
  }
  return null;
}

// Default data for new nodes (must be before getInitialState)
function getDefaultData(type: string): Record<string, unknown> {
  switch (type) {
    case 'stemAnalyzer':
      return { status: 'idle', progress: 0, stems: null, stemTimeSeries: null };
    case 'drumAnalyzer':
      return { status: 'idle', progress: 0, drums: null, drumTimeSeries: null };
    case 'smoother':
      return { inputValue: 0, outputValue: 0, attackMs: 30, releaseMs: 400, color: '#f59e0b', bpmFactor: 16 };
    case 'gate':
      return { inputValue: 0, outputValue: 0, threshold: 0.5, isOpen: false, attackMs: 30, releaseMs: 200, minHoldMs: 80, retriggerMs: 50, sensitivity: 0.5, autoThreshold: true };
    case 'mixer':
      return { bassWeight: 0.5, drumsWeight: 0.35, vocalsWeight: 0.15, otherWeight: 0, attackMs: 30, releaseMs: 400, inputValues: null, outputValue: 0 };
    case 'meter':
      return { label: 'Meter', value: 0, color: '#22d3ee' };
    case 'light':
      return { label: 'Light', value: 0, color: '#ffffff' };
    case 'multiView':
      return { channelCount: 2, values: [0, 0, 0, 0], colors: CHANNEL_COLORS };
    case 'songMetadata':
      return { status: 'idle', detectedBpm: null };
    case 'playback':
      return { stemType: null, stemUrl: null, isActive: false, inputValue: 0 };
    case 'hue':
      return { status: 'disconnected', bridgeIp: null, bridgeName: null, selectedLightId: null, selectedLightName: null, lights: [], inputValue: 0 };
    case 'showGenerator':
      return { status: 'idle', statusText: undefined, showName: undefined, sectionCount: undefined, analysisData: undefined };
    default:
      return {};
  }
}

// ============ UTILS ============

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ============ PLAYBACK BAR ============

interface PlaybackBarProps {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  fileName?: string | null;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
}

function PlaybackBar({ currentTime, duration, isPlaying, fileName, onPlay, onPause, onSeek }: PlaybackBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTime, setDragTime] = useState<number | null>(null);

  const displayTime = dragTime ?? currentTime;
  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  const calculateTimeFromEvent = useCallback((clientX: number) => {
    if (!trackRef.current || duration <= 0) return null;
    const rect = trackRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return percent * duration;
  }, [duration]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!duration) return;
    e.preventDefault();
    setIsDragging(true);
    const time = calculateTimeFromEvent(e.clientX);
    if (time !== null) {
      setDragTime(time);
    }
  }, [duration, calculateTimeFromEvent]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const time = calculateTimeFromEvent(e.clientX);
      if (time !== null) {
        setDragTime(time);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      const time = calculateTimeFromEvent(e.clientX);
      if (time !== null) {
        onSeek?.(time);
      }
      setIsDragging(false);
      setDragTime(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, calculateTimeFromEvent, onSeek]);

  return (
    <div className="absolute bottom-0 left-0 right-0 flex justify-center p-4 pb-6">
      <div className={`w-full max-w-2xl bg-gray-900/95 backdrop-blur-sm border border-gray-800 rounded-xl flex items-center px-5 py-3 gap-4 transition-opacity ${fileName ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
        {/* Play/Pause Button */}
        <button
          onClick={() => isPlaying ? onPause?.() : onPlay?.()}
          disabled={!fileName}
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:bg-white/5 flex items-center justify-center transition-colors shrink-0"
        >
          {isPlaying ? (
            <div className="flex gap-1">
              <div className="w-1 h-4 bg-white rounded" />
              <div className="w-1 h-4 bg-white rounded" />
            </div>
          ) : (
            <div className="w-0 h-0 border-l-[10px] border-l-white border-y-[6px] border-y-transparent ml-1" />
          )}
        </button>

        {/* Current Time */}
        <span className="text-xs text-gray-400 font-mono w-12 shrink-0">
          {formatTime(displayTime)}
        </span>

        {/* Scrubber Track */}
        <div
          ref={trackRef}
          className={`flex-1 h-2 bg-gray-800 rounded-full cursor-pointer group min-w-0 relative ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
          onMouseDown={handleMouseDown}
        >
          {/* Progress Fill */}
          <div
            className={`h-full rounded-full transition-colors ${isDragging ? 'bg-white' : 'bg-white/60 group-hover:bg-white/80'}`}
            style={{ width: `${progress}%` }}
          />

          {/* Playhead */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg transition-transform ${isDragging ? 'scale-125' : 'scale-100 group-hover:scale-110'}`}
            style={{ left: `calc(${progress}% - 8px)` }}
          />

          {/* Hover time tooltip */}
          {isDragging && dragTime !== null && (
            <div
              className="absolute -top-8 bg-gray-800 text-white text-xs px-2 py-1 rounded -translate-x-1/2 pointer-events-none"
              style={{ left: `${progress}%` }}
            >
              {formatTime(dragTime)}
            </div>
          )}
        </div>

        {/* Duration */}
        <span className="text-xs text-gray-400 font-mono w-12 text-right shrink-0">
          {formatTime(duration)}
        </span>

        {/* File Name */}
        <div className="text-xs text-gray-500 truncate max-w-32 shrink-0">
          {fileName || 'No audio'}
        </div>
      </div>
    </div>
  );
}

function getValueAtTime(data: { time: number; value: number }[] | undefined, time: number): number {
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

// ============ NODE TYPES ============

const nodeTypes = {
  audioFile: AudioFileNode,
  stemAnalyzer: StemAnalyzerNode,
  drumAnalyzer: DrumAnalyzerNode,
  smoother: SmootherNode,
  gate: GateNode,
  meter: MeterNode,
  light: LightNode,
  mixer: MixerNode,
  multiView: MultiViewNode,
  songMetadata: SongMetadataNode,
  playback: PlaybackNode,
  hue: HueNode,
  showGenerator: ShowGeneratorNode,
};

// ============ SIDEBAR CONFIG ============

// Color scheme:
// - Analyzers (emerald): stemAnalyzer, drumAnalyzer
// - Modifiers (amber): smoother
// - Mixer (pink): mixer
// - BPM (pink): songMetadata
// - Visualizers (cyan): meter
// - Light (amber): light
// - MultiView (violet): multiView
const nodeTemplates = [
  { type: 'songMetadata', label: 'BPM Detect', icon: Timer, borderColor: 'rgba(236, 72, 153, 0.5)', iconColor: '#ec4899' },      // pink
  { type: 'stemAnalyzer', label: 'Stem Analyzer', icon: GitFork, borderColor: 'rgba(16, 185, 129, 0.5)', iconColor: '#10b981' }, // emerald
  { type: 'drumAnalyzer', label: 'Drum Analyzer', icon: Drum, borderColor: 'rgba(16, 185, 129, 0.5)', iconColor: '#10b981' },    // emerald (same as stem)
  { type: 'playback', label: 'Isolate', icon: Headphones, borderColor: 'rgba(139, 92, 246, 0.5)', iconColor: '#8b5cf6' },        // violet
  { type: 'smoother', label: 'Smoother', icon: Waves, borderColor: 'rgba(245, 158, 11, 0.5)', iconColor: '#f59e0b' },            // amber
  { type: 'gate', label: 'Gate', icon: Zap, borderColor: 'rgba(139, 92, 246, 0.5)', iconColor: '#8b5cf6' },                      // violet
  { type: 'mixer', label: 'Mixer', icon: SlidersHorizontal, borderColor: 'rgba(236, 72, 153, 0.5)', iconColor: '#ec4899' },      // pink
  { type: 'meter', label: 'Meter', icon: Gauge, borderColor: 'rgba(6, 182, 212, 0.5)', iconColor: '#06b6d4' },                   // cyan
  { type: 'light', label: 'Light', icon: Lightbulb, borderColor: 'rgba(6, 182, 212, 0.5)', iconColor: '#06b6d4' },               // cyan
  { type: 'hue', label: 'Hue Light', icon: Lamp, borderColor: 'rgba(245, 158, 11, 0.5)', iconColor: '#f59e0b' },                 // amber
  { type: 'multiView', label: 'Multi View', icon: LayoutGrid, borderColor: 'rgba(139, 92, 246, 0.5)', iconColor: '#8b5cf6' },    // violet
  { type: 'showGenerator', label: 'AI Show', icon: Sparkles, borderColor: 'rgba(168, 85, 247, 0.5)', iconColor: '#a855f7' },     // purple
];

// ============ INITIAL STATE ============

const initialNodes: Node[] = [
  { id: 'audio-source', type: 'audioFile', position: { x: 100, y: 150 }, data: { fileName: null, duration: null, isLoading: false, onFileSelect: () => {} } },
  { id: 'stem-analyzer-1', type: 'stemAnalyzer', position: { x: 350, y: 130 }, data: { status: 'idle', progress: 0, stems: null } },
  { id: 'smoother-bass', type: 'smoother', position: { x: 600, y: 50 }, data: { inputValue: 0, outputValue: 0, attackMs: 30, releaseMs: 400, color: '#22c55e' } },
  { id: 'light-1', type: 'light', position: { x: 850, y: 30 }, data: { label: 'Bass', value: 0, color: '#ffffff' } },
  { id: 'meter-drums', type: 'meter', position: { x: 600, y: 180 }, data: { label: 'Drums', value: 0, color: '#f59e0b' } },
  { id: 'meter-vocals', type: 'meter', position: { x: 730, y: 180 }, data: { label: 'Vocals', value: 0, color: '#3b82f6' } },
];

const initialEdges: Edge[] = [
  { id: 'e-source-stem', source: 'audio-source', target: 'stem-analyzer-1', animated: true },
  { id: 'e-bass-smooth', source: 'stem-analyzer-1', sourceHandle: 'bass', target: 'smoother-bass', animated: true, style: { stroke: '#22c55e' } },
  { id: 'e-smooth-light', source: 'smoother-bass', target: 'light-1', animated: true, style: { stroke: '#22c55e' } },
  { id: 'e-drums', source: 'stem-analyzer-1', sourceHandle: 'drums', target: 'meter-drums', animated: true, style: { stroke: '#f59e0b' } },
  { id: 'e-vocals', source: 'stem-analyzer-1', sourceHandle: 'vocals', target: 'meter-vocals', animated: true, style: { stroke: '#3b82f6' } },
];

let nodeId = 0;
const getNodeId = () => `node_${nodeId++}`;

// Build initial state from saved or defaults
function getInitialState(): { nodes: Node[]; edges: Edge[] } {
  const saved = loadFlowState();

  if (saved && saved.nodes.length > 0) {
    // Restore nodes with saved positions and default data
    const nodes: Node[] = saved.nodes.map(savedNode => ({
      id: savedNode.id,
      type: savedNode.type,
      position: savedNode.position,
      data: savedNode.id === 'audio-source'
        ? { fileName: null, duration: null, isLoading: false, onFileSelect: () => {} }
        : getDefaultData(savedNode.type),
    }));

    // Restore edges with styling
    const edges: Edge[] = saved.edges.map(savedEdge => ({
      ...savedEdge,
      animated: true,
      style: getEdgeStyle(savedEdge.sourceHandle),
    }));

    // Update nodeId counter to avoid collisions
    const maxId = saved.nodes
      .map(n => n.id.match(/^node_(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number)
      .reduce((max, n) => Math.max(max, n), 0);
    nodeId = maxId + 1;

    return { nodes, edges };
  }

  return { nodes: initialNodes, edges: initialEdges };
}

// Color constants for edges and node handles
export const EDGE_COLORS: Record<string, string> = {
  // Stem analyzer outputs - cyan hues
  bass: '#67e8f9',   // cyan-300
  drums: '#22d3ee',  // cyan-400
  vocals: '#06b6d4', // cyan-500
  other: '#0891b2',  // cyan-600
  // BPM output - pink
  bpm: '#ec4899',    // pink-500
  // Drum analyzer outputs - cyan (same theme as stems)
  kick: '#67e8f9',   // cyan-300
  snare: '#22d3ee',  // cyan-400
  hats: '#06b6d4',   // cyan-500
};

function getEdgeStyle(sourceHandle?: string): React.CSSProperties | undefined {
  const baseStyle: React.CSSProperties = { strokeWidth: 2.5 };
  if (sourceHandle && EDGE_COLORS[sourceHandle]) {
    return { ...baseStyle, stroke: EDGE_COLORS[sourceHandle] };
  }
  return baseStyle;
}

// ============ FLOW EDITOR ============

interface FlowEditorProps {
  onFileSelect?: (file: File) => void;
  audioFile?: File | null;
  audioFileName?: string | null;
  audioDuration?: number | null;
  currentTime?: number;
  isPlaying?: boolean;
  isLoading?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (time: number) => void;
  onIsolateChange?: (stemUrl: string | null, stemType: string | null) => void;
}

interface SmootherState {
  value: number;
  lastTime: number;
}

interface GateState {
  envelopeValue: number;      // Current envelope output (0-1)
  isOpen: boolean;            // Is gate currently triggered
  lastOpenTime: number;       // When gate last opened (ms)
  lastCloseTime: number;      // When gate last closed (ms)
  lastTime: number;           // Last update time (ms)
  recentMin: number;          // Recent minimum for auto-threshold
  recentMax: number;          // Recent maximum for auto-threshold
  threshold: number;          // Current calculated threshold
}

function FlowEditorInner({
  onFileSelect,
  audioFile,
  audioFileName,
  audioDuration,
  currentTime = 0,
  isPlaying = false,
  isLoading = false,
  onPlay,
  onPause,
  onSeek,
  onIsolateChange,
}: FlowEditorProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Bluetooth/wireless audio latency compensation (seconds)
  // AirPods typically add ~150-200ms delay - adjust as needed
  const VISUAL_DELAY_SEC = 0.15;
  const adjustedTime = Math.max(0, currentTime - VISUAL_DELAY_SEC);

  // Hue lights need to look AHEAD to compensate for API + bridge + bulb latency
  // Total Hue latency: ~200ms (API ~50ms + bridge ~100ms + bulb ~50ms)
  const HUE_LOOKAHEAD_SEC = 0.20;
  const hueTime = currentTime + HUE_LOOKAHEAD_SEC;

  // Load initial state from sessionStorage or use defaults
  const [initialState] = useState(() => getInitialState());
  const [nodes, setNodes, onNodesChange] = useNodesState(initialState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialState.edges);

  const { screenToFlowPosition } = useReactFlow();
  const processingRef = useRef<Set<string>>(new Set());
  const smootherStateRef = useRef<Map<string, SmootherState>>(new Map());
  const gateStateRef = useRef<Map<string, GateState>>(new Map());

  // Track which isolate node is currently active (only one at a time)
  const [activeIsolateId, setActiveIsolateId] = useState<string | null>(null);
  const [pendingIsolate, setPendingIsolate] = useState<{ stemUrl: string | null; stemType: string | null } | null>(null);

  // Hue bridge connection state (shared across all Hue nodes)
  const [hueBridgeIp, setHueBridgeIp] = useState<string | null>(null);
  const [hueBridgeName, setHueBridgeName] = useState<string | null>(null);
  const [hueLights, setHueLights] = useState<HueLight[]>([]);
  const [hueConnecting, setHueConnecting] = useState(false);
  const hueLastBrightnessRef = useRef<Map<number, number>>(new Map());

  // LLM-generated show config (shared across show generator nodes)
  const [activeShowConfig, setActiveShowConfig] = useState<ShowConfig | null>(null);

  // Save to sessionStorage when nodes/edges change (debounced)
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveFlowState(nodes, edges);
    }, 500); // Debounce 500ms

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [nodes, edges]);

  // Update node data helper
  const updateNodeData = useCallback((nodeId: string, data: Record<string, unknown>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...data } } : node
      )
    );
  }, [setNodes]);

  // Handle isolate toggle - only one can be active at a time
  const handleIsolateToggle = useCallback((nodeId: string, stemUrl: string | null, stemType: string | null) => {
    setActiveIsolateId(prev => {
      const newActiveId = prev === nodeId ? null : nodeId;
      // Schedule the parent notification via pending state (avoids state update during render)
      if (newActiveId) {
        setPendingIsolate({ stemUrl, stemType });
      } else {
        setPendingIsolate({ stemUrl: null, stemType: null });
      }
      return newActiveId;
    });
  }, []);

  // Effect to notify parent of isolate changes (avoids calling during render)
  useEffect(() => {
    if (pendingIsolate !== null) {
      onIsolateChange?.(pendingIsolate.stemUrl, pendingIsolate.stemType);
      setPendingIsolate(null);
    }
  }, [pendingIsolate, onIsolateChange]);

  // Handle Hue bridge connection
  const handleHueConnect = useCallback(async (nodeId: string) => {
    if (hueConnecting) return;
    setHueConnecting(true);
    updateNodeData(nodeId, { status: 'connecting', statusText: 'Discovering bridges...' });

    try {
      // First check if already connected
      const statusResult = await hueStatus();
      if (statusResult.connected && statusResult.bridge_name) {
        // Already connected, just fetch lights
        const lightsResult = await hueGetLights();
        if (lightsResult.success && lightsResult.lights) {
          setHueBridgeName(statusResult.bridge_name);
          setHueLights(lightsResult.lights);
          updateNodeData(nodeId, { status: 'connected', bridgeName: statusResult.bridge_name });
        }
        setHueConnecting(false);
        return;
      }

      // Discover bridges
      const discoverResult = await hueDiscover();
      if (!discoverResult.success || !discoverResult.bridges?.length) {
        updateNodeData(nodeId, { status: 'error', statusText: 'No bridges found' });
        setHueConnecting(false);
        return;
      }

      const bridgeIp = discoverResult.bridges[0].ip;
      updateNodeData(nodeId, { status: 'connecting', statusText: 'Press bridge button...' });

      // Try to connect (may need button press)
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds timeout
      while (attempts < maxAttempts) {
        const connectResult = await hueConnect(bridgeIp);
        if (connectResult.success) {
          setHueBridgeIp(bridgeIp);
          setHueBridgeName(connectResult.bridge_name || bridgeIp);

          // Fetch lights
          const lightsResult = await hueGetLights();
          if (lightsResult.success && lightsResult.lights) {
            setHueLights(lightsResult.lights);
          }

          updateNodeData(nodeId, {
            status: 'connected',
            bridgeIp,
            bridgeName: connectResult.bridge_name,
          });
          setHueConnecting(false);
          return;
        }

        if (!connectResult.needs_button) {
          updateNodeData(nodeId, { status: 'error', statusText: connectResult.error || 'Connection failed' });
          setHueConnecting(false);
          return;
        }

        // Wait and retry (button needs pressing)
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
      }

      updateNodeData(nodeId, { status: 'error', statusText: 'Timeout - no button press' });
    } catch (err) {
      updateNodeData(nodeId, { status: 'error', statusText: String(err) });
    }
    setHueConnecting(false);
  }, [hueConnecting, updateNodeData]);

  // Handle Hue light selection
  const handleHueSelectLight = useCallback((nodeId: string, lightId: number) => {
    const light = hueLights.find(l => l.id === lightId);
    updateNodeData(nodeId, {
      selectedLightId: lightId,
      selectedLightName: light?.name || `Light ${lightId}`,
    });
  }, [hueLights, updateNodeData]);

  // Track test toggle state for each light
  const hueTestStateRef = useRef<Map<number, boolean>>(new Map());

  // Handle Hue light test (toggle on/off at full brightness)
  const handleHueTest = useCallback(async (lightId: number) => {
    const currentState = hueTestStateRef.current.get(lightId) ?? false;
    const newState = !currentState;
    hueTestStateRef.current.set(lightId, newState);

    const brightness = newState ? 1.0 : 0;
    // Update last brightness so real-time updates can take over smoothly
    hueLastBrightnessRef.current.set(lightId, Math.round(brightness * 254));

    // Toggle: on = full brightness, off = turn off
    await hueControl(lightId, {
      on: newState,
      brightness,
      transition: 0,
    });
  }, []);

  // Handle AI show generation
  const handleShowGenerate = useCallback(async (nodeId: string, style: string) => {
    if (!audioFile) {
      updateNodeData(nodeId, { status: 'error', statusText: 'No audio file loaded' });
      return;
    }

    updateNodeData(nodeId, { status: 'analyzing', statusText: 'Analyzing audio...' });

    try {
      const result = await generateShow(audioFile, hueLights.length || 4, style as 'energetic' | 'ambient' | 'dramatic' | 'minimal');

      if (!result.success || !result.show) {
        updateNodeData(nodeId, {
          status: 'error',
          statusText: result.error || 'Failed to generate show',
        });
        return;
      }

      // Store the show config
      setActiveShowConfig(result.show);

      // Update node with analysis data
      updateNodeData(nodeId, {
        status: 'complete',
        showName: result.show.show_name,
        sectionCount: result.show.sections.length,
        analysisData: {
          bpm: result.analysis?.bpm || 0,
          duration: result.analysis?.duration || 0,
          patterns: result.analysis?.patterns || { four_on_floor: false, backbeat: false, hat_rate: 'sparse' },
          sectionLabels: result.analysis?.sections.map(s => s.label) || [],
        },
      });
    } catch (err) {
      updateNodeData(nodeId, {
        status: 'error',
        statusText: String(err),
      });
    }
  }, [audioFile, hueLights.length, updateNodeData]);

  // Handle applying show config (currently just logs - TODO: integrate with Hue nodes)
  const handleShowApply = useCallback((nodeId: string) => {
    if (!activeShowConfig) {
      console.warn('No active show config to apply');
      return;
    }
    console.log('Applying show config:', activeShowConfig);
    // TODO: Integrate with Hue nodes - map show sections to light assignments
    // For now, the show config is stored and can be used by the executor hook
  }, [activeShowConfig]);

  // Process stem separation
  const processStemSeparation = useCallback(async (nodeId: string, file: File) => {
    if (processingRef.current.has(nodeId)) return;
    processingRef.current.add(nodeId);

    try {
      updateNodeData(nodeId, { status: 'uploading', progress: 30 });
      const { job_id, error } = await startStemSeparation(file);

      if (!job_id) {
        updateNodeData(nodeId, { status: 'error', statusText: error || 'Failed to start' });
        return;
      }

      updateNodeData(nodeId, { status: 'processing', progress: 40, statusText: 'Processing audio...' });

      let attempts = 0;
      const maxAttempts = 150;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;

        const result = await getStemSeparationStatus(job_id);
        const progress = Math.min(40 + (attempts / maxAttempts) * 55, 95);

        if (result.status === 'complete' && result.stems) {
          updateNodeData(nodeId, {
            status: 'complete',
            progress: 100,
            stems: { bass: 0, drums: 0, vocals: 0, other: 0 },
            stemTimeSeries: {
              bass: result.stems.bass,
              drums: result.stems.drums,
              vocals: result.stems.vocals,
              other: result.stems.other,
            },
            // Store drum band analysis if available
            drumTimeSeries: {
              kick: result.stems.drum_kick,
              snare: result.stems.drum_snare,
              hats: result.stems.drum_hats,
            },
            // Store stem audio URLs for isolated playback
            stemUrls: result.stem_urls ? {
              bass: result.stem_urls.bass ? `${API_URL}${result.stem_urls.bass}` : undefined,
              drums: result.stem_urls.drums ? `${API_URL}${result.stem_urls.drums}` : undefined,
              vocals: result.stem_urls.vocals ? `${API_URL}${result.stem_urls.vocals}` : undefined,
              other: result.stem_urls.other ? `${API_URL}${result.stem_urls.other}` : undefined,
              no_vocals: result.stem_urls.no_vocals ? `${API_URL}${result.stem_urls.no_vocals}` : undefined,
            } : undefined,
          });
          return;
        }

        if (result.status === 'error') {
          updateNodeData(nodeId, { status: 'error', statusText: result.error || 'Processing failed' });
          return;
        }

        updateNodeData(nodeId, { progress, statusText: `Separating stems... ${Math.round(progress)}%` });
      }

      updateNodeData(nodeId, { status: 'error', statusText: 'Timeout' });
    } catch (err) {
      updateNodeData(nodeId, { status: 'error', statusText: String(err) });
    } finally {
      processingRef.current.delete(nodeId);
    }
  }, [updateNodeData]);

  // Process BPM detection
  const processBpmDetection = useCallback(async (nodeId: string, file: File) => {
    if (processingRef.current.has(nodeId)) return;
    processingRef.current.add(nodeId);

    try {
      updateNodeData(nodeId, { status: 'detecting', statusText: 'Analyzing tempo...' });
      const result = await detectBpm(file);

      if (result.success && result.bpm) {
        updateNodeData(nodeId, {
          status: 'complete',
          detectedBpm: result.bpm,
          statusText: undefined,
        });
      } else {
        updateNodeData(nodeId, {
          status: 'error',
          statusText: result.error || 'BPM detection failed',
        });
      }
    } catch (err) {
      updateNodeData(nodeId, { status: 'error', statusText: String(err) });
    } finally {
      processingRef.current.delete(nodeId);
    }
  }, [updateNodeData]);

  // Handle connections
  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true }, eds));

      if (params.source === 'audio-source' && audioFile) {
        const targetNode = nodes.find((n) => n.id === params.target);
        if (targetNode?.type === 'stemAnalyzer') {
          processStemSeparation(params.target!, audioFile);
        }
        if (targetNode?.type === 'songMetadata') {
          processBpmDetection(params.target!, audioFile);
        }
      }
    },
    [setEdges, nodes, audioFile, processStemSeparation, processBpmDetection]
  );

  // Track previous audio file to detect changes
  const prevAudioFileRef = useRef<File | null>(null);

  // Reset all downstream nodes and trigger reprocessing when audio file changes
  useEffect(() => {
    if (!audioFile) return;

    const isNewFile = prevAudioFileRef.current !== audioFile;
    prevAudioFileRef.current = audioFile;

    if (isNewFile) {
      // Clear active isolate when file changes
      setActiveIsolateId(null);
      onIsolateChange?.(null, null);

      // Reset ALL analyzer nodes to idle so they reprocess
      setNodes(nds => nds.map(node => {
        if (node.type === 'stemAnalyzer') {
          processingRef.current.delete(node.id);
          return { ...node, data: { ...node.data, status: 'idle', progress: 0, stems: null, stemTimeSeries: null, drumTimeSeries: null, stemUrls: undefined } };
        }
        if (node.type === 'songMetadata') {
          processingRef.current.delete(node.id);
          return { ...node, data: { ...node.data, status: 'idle', detectedBpm: null } };
        }
        if (node.type === 'playback') {
          return { ...node, data: { ...node.data, stemType: null, stemUrl: null, isActive: false } };
        }
        return node;
      }));
    }

    // Process any idle analyzer nodes connected to audio source
    edges.forEach((edge) => {
      if (edge.source === 'audio-source') {
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (targetNode?.type === 'stemAnalyzer' && (targetNode.data.status === 'idle' || isNewFile)) {
          processStemSeparation(edge.target, audioFile);
        }
        if (targetNode?.type === 'songMetadata' && (targetNode.data.status === 'idle' || isNewFile)) {
          processBpmDetection(edge.target, audioFile);
        }
      }
    });
  }, [audioFile, edges, nodes, processStemSeparation, processBpmDetection, setNodes, onIsolateChange]);

  // Round-robin index for updating multiple Hue lights
  const hueUpdateIndexRef = useRef(0);

  // Send brightness to Hue lights - round-robin to avoid overwhelming bridge
  // Hue bridge limit: ~10 req/sec, so we update ONE light per cycle
  useEffect(() => {
    if (!isPlaying) return;

    const hueNodes = nodes.filter(n => n.type === 'hue' && n.data.selectedLightId);
    if (hueNodes.length === 0) return;

    // 100ms between requests = 10Hz, safe for Hue bridge
    // Each light gets updated every (100ms * numLights)
    const updateRateMs = 100;

    const updateOneLight = () => {
      // Round-robin: pick one light per cycle
      const idx = hueUpdateIndexRef.current % hueNodes.length;
      hueUpdateIndexRef.current++;

      const node = hueNodes[idx];
      const lightId = node.data.selectedLightId as number;
      // Use Hue-specific getter that looks AHEAD in time
      const inputValue = getHueNodeInputValue(node.id);

      const brightness = Math.max(0, Math.min(1, inputValue));
      const brightnessInt = Math.round(brightness * 254);

      const lastBrightness = hueLastBrightnessRef.current.get(lightId) ?? -1;
      if (Math.abs(brightnessInt - lastBrightness) >= 2) {
        hueLastBrightnessRef.current.set(lightId, brightnessInt);
        hueControl(lightId, { brightness, on: brightness > 0.005, transition: 0 });
      }
    };

    const interval = setInterval(updateOneLight, updateRateMs);
    return () => clearInterval(interval);
  }, [isPlaying, nodes, edges, currentTime]);

  // Rerun handlers for analyzer nodes
  const handleRerunStemAnalyzer = useCallback((nodeId: string) => {
    if (!audioFile) return;
    // Reset node state and re-process
    updateNodeData(nodeId, { status: 'idle', progress: 0, stems: null, stemTimeSeries: null, drumTimeSeries: null, stemUrls: undefined });
    processingRef.current.delete(nodeId); // Allow reprocessing
    processStemSeparation(nodeId, audioFile);
  }, [audioFile, updateNodeData, processStemSeparation]);

  const handleRerunBpmDetection = useCallback((nodeId: string) => {
    if (!audioFile) return;
    updateNodeData(nodeId, { status: 'idle', detectedBpm: null });
    processingRef.current.delete(nodeId);
    processBpmDetection(nodeId, audioFile);
  }, [audioFile, updateNodeData, processBpmDetection]);

  // Get stem time series for real-time values
  const stemAnalyzerNode = nodes.find((n) => n.type === 'stemAnalyzer');
  const stemTimeSeries = stemAnalyzerNode?.data?.stemTimeSeries as StemTimeSeries | null;

  const currentStemValues: StemValues | null = stemTimeSeries ? {
    bass: getValueAtTime(stemTimeSeries.bass, adjustedTime),
    drums: getValueAtTime(stemTimeSeries.drums, adjustedTime),
    vocals: getValueAtTime(stemTimeSeries.vocals, adjustedTime),
    other: getValueAtTime(stemTimeSeries.other, adjustedTime),
  } : null;

  // Hue lights look AHEAD to compensate for system latency
  const hueStemValues: StemValues | null = stemTimeSeries ? {
    bass: getValueAtTime(stemTimeSeries.bass, hueTime),
    drums: getValueAtTime(stemTimeSeries.drums, hueTime),
    vocals: getValueAtTime(stemTimeSeries.vocals, hueTime),
    other: getValueAtTime(stemTimeSeries.other, hueTime),
  } : null;

  // Envelope follower calculation
  const calculateSmoothedValue = (nodeId: string, inputValue: number, attackMs: number, releaseMs: number): number => {
    const now = performance.now();
    const state = smootherStateRef.current.get(nodeId) || { value: 0, lastTime: now };
    const deltaMs = Math.min(now - state.lastTime, 100);

    let newValue: number;
    if (inputValue > state.value) {
      const coeff = 1 - Math.exp(-deltaMs / attackMs);
      newValue = state.value + (inputValue - state.value) * coeff;
    } else {
      const coeff = 1 - Math.exp(-deltaMs / releaseMs);
      newValue = state.value + (inputValue - state.value) * coeff;
    }

    smootherStateRef.current.set(nodeId, { value: newValue, lastTime: now });
    return newValue;
  };

  // Gate calculation with auto-threshold detection and anti-strobe
  const calculateGatedValue = (
    nodeId: string,
    inputValue: number,
    sensitivity: number,
    attackMs: number,
    releaseMs: number,
    minHoldMs: number,
    retriggerMs: number
  ): { outputValue: number; isOpen: boolean; threshold: number } => {
    const now = performance.now();
    const defaultState: GateState = {
      envelopeValue: 0,
      isOpen: false,
      lastOpenTime: 0,
      lastCloseTime: 0,
      lastTime: now,
      recentMin: inputValue,
      recentMax: inputValue,
      threshold: 0.5,
    };
    const state = gateStateRef.current.get(nodeId) || defaultState;
    const deltaMs = Math.min(now - state.lastTime, 100);

    // Update recent min/max for auto-threshold (with decay toward current value)
    const decayRate = 0.002; // Slow decay for stable threshold
    const newMin = Math.min(state.recentMin + decayRate, inputValue);
    const newMax = Math.max(state.recentMax - decayRate, inputValue);
    const range = Math.max(0.1, newMax - newMin); // Ensure minimum range

    // Calculate threshold based on sensitivity (0 = hard trigger, 1 = soft trigger)
    // Higher sensitivity = lower threshold = easier to trigger
    const thresholdPercent = 0.7 - sensitivity * 0.5; // 0.7 at sens=0, 0.2 at sens=1
    const threshold = newMin + range * thresholdPercent;

    // Determine if gate should open/close
    let isOpen = state.isOpen;
    const timeSinceOpen = now - state.lastOpenTime;
    const timeSinceClose = now - state.lastCloseTime;

    if (!isOpen) {
      // Check if we should open (signal above threshold, past retrigger lockout)
      if (inputValue > threshold && timeSinceClose > retriggerMs) {
        isOpen = true;
      }
    } else {
      // Check if we should close (signal below threshold, past minimum hold)
      if (inputValue < threshold * 0.8 && timeSinceOpen > minHoldMs) {
        isOpen = false;
      }
    }

    // Calculate envelope (smooth attack/release to target)
    const target = isOpen ? 1.0 : 0.0;
    let envelopeValue: number;
    if (target > state.envelopeValue) {
      const coeff = 1 - Math.exp(-deltaMs / attackMs);
      envelopeValue = state.envelopeValue + (target - state.envelopeValue) * coeff;
    } else {
      const coeff = 1 - Math.exp(-deltaMs / releaseMs);
      envelopeValue = state.envelopeValue + (target - state.envelopeValue) * coeff;
    }

    // Update state
    const newState: GateState = {
      envelopeValue,
      isOpen,
      lastOpenTime: isOpen && !state.isOpen ? now : state.lastOpenTime,
      lastCloseTime: !isOpen && state.isOpen ? now : state.lastCloseTime,
      lastTime: now,
      recentMin: newMin,
      recentMax: newMax,
      threshold,
    };
    gateStateRef.current.set(nodeId, newState);

    return { outputValue: envelopeValue, isOpen, threshold };
  };

  // Signal flow helpers
  const getNodeOutputValue = (nodeId: string, sourceHandle?: string | null): number => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return 0;

    if (node.type === 'stemAnalyzer' && currentStemValues) {
      return currentStemValues[sourceHandle as keyof StemValues] || 0;
    }

    if (node.type === 'drumAnalyzer') {
      // DrumAnalyzer gets its data from connected stemAnalyzer
      const incomingEdge = edges.find((e) => e.target === nodeId);
      if (incomingEdge) {
        const sourceNode = nodes.find((n) => n.id === incomingEdge.source);
        if (sourceNode?.type === 'stemAnalyzer' && sourceNode.data.drumTimeSeries) {
          const drumTimeSeries = sourceNode.data.drumTimeSeries as DrumTimeSeries;
          if (sourceHandle) {
            const data = drumTimeSeries[sourceHandle as keyof DrumValues];
            return getValueAtTime(data, adjustedTime);
          }
        }
      }
      return 0;
    }

    if (node.type === 'songMetadata' && sourceHandle === 'bpm') {
      return node.data.manualBpm ?? node.data.detectedBpm ?? 0;
    }

    if (node.type === 'smoother') {
      const inputVal = getNodeInputByHandle(nodeId, 'signal');
      const bpmVal = getNodeInputByHandle(nodeId, 'bpm');
      const bpmFactor = node.data.bpmFactor || 16;

      // If BPM is connected, calculate timing from BPM
      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 400;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / bpmFactor);
        releaseMs = Math.round(beatMs);
      }

      return calculateSmoothedValue(nodeId, inputVal, attackMs, releaseMs);
    }

    if (node.type === 'gate') {
      const inputVal = getNodeInputByHandle(nodeId, 'signal');
      const bpmVal = getNodeInputByHandle(nodeId, 'bpm');

      // If BPM is connected, sync timing to beats
      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 200;
      let minHoldMs = node.data.minHoldMs || 80;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / 32); // 1/32 beat attack
        releaseMs = Math.round(beatMs / 4);  // 1/4 beat release
        minHoldMs = Math.round(beatMs / 8);  // 1/8 beat minimum hold
      }

      const result = calculateGatedValue(
        nodeId,
        inputVal,
        node.data.sensitivity ?? 0.5,
        attackMs,
        releaseMs,
        minHoldMs,
        node.data.retriggerMs ?? 50
      );
      return result.outputValue;
    }

    if (node.type === 'mixer') {
      const inputs = {
        bass: getNodeInputByHandle(nodeId, 'bass'),
        drums: getNodeInputByHandle(nodeId, 'drums'),
        vocals: getNodeInputByHandle(nodeId, 'vocals'),
        other: getNodeInputByHandle(nodeId, 'other'),
      };
      const rawMix =
        inputs.bass * (node.data.bassWeight || 0.5) +
        inputs.drums * (node.data.drumsWeight || 0.35) +
        inputs.vocals * (node.data.vocalsWeight || 0.15) +
        inputs.other * (node.data.otherWeight || 0);
      return calculateSmoothedValue(`mixer-${nodeId}`, Math.min(1, rawMix), node.data.attackMs || 30, node.data.releaseMs || 400);
    }

    if (node.type === 'meter' || node.type === 'light' || node.type === 'hue') {
      // Pass-through nodes: trace back to get actual input value (not cached data.value)
      const incomingEdge = edges.find((e) => e.target === nodeId);
      if (incomingEdge) {
        return getNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
      }
      return 0;
    }

    return 0;
  };

  const getNodeInputValue = (nodeId: string): number => {
    const incomingEdge = edges.find((e) => e.target === nodeId && !e.targetHandle);
    if (!incomingEdge) return 0;
    return getNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
  };

  const getNodeInputByHandle = (nodeId: string, targetHandle: string): number => {
    // Also match edges without targetHandle for backwards compatibility
    const incomingEdge = edges.find((e) => e.target === nodeId && (e.targetHandle === targetHandle || (!e.targetHandle && targetHandle === 'signal')));
    if (!incomingEdge) return 0;
    return getNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
  };

  // Hue-specific signal flow that looks AHEAD in time to compensate for latency
  const getHueNodeOutputValue = (nodeId: string, sourceHandle?: string | null): number => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return 0;

    // Use hueStemValues (lookahead) instead of currentStemValues
    if (node.type === 'stemAnalyzer' && hueStemValues) {
      return hueStemValues[sourceHandle as keyof StemValues] || 0;
    }

    if (node.type === 'drumAnalyzer') {
      const incomingEdge = edges.find((e) => e.target === nodeId);
      if (incomingEdge) {
        const sourceNode = nodes.find((n) => n.id === incomingEdge.source);
        if (sourceNode?.type === 'stemAnalyzer' && sourceNode.data.drumTimeSeries) {
          const drumTimeSeries = sourceNode.data.drumTimeSeries as DrumTimeSeries;
          if (sourceHandle) {
            const data = drumTimeSeries[sourceHandle as keyof DrumValues];
            return getValueAtTime(data, hueTime); // Use hueTime instead of adjustedTime
          }
        }
      }
      return 0;
    }

    if (node.type === 'songMetadata' && sourceHandle === 'bpm') {
      return node.data.manualBpm ?? node.data.detectedBpm ?? 0;
    }

    // For smoother, use the raw input value without envelope (Hue has its own response curve)
    if (node.type === 'smoother') {
      const inputVal = getHueNodeInputByHandle(nodeId, 'signal');
      const bpmVal = getHueNodeInputByHandle(nodeId, 'bpm');
      const bpmFactor = node.data.bpmFactor || 16;

      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 400;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / bpmFactor);
        releaseMs = Math.round(beatMs);
      }

      return calculateSmoothedValue(`hue-${nodeId}`, inputVal, attackMs, releaseMs);
    }

    if (node.type === 'gate') {
      const inputVal = getHueNodeInputByHandle(nodeId, 'signal');
      const bpmVal = getHueNodeInputByHandle(nodeId, 'bpm');

      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 200;
      let minHoldMs = node.data.minHoldMs || 80;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / 32);
        releaseMs = Math.round(beatMs / 4);
        minHoldMs = Math.round(beatMs / 8);
      }

      const result = calculateGatedValue(
        `hue-${nodeId}`,
        inputVal,
        node.data.sensitivity ?? 0.5,
        attackMs,
        releaseMs,
        minHoldMs,
        node.data.retriggerMs ?? 50
      );
      return result.outputValue;
    }

    if (node.type === 'mixer') {
      const inputs = {
        bass: getHueNodeInputByHandle(nodeId, 'bass'),
        drums: getHueNodeInputByHandle(nodeId, 'drums'),
        vocals: getHueNodeInputByHandle(nodeId, 'vocals'),
        other: getHueNodeInputByHandle(nodeId, 'other'),
      };
      const rawMix =
        inputs.bass * (node.data.bassWeight || 0.5) +
        inputs.drums * (node.data.drumsWeight || 0.35) +
        inputs.vocals * (node.data.vocalsWeight || 0.15) +
        inputs.other * (node.data.otherWeight || 0);
      return calculateSmoothedValue(`hue-mixer-${nodeId}`, Math.min(1, rawMix), node.data.attackMs || 30, node.data.releaseMs || 400);
    }

    if (node.type === 'meter' || node.type === 'light' || node.type === 'hue' || node.type === 'gate') {
      const incomingEdge = edges.find((e) => e.target === nodeId);
      if (incomingEdge) {
        return getHueNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
      }
      return 0;
    }

    return 0;
  };

  const getHueNodeInputValue = (nodeId: string): number => {
    const incomingEdge = edges.find((e) => e.target === nodeId && !e.targetHandle);
    if (!incomingEdge) return 0;
    return getHueNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
  };

  const getHueNodeInputByHandle = (nodeId: string, targetHandle: string): number => {
    const incomingEdge = edges.find((e) => e.target === nodeId && (e.targetHandle === targetHandle || (!e.targetHandle && targetHandle === 'signal')));
    if (!incomingEdge) return 0;
    return getHueNodeOutputValue(incomingEdge.source, incomingEdge.sourceHandle);
  };

  // Update nodes with current state
  const nodesWithData = nodes.map((node) => {
    if (node.id === 'audio-source') {
      return { ...node, data: { ...node.data, fileName: audioFileName, duration: audioDuration, isLoading, onFileSelect: onFileSelect || (() => {}) } };
    }

    if (node.type === 'stemAnalyzer') {
      return { ...node, data: { ...node.data, onRerun: () => handleRerunStemAnalyzer(node.id) } };
    }

    if (node.type === 'songMetadata') {
      return { ...node, data: { ...node.data, onRerun: () => handleRerunBpmDetection(node.id) } };
    }

    if (node.type === 'smoother') {
      const inputVal = getNodeInputByHandle(node.id, 'signal');
      const bpmVal = getNodeInputByHandle(node.id, 'bpm');
      const bpmFactor = node.data.bpmFactor || 16;

      // Calculate timing from BPM if connected
      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 400;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / bpmFactor);
        releaseMs = Math.round(beatMs);
      }

      const outputVal = calculateSmoothedValue(node.id, inputVal, attackMs, releaseMs);
      return {
        ...node,
        data: {
          ...node.data,
          inputValue: inputVal,
          outputValue: outputVal,
          bpm: bpmVal > 0 ? bpmVal : undefined,
          attackMs,
          releaseMs,
          onBpmFactorChange: (factor: number) => updateNodeData(node.id, { bpmFactor: factor }),
        },
      };
    }

    if (node.type === 'gate') {
      const inputVal = getNodeInputByHandle(node.id, 'signal');
      const bpmVal = getNodeInputByHandle(node.id, 'bpm');

      // If BPM is connected, sync timing to beats
      let attackMs = node.data.attackMs || 30;
      let releaseMs = node.data.releaseMs || 200;
      let minHoldMs = node.data.minHoldMs || 80;
      if (bpmVal > 0) {
        const beatMs = 60000 / bpmVal;
        attackMs = Math.round(beatMs / 32);
        releaseMs = Math.round(beatMs / 4);
        minHoldMs = Math.round(beatMs / 8);
      }

      const result = calculateGatedValue(
        node.id,
        inputVal,
        node.data.sensitivity ?? 0.5,
        attackMs,
        releaseMs,
        minHoldMs,
        node.data.retriggerMs ?? 50
      );

      return {
        ...node,
        data: {
          ...node.data,
          inputValue: inputVal,
          outputValue: result.outputValue,
          isOpen: result.isOpen,
          threshold: result.threshold,
          bpm: bpmVal > 0 ? bpmVal : undefined,
          attackMs,
          releaseMs,
          onSensitivityChange: (value: number) => updateNodeData(node.id, { sensitivity: value }),
        },
      };
    }

    if (node.type === 'meter') {
      const inputVal = getNodeInputValue(node.id);
      const stemKey = node.id.replace('meter-', '') as keyof StemValues;
      const directStemVal = currentStemValues && stemKey in currentStemValues ? currentStemValues[stemKey] : 0;
      return { ...node, data: { ...node.data, value: inputVal || directStemVal } };
    }

    if (node.type === 'light') {
      return { ...node, data: { ...node.data, value: getNodeInputValue(node.id) } };
    }

    if (node.type === 'mixer') {
      const inputValues: StemValues = {
        bass: getNodeInputByHandle(node.id, 'bass'),
        drums: getNodeInputByHandle(node.id, 'drums'),
        vocals: getNodeInputByHandle(node.id, 'vocals'),
        other: getNodeInputByHandle(node.id, 'other'),
      };
      const rawMix =
        inputValues.bass * (node.data.bassWeight || 0.5) +
        inputValues.drums * (node.data.drumsWeight || 0.35) +
        inputValues.vocals * (node.data.vocalsWeight || 0.15) +
        inputValues.other * (node.data.otherWeight || 0);
      const outputValue = calculateSmoothedValue(`mixer-${node.id}`, Math.min(1, rawMix), node.data.attackMs || 30, node.data.releaseMs || 400);
      return { ...node, data: { ...node.data, inputValues, outputValue } };
    }

    if (node.type === 'multiView') {
      const values = [
        getNodeInputByHandle(node.id, 'ch1'),
        getNodeInputByHandle(node.id, 'ch2'),
        getNodeInputByHandle(node.id, 'ch3'),
        getNodeInputByHandle(node.id, 'ch4'),
      ];
      return { ...node, data: { ...node.data, values, onChannelCountChange: (count: number) => updateNodeData(node.id, { channelCount: count }) } };
    }

    if (node.type === 'drumAnalyzer') {
      // Find connected stemAnalyzer to get drum time series data
      const incomingEdge = edges.find((e) => e.target === node.id);
      if (incomingEdge) {
        const sourceNode = nodes.find((n) => n.id === incomingEdge.source);
        if (sourceNode?.type === 'stemAnalyzer' && sourceNode.data.drumTimeSeries) {
          const drumTimeSeries = sourceNode.data.drumTimeSeries as DrumTimeSeries;
          const currentDrumValues: DrumValues = {
            kick: getValueAtTime(drumTimeSeries.kick, adjustedTime),
            snare: getValueAtTime(drumTimeSeries.snare, adjustedTime),
            hats: getValueAtTime(drumTimeSeries.hats, adjustedTime),
          };
          return {
            ...node,
            data: {
              ...node.data,
              status: 'complete',
              progress: 100,
              drums: currentDrumValues,
              drumTimeSeries,
              // Rerunning drum analyzer triggers the upstream stem analyzer
              onRerun: () => handleRerunStemAnalyzer(sourceNode.id),
            },
          };
        }
      }
      return { ...node, data: { ...node.data, onRerun: undefined } };
    }

    if (node.type === 'playback') {
      // Find connected node to get stem URL
      const incomingEdge = edges.find((e) => e.target === node.id);
      if (incomingEdge) {
        const sourceNode = nodes.find((n) => n.id === incomingEdge.source);

        // If connected to stemAnalyzer - can isolate audio
        if (sourceNode?.type === 'stemAnalyzer' && sourceNode.data.stemUrls) {
          const stemType = incomingEdge.sourceHandle as StemType;
          const stemUrls = sourceNode.data.stemUrls as Record<string, string>;
          const stemUrl = stemUrls[stemType];
          const stemTimeSeries = sourceNode.data.stemTimeSeries as StemTimeSeries;

          // Get current input value from stem
          const inputValue = stemTimeSeries?.[stemType as keyof StemTimeSeries]
            ? getValueAtTime(stemTimeSeries[stemType as keyof StemTimeSeries], adjustedTime)
            : 0;

          return {
            ...node,
            data: {
              ...node.data,
              stemType,
              stemUrl,
              isActive: activeIsolateId === node.id,
              inputValue,
              onToggle: () => handleIsolateToggle(node.id, stemUrl, stemType),
              statusText: undefined,
            },
          };
        }

        // If connected to drumAnalyzer - no audio available for drum bands
        if (sourceNode?.type === 'drumAnalyzer') {
          const drumType = incomingEdge.sourceHandle; // kick, snare, or hats
          return {
            ...node,
            data: {
              ...node.data,
              stemType: drumType,
              stemUrl: null,
              isActive: false,
              inputValue: 0,
              statusText: 'Drum bands have no audio',
            },
          };
        }
      }
      return node;
    }

    if (node.type === 'hue') {
      const inputValue = getNodeInputValue(node.id);
      const isConnected = hueBridgeName !== null || node.data.status === 'connected';
      const selectedLightId = node.data.selectedLightId as number | null;

      return {
        ...node,
        data: {
          ...node.data,
          status: hueConnecting ? 'connecting' : (isConnected ? 'connected' : node.data.status),
          bridgeIp: hueBridgeIp,
          bridgeName: hueBridgeName,
          lights: hueLights,
          inputValue,
          onConnect: () => handleHueConnect(node.id),
          onSelectLight: (lightId: number) => handleHueSelectLight(node.id, lightId),
          onTest: selectedLightId ? () => handleHueTest(selectedLightId) : undefined,
        },
      };
    }

    if (node.type === 'showGenerator') {
      return {
        ...node,
        data: {
          ...node.data,
          onGenerate: (style: string) => handleShowGenerate(node.id, style),
          onApply: () => handleShowApply(node.id),
        },
      };
    }

    return node;
  });

  // Drag and drop handlers
  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newNode: Node = { id: getNodeId(), type, position, data: getDefaultData(type) };
      setNodes((nds) => nds.concat(newNode));
    },
    [screenToFlowPosition, setNodes]
  );

  return (
    <div ref={reactFlowWrapper} className="w-full h-full bg-gray-950">
      <ReactFlow
        nodes={nodesWithData}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        defaultViewport={{ x: 100, y: 50, zoom: 0.75 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#374151" />
      </ReactFlow>

      {/* Sidebar */}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 bg-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-2 space-y-2">
        {nodeTemplates.map((template) => (
          <div
            key={template.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/reactflow', template.type);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className="flex items-center gap-2 px-3 py-2 rounded-md cursor-grab active:cursor-grabbing bg-gray-800 hover:bg-gray-700 transition-colors"
            style={{ borderWidth: 1, borderStyle: 'solid', borderColor: template.borderColor }}
            title={template.label}
          >
            <template.icon className="w-4 h-4" style={{ color: template.iconColor }} />
            <span className="text-xs text-gray-300">{template.label}</span>
          </div>
        ))}
      </div>

      {/* Bottom Playback Bar */}
      <PlaybackBar
        currentTime={currentTime}
        duration={audioDuration || 0}
        isPlaying={isPlaying}
        fileName={audioFileName}
        onPlay={onPlay}
        onPause={onPause}
        onSeek={onSeek}
      />
    </div>
  );
}

export function FlowEditor(props: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowEditorInner {...props} />
    </ReactFlowProvider>
  );
}
