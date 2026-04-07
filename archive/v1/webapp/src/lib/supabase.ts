import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for session data
export interface FlowNodeData {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdgeData {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface MixerParams {
  bassWeight: number;
  drumsWeight: number;
  vocalsWeight: number;
  attackMs: number;
  releaseMs: number;
  sensitivity: number;
  threshold: number;
  beatBoost: number;
  smoothing: number;
}

export interface SessionData {
  id?: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  flow_nodes: FlowNodeData[];
  flow_edges: FlowEdgeData[];
  mixer_params: MixerParams;
}

// Save session to Supabase
export async function saveSession(session: SessionData): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('sessions')
    .upsert({
      id: session.id,
      name: session.name,
      flow_nodes: session.flow_nodes,
      flow_edges: session.flow_edges,
      mixer_params: session.mixer_params,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    console.error('Error saving session:', error);
    return null;
  }

  return data;
}

// Load session from Supabase
export async function loadSession(id: string): Promise<SessionData | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error loading session:', error);
    return null;
  }

  return data;
}

// Load most recent session
export async function loadLatestSession(): Promise<SessionData | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.error('Error loading latest session:', error);
    return null;
  }

  return data;
}

// Session summary for listings
export interface SessionSummary {
  id: string;
  name: string;
  created_at?: string;
  updated_at?: string;
}

// List all sessions
export async function listSessions(): Promise<SessionSummary[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, name, created_at, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('Error listing sessions:', error);
    return [];
  }

  return data || [];
}

// Delete session
export async function deleteSession(id: string): Promise<boolean> {
  const { error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting session:', error);
    return false;
  }

  return true;
}
