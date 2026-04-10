/**
 * POST /api/director/stream — streaming variant of /api/director.
 *
 * Emits NDJSON (one JSON object per line) so the HUD can populate
 * progressively during the ~30s cold-path Claude call instead of
 * staring at a spinner.
 *
 * Line types:
 *   { t: 'meta',    summary, draft, cacheKey, cached }
 *   { t: 'partial', patch }          // one per streamObject update
 *   { t: 'final',   patch, show, claudeError }
 *   { t: 'error',   message }
 *
 * Cache hit → emits meta + final in one shot and closes.
 * Cache miss → emits meta, then many partials, then final.
 *
 * The regular /api/director endpoint remains JSON-only for curl,
 * tests, and the cache-first non-streaming code path.
 */

import { NextRequest } from 'next/server';
import { streamObject } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import {
  StemSummarySchema,
  DraftPlanSchema,
  ClaudePatchSchema,
  type PlanPatch,
  type ClaudePatch,
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
  patch: PlanPatch;
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
  const body = await req.json().catch(() => ({}));

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        const analysis = await loadAnalysisFromBody(body, req);
        const noCache = body.noCache === true;
        const key = cacheKey(analysis);

        // Cache hit fast path
        if (!noCache) {
          const hit = await readCache<CachedResponse>(key);
          if (hit) {
            write({
              t: 'meta',
              summary: hit.summary,
              draft: hit.draft,
              cacheKey: key,
              cached: true,
            });
            write({
              t: 'final',
              patch: hit.patch,
              show: hit.show,
              claudeError: hit.claudeError,
            });
            controller.close();
            return;
          }
        }

        // Cold path
        const summary = StemSummarySchema.parse(buildStemSummary(analysis));
        const draft = DraftPlanSchema.parse(buildDraftPlan(analysis));

        write({
          t: 'meta',
          summary,
          draft,
          cacheKey: key,
          cached: false,
        });

        let patch: PlanPatch = EMPTY_PATCH;
        let claudeError: string | null = null;

        if (process.env.ANTHROPIC_API_KEY) {
          try {
            const result = streamObject({
              model: anthropic('claude-opus-4-6'),
              schema: ClaudePatchSchema,
              system: DIRECTOR_SYSTEM_PROMPT,
              prompt: buildDirectorUserMessage(summary, draft),
              maxRetries: 1,
            });

            // Emit partial snapshots as they come in. Each partial is
            // translated to a full PlanPatch shape so the client can
            // render it incrementally without knowing about the lean/rich
            // split. Some fields may be undefined — applyPatch + the HUD
            // tolerate that.
            for await (const partial of result.partialObjectStream) {
              try {
                const loose: ClaudePatch = {
                  arc: partial.arc ?? '',
                  style: partial.style ?? '',
                  sectionEdits: (partial.sectionEdits ?? []).filter(
                    (e): e is NonNullable<typeof e> =>
                      !!e && typeof e === 'object',
                  ) as ClaudePatch['sectionEdits'],
                  hitCues: (partial.hitCues ?? []).filter(
                    (c): c is NonNullable<typeof c> =>
                      !!c && typeof c === 'object',
                  ) as ClaudePatch['hitCues'],
                  warnings: (partial.warnings ?? []).filter(
                    (w): w is string => typeof w === 'string',
                  ),
                };
                const rich = claudePatchToPlanPatch(loose);
                write({ t: 'partial', patch: rich });
              } catch {
                // Skip malformed partials — they smooth out as the
                // response completes.
              }
            }

            const final = await result.object;
            patch = claudePatchToPlanPatch(final);
          } catch (err) {
            claudeError = err instanceof Error ? err.message : String(err);
          }
        } else {
          claudeError = 'ANTHROPIC_API_KEY not set — returning draft-only plan.';
        }

        const show = applyPatch(draft, patch);

        const response: CachedResponse = {
          summary,
          draft,
          patch,
          show,
          claudeError,
        };

        if (!claudeError) {
          void writeCache(key, response);
        }

        write({ t: 'final', patch, show, claudeError });
        controller.close();
      } catch (err) {
        write({
          t: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson',
      'cache-control': 'no-store',
    },
  });
}
