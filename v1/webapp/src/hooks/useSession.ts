'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  SessionData,
  MixerParams,
  FlowNodeData,
  FlowEdgeData,
  saveSession,
  loadLatestSession,
} from '@/lib/supabase';

// Default mixer params
const DEFAULT_MIXER_PARAMS: MixerParams = {
  bassWeight: 0.5,
  drumsWeight: 0.35,
  vocalsWeight: 0.15,
  attackMs: 30,
  releaseMs: 400,
  sensitivity: 1.0,
  threshold: 0.05,
  beatBoost: 0.2,
  smoothing: 0.3,
};

// Default flow nodes
const DEFAULT_FLOW_NODES: FlowNodeData[] = [
  { id: 'bass', type: 'source', position: { x: 50, y: 50 }, data: { label: 'Bass', value: 0, color: '#22c55e' } },
  { id: 'drums', type: 'source', position: { x: 50, y: 150 }, data: { label: 'Drums', value: 0, color: '#f59e0b' } },
  { id: 'vocals', type: 'source', position: { x: 50, y: 250 }, data: { label: 'Vocals', value: 0, color: '#3b82f6' } },
  { id: 'blend1', type: 'blend', position: { x: 250, y: 100 }, data: { label: 'Mix', weights: [0.5, 0.35, 0.15] } },
  { id: 'envelope1', type: 'processor', position: { x: 450, y: 100 }, data: { label: 'Envelope', type: 'envelope', params: { attack: 30, release: 400 } } },
  { id: 'light1', type: 'output', position: { x: 650, y: 100 }, data: { label: 'Light 1', value: 0, index: 0 } },
];

const DEFAULT_FLOW_EDGES: FlowEdgeData[] = [
  { id: 'e-bass-blend', source: 'bass', target: 'blend1', targetHandle: 'a' },
  { id: 'e-drums-blend', source: 'drums', target: 'blend1', targetHandle: 'b' },
  { id: 'e-vocals-blend', source: 'vocals', target: 'blend1', targetHandle: 'c' },
  { id: 'e-blend-env', source: 'blend1', target: 'envelope1' },
  { id: 'e-env-light', source: 'envelope1', target: 'light1' },
];

export function useSession() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Load session on mount
  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const loaded = await loadLatestSession();
        if (loaded) {
          setSession(loaded);
        } else {
          // Create default session
          setSession({
            name: 'Default Session',
            flow_nodes: DEFAULT_FLOW_NODES,
            flow_edges: DEFAULT_FLOW_EDGES,
            mixer_params: DEFAULT_MIXER_PARAMS,
          });
        }
      } catch (err) {
        console.error('Failed to load session:', err);
        // Use defaults on error
        setSession({
          name: 'Default Session',
          flow_nodes: DEFAULT_FLOW_NODES,
          flow_edges: DEFAULT_FLOW_EDGES,
          mixer_params: DEFAULT_MIXER_PARAMS,
        });
      }
      setIsLoading(false);
    }
    load();
  }, []);

  // Save session
  const save = useCallback(async () => {
    if (!session) return;

    setIsSaving(true);
    try {
      const result = await saveSession(session);
      if (result) {
        setSession((prev) => prev ? { ...prev, id: result.id } : prev);
        setLastSaved(new Date());
      }
    } catch (err) {
      console.error('Failed to save session:', err);
    }
    setIsSaving(false);
  }, [session]);

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!session || isLoading) return;

    const timeout = setTimeout(() => {
      save();
    }, 2000); // Save 2 seconds after last change

    return () => clearTimeout(timeout);
  }, [session, isLoading, save]);

  // Update flow nodes
  const updateFlowNodes = useCallback((nodes: FlowNodeData[]) => {
    setSession((prev) => prev ? { ...prev, flow_nodes: nodes } : prev);
  }, []);

  // Update flow edges
  const updateFlowEdges = useCallback((edges: FlowEdgeData[]) => {
    setSession((prev) => prev ? { ...prev, flow_edges: edges } : prev);
  }, []);

  // Update mixer params
  const updateMixerParams = useCallback((params: Partial<MixerParams>) => {
    setSession((prev) =>
      prev
        ? { ...prev, mixer_params: { ...prev.mixer_params, ...params } }
        : prev
    );
  }, []);

  // Update session name
  const updateName = useCallback((name: string) => {
    setSession((prev) => prev ? { ...prev, name } : prev);
  }, []);

  return {
    session,
    isLoading,
    isSaving,
    lastSaved,
    save,
    updateFlowNodes,
    updateFlowEdges,
    updateMixerParams,
    updateName,
  };
}
