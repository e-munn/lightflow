import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { AnalysisResult } from '@/types/v3';
import { ScoutSchema } from '@/lib/scout/schema';
import { buildScoutSummary } from '@/lib/scout/buildSummary';
import { SCOUT_SYSTEM_PROMPT, buildScoutUserMessage } from '@/lib/scout/prompt';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function loadAnalysis(
  body: { analysis?: AnalysisResult; analysisUrl?: string },
  req: NextRequest,
): Promise<AnalysisResult> {
  if (body.analysis) return body.analysis;
  if (body.analysisUrl) {
    const url = body.analysisUrl.startsWith('http')
      ? body.analysisUrl
      : new URL(body.analysisUrl, req.nextUrl.origin).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`analysis fetch failed: ${res.status}`);
    return (await res.json()) as AnalysisResult;
  }
  throw new Error('missing analysis or analysisUrl');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const analysis = await loadAnalysis(body, req);

    const summary = buildScoutSummary(analysis);

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not set', summary },
        { status: 400 },
      );
    }

    const result = await generateObject({
      model: anthropic('claude-sonnet-4-6'),
      schema: ScoutSchema,
      system: SCOUT_SYSTEM_PROMPT,
      prompt: buildScoutUserMessage(summary),
      maxRetries: 1,
    });

    const scout = result.object;

    // Save to public/songs/ so it's cached for next load
    const slug = analysis.song ?? body.analysisUrl?.replace(/.*\//, '').replace(/_analysis\.json$/, '');
    if (slug) {
      const outPath = join(process.cwd(), 'public', 'songs', `${slug}_scout.json`);
      await writeFile(outPath, JSON.stringify(scout, null, 2)).catch(() => {});
    }

    return NextResponse.json({ scout, summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
