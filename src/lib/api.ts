import { AudioAnalysis } from '@/types/analysis';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

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
