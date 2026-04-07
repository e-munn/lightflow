import { AudioAnalysis } from '@/types/analysis';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function analyzeAudio(file: File): Promise<AudioAnalysis> {
  console.log('analyzeAudio called with file:', file.name, file.size, 'bytes');
  const formData = new FormData();
  formData.append('file', file);

  console.log('Sending to:', `${API_URL}/analyze`);
  const response = await fetch(`${API_URL}/analyze`, {
    method: 'POST',
    body: formData,
  });

  console.log('Response status:', response.status, response.statusText);

  if (!response.ok) {
    throw new Error(`Analysis failed: ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Parsed response:', data);
  return data;
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export interface StemSeparationResult {
  success: boolean;
  status: 'queued' | 'processing' | 'complete' | 'error';
  stems?: {
    drums?: { time: number; value: number }[];
    bass?: { time: number; value: number }[];
    vocals?: { time: number; value: number }[];
    other?: { time: number; value: number }[];
    no_vocals?: { time: number; value: number }[];
    // Drum band analysis (kick/snare/hats from frequency filtering)
    drum_kick?: { time: number; value: number }[];
    drum_snare?: { time: number; value: number }[];
    drum_hats?: { time: number; value: number }[];
  };
  // URLs to isolated stem audio files (relative to API_URL)
  stem_urls?: {
    drums?: string;
    bass?: string;
    vocals?: string;
    other?: string;
    no_vocals?: string;
  };
  stem_names?: string[];
  error?: string;
}

export async function startStemSeparation(file: File): Promise<{ success: boolean; job_id?: string; error?: string }> {
  console.log('Starting stem separation for:', file.name);
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_URL}/separate`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Stem separation failed: ${response.statusText}`);
  }

  return response.json();
}

export async function getStemSeparationStatus(jobId: string): Promise<StemSeparationResult> {
  const response = await fetch(`${API_URL}/separate/status/${jobId}`);

  if (!response.ok) {
    throw new Error(`Failed to get status: ${response.statusText}`);
  }

  return response.json();
}

// BPM Detection
export interface BpmDetectionResult {
  success: boolean;
  bpm?: number;
  confidence?: number;
  error?: string;
}

export async function detectBpm(file: File): Promise<BpmDetectionResult> {
  console.log('Detecting BPM for:', file.name);
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${API_URL}/bpm`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      // Fallback to /analyze endpoint if /bpm doesn't exist
      if (response.status === 404) {
        console.log('Falling back to /analyze for BPM');
        const analysisResult = await analyzeAudio(file);
        return {
          success: true,
          bpm: analysisResult.bpm,
        };
      }
      throw new Error(`BPM detection failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    // Try fallback to analyze
    try {
      const analysisResult = await analyzeAudio(file);
      return {
        success: true,
        bpm: analysisResult.bpm,
      };
    } catch (fallbackError) {
      return {
        success: false,
        error: String(error),
      };
    }
  }
}

// Poll for stem separation results
export async function waitForStemSeparation(
  jobId: string,
  onProgress?: (status: string) => void,
  maxWaitMs = 300000 // 5 minutes max
): Promise<StemSeparationResult> {
  const startTime = Date.now();
  const pollInterval = 2000; // Poll every 2 seconds

  while (Date.now() - startTime < maxWaitMs) {
    const result = await getStemSeparationStatus(jobId);

    if (onProgress) {
      onProgress(result.status);
    }

    if (result.status === 'complete' || result.status === 'error') {
      return result;
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { success: false, status: 'error', error: 'Timeout waiting for stem separation' };
}

// ============ HUE LIGHT CONTROL ============

export interface HueBridge {
  ip: string;
  id: string;
}

export interface HueLight {
  id: number;
  name: string;
  on: boolean;
  brightness: number;
  reachable: boolean;
  type: string;
}

export async function hueDiscover(): Promise<{ success: boolean; bridges?: HueBridge[]; error?: string }> {
  try {
    const response = await fetch(`${API_URL}/hue/discover`);
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function hueConnect(ip: string): Promise<{
  success: boolean;
  bridge_name?: string;
  lights_count?: number;
  error?: string;
  needs_button?: boolean;
}> {
  try {
    const response = await fetch(`${API_URL}/hue/connect?ip=${encodeURIComponent(ip)}`, {
      method: 'POST',
    });
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function hueGetLights(): Promise<{ success: boolean; lights?: HueLight[]; error?: string }> {
  try {
    const response = await fetch(`${API_URL}/hue/lights`);
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function hueControl(
  lightId: number,
  options: { brightness?: number; on?: boolean; hue?: number; saturation?: number; transition?: number }
): Promise<{ success: boolean; error?: string }> {
  try {
    const params = new URLSearchParams();
    params.set('light_id', String(lightId));
    if (options.brightness !== undefined) params.set('brightness', String(options.brightness));
    if (options.on !== undefined) params.set('on', String(options.on));
    if (options.hue !== undefined) params.set('hue', String(options.hue));
    if (options.saturation !== undefined) params.set('saturation', String(options.saturation));
    if (options.transition !== undefined) params.set('transition', String(options.transition));

    const response = await fetch(`${API_URL}/hue/control?${params}`, {
      method: 'POST',
    });
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function hueStatus(): Promise<{
  success: boolean;
  connected?: boolean;
  bridge_name?: string;
}> {
  try {
    const response = await fetch(`${API_URL}/hue/status`);
    return response.json();
  } catch (error) {
    return { success: false };
  }
}

// ============ LLM SHOW GENERATION ============

export interface SongSection {
  start: number;
  end: number;
  label: 'intro' | 'verse' | 'buildup' | 'drop' | 'breakdown' | 'outro';
  energy_level: number;
  bass_presence: number;
  has_vocals: boolean;
}

export interface RhythmicPatterns {
  four_on_floor: boolean;
  backbeat: boolean;
  hat_rate: 'sparse' | 'quarters' | '8ths' | '16ths';
  syncopation_level: number;
  pattern_confidence: number;
}

export interface ShowAnalysis {
  duration: number;
  bpm: number;
  bpm_confidence: number;
  beat_count: number;
  sections: SongSection[];
  patterns: RhythmicPatterns;
  key_moments: { time: number; type: string; energy: number }[];
  energy_profile: { time: number; energy: number }[];
}

export interface LightAssignment {
  source: 'kick' | 'snare' | 'hats' | 'bass' | 'vocals' | 'energy' | 'off';
  attack_ms: number;
  release_ms: number;
  intensity: number;
}

export interface ShowSection {
  start: number;
  end: number;
  label: string;
  lights: Record<string, LightAssignment>;
}

export interface ShowConfig {
  show_name: string;
  sections: ShowSection[];
}

export async function analyzeForShow(file: File): Promise<{
  success: boolean;
  analysis?: ShowAnalysis;
  error?: string;
}> {
  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(`${API_URL}/show/analyze`, {
      method: 'POST',
      body: formData,
    });
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function generateShow(
  file: File,
  lights: string | number = 4,
  style: 'energetic' | 'ambient' | 'dramatic' | 'minimal' = 'energetic'
): Promise<{
  success: boolean;
  analysis?: ShowAnalysis;
  show?: ShowConfig;
  error?: string;
}> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  params.set('lights', String(lights));
  params.set('style', style);

  try {
    const response = await fetch(`${API_URL}/show/generate?${params}`, {
      method: 'POST',
      body: formData,
    });
    return response.json();
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
