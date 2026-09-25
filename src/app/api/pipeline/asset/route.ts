import { createReadStream } from 'node:fs';
import { stat, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { guard, runDirectory, snapshot } from '@/lib/pipeline/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const TYPES: Record<string, string> = { 'preview.mp4': 'video/mp4', 'audio.m4a': 'audio/mp4', 'worker.log': 'text/plain' };
export async function GET(request: Request) {
  try {
    guard(request);
    const url = new URL(request.url), run = url.searchParams.get('run') ?? '', asset = url.searchParams.get('file') ?? '';
    if (!TYPES[asset]) return new Response('Unknown asset', { status: 404 });
    const state = await snapshot(run);
    if ((asset === 'preview.mp4' && !state.preview) || (asset === 'audio.m4a' && !state.audio)) return new Response('Asset still processing', { status: 409 });
    const file = path.join(runDirectory(run), asset);
    if (asset === 'worker.log') return new Response(await readFile(file, 'utf8'), { headers: { 'Content-Type': TYPES[asset], 'Cache-Control': 'no-store' } });
    const { size } = await stat(file), range = request.headers.get('range');
    let start = 0, end = size - 1;
    const invalid = () => new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) return invalid();
      if (!m[1]) { if (Number(m[2]) <= 0) return invalid(); start = Math.max(0, size - Number(m[2])); }
      else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return invalid();
    }
    const stream = createReadStream(file, { start, end });
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    const headers: Record<string, string> = { 'Content-Type': TYPES[asset], 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1), 'Cache-Control': 'no-store' };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch { return new Response('Asset unavailable; check SanDisk and run status.', { status: 503 }); }
}
