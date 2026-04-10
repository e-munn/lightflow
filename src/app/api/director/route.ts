/**
 * POST /api/director
 *
 * Body: { analysisUrl: string } OR { analysis: AnalysisJson }
 *
 * 1. Loads the per-song analysis JSON
 * 2. Builds a StemSummary + DraftPlan (deterministic, engine taste)
 * 3. Calls Claude in CRITIQUE mode → PlanPatch
 * 4. Applies patch → ShowPlan
 * 5. Returns { summary, draft, patch, show }
 *
 * Claude is an editor, not an author. If ANTHROPIC_API_KEY is missing
 * or the call fails, the route still returns a valid ShowPlan built
 * from the draft alone (empty patch).
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import {
  StemSummarySchema,
  DraftPlanSchema,
  ClaudePatchSchema,
  type PlanPatch,
} from '@/lib/director/schema';
import {
  buildStemSummary,
  buildDraftPlan,
  type AnalysisJson,
} from '@/lib/director/buildDraft';
import { applyPatch, claudePatchToPlanPatch } from '@/lib/director/applyPatch';
import {
  DIRECTOR_SYSTEM_PROMPT,
  buildDirectorUserMessage,
} from '@/lib/director/prompt';
import { cacheKey, readCache, writeCache } from '@/lib/director/cache';

export const runtime = 'nodejs';
export const maxDuration = 60;

const EMPTY_PATCH: PlanPatch = {
  arc: 'Engine draft — no Claude edits.',
  style: 'default',
  sectionEdits: [],
  hitCues: [],
  warnings: [],
};

interface CachedResponse {
  summary: unknown;
  draft: unknown;
  patch: unknown;
  show: unknown;
  claudeError: string | null;
}

async function loadAnalysisFromBody(
  body: { analysis?: AnalysisJson; analysisUrl?: string },
  req: NextRequest,
): Promise<AnalysisJson> {
  if (body.analysis) return body.analysis;
  if (body.analysisUrl) {
    const url = body.analysisUrl.startsWith('http')
      ? body.analysisUrl
      : new URL(body.analysisUrl, req.nextUrl.origin).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`analysis fetch failed: ${res.status}`);
    return (await res.json()) as AnalysisJson;
  }
  throw new Error('missing analysis or analysisUrl');
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const analysis = await loadAnalysisFromBody(body, req);
    const noCache = body.noCache === true;

    // Cache lookup — keyed on analysis + director version + prompt version.
    const key = cacheKey(analysis);
    if (!noCache) {
      const hit = await readCache<CachedResponse>(key);
      if (hit) {
        return NextResponse.json({ ...hit, cached: true, cacheKey: key });
      }
    }

    // 1. Build deterministic inputs
    const summary = StemSummarySchema.parse(buildStemSummary(analysis));
    const draft = DraftPlanSchema.parse(buildDraftPlan(analysis));

    // 2. Ask Claude for a patch (fall back to empty patch on any failure)
    let patch: PlanPatch = EMPTY_PATCH;
    let claudeError: string | null = null;

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const result = await generateObject({
          model: anthropic('claude-opus-4-6'),
          schema: ClaudePatchSchema,
          system: DIRECTOR_SYSTEM_PROMPT,
          prompt: buildDirectorUserMessage(summary, draft),
          maxRetries: 1,
        });
        patch = claudePatchToPlanPatch(result.object);
      } catch (err) {
        claudeError = err instanceof Error ? err.message : String(err);
      }
    } else {
      claudeError = 'ANTHROPIC_API_KEY not set — returning draft-only plan.';
    }

    // 3. Merge
    const show = applyPatch(draft, patch);

    const response: CachedResponse = {
      summary,
      draft,
      patch,
      show,
      claudeError,
    };

    // Only cache successful Claude runs. If the key is missing or Claude
    // errored, don't persist — otherwise the stale error sticks until the
    // next DIRECTOR_VERSION / PROMPT_VERSION bump.
    if (!claudeError) {
      void writeCache(key, response);
    }

    return NextResponse.json({ ...response, cached: false, cacheKey: key });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
