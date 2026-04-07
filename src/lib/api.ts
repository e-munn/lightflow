const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

import { AnalysisResult, ShowPlan } from '@/types/v3';

export async function analyzeAudio(file: File): Promise<AnalysisResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API_URL}/analyze`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Analysis failed: ${res.status}`);
  return res.json();
}

export async function generateShow(analysisJson: string, style: string = 'energetic'): Promise<ShowPlan> {
  const form = new FormData();
  form.append('file', new Blob([analysisJson], { type: 'application/json' }), 'analysis.json');
  form.append('style', style);
  const res = await fetch(`${API_URL}/generate`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
  return res.json();
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
