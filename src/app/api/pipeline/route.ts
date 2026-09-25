import { addNote, addReview, addCueReview, analyzeMovement, movementAnalysis, cancelRun, catalog, frames, guard, snapshot, startRun } from '@/lib/pipeline/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    guard(request);
    const url = new URL(request.url), run = url.searchParams.get('run');
    const view = url.searchParams.get('view');
    return Response.json(run ? (view === 'frames' ? await frames(run) : view === 'movement' ? await movementAnalysis(run) : await snapshot(run)) : await catalog(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Pipeline unavailable' }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    guard(request, true);
    if (!request.headers.get('content-type')?.includes('application/json')) throw Error('JSON required');
    const text = await request.text();
    if (text.length > 8000) throw Error('Request too large');
    const body = JSON.parse(text);
    if (body.action === 'start') return Response.json({ id: await startRun(body.sourceId, body.start, body.duration) });
    if (body.action === 'note' && typeof body.text === 'string') return Response.json(await addNote(body.run, body.t, body.text));
    if (body.action === 'review') return Response.json(await addReview(body.run, body.review));
    if (body.action === 'analyze') return Response.json(await analyzeMovement(body.run));
    if (body.action === 'cue-review') return Response.json(await addCueReview(body.run, body.review));
    if (body.action === 'cancel') { await cancelRun(body.run); return Response.json({ ok: true }); }
    throw Error('Unknown action');
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : 'Pipeline action failed' }, { status: 400 }); }
}
