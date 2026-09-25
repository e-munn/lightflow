import {NextRequest, NextResponse} from 'next/server';
import {JevError, requestJev, snapshotSchema} from '@/lib/jev/live-client.mjs';

export const runtime = 'nodejs';
let inFlight = false;
let lastStart = 0;
const reply = (data: unknown, status = 200) => NextResponse.json(data, {status, headers: {'Cache-Control': 'no-store'}});

export async function POST(request: NextRequest) {
  // This unauthenticated experiment is local-only, never a public paid proxy.
  let host = '';
  try { host = new URL(`http://${request.headers.get('host') || ''}`).hostname; } catch { /* Rejected below. */ }
  if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(host)) {
    return reply({error: 'Jev is available only in the local research server.'}, 403);
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) return reply({error: 'Origin not allowed.'}, 403);
  if (!process.env.TYPESAFE_API_KEY) return reply({error: 'TYPESAFE_API_KEY is not configured on the server.'}, 503);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return reply({error: 'JSON required.'}, 415);
  if (Number(request.headers.get('content-length')) > 8192) return reply({error: 'Request too large.'}, 413);
  // Bound streamed requests too, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return reply({error: 'Signal context required.'}, 400);
  const parts: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); return reply({error: 'Request too large.'}, 413); }
      parts.push(value);
    }
  } catch { return reply({error: 'Incomplete request.'}, 400); }
  let body;
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { return reply({error: 'Invalid JSON.'}, 400); }
  const parsed = snapshotSchema.safeParse(body);
  if (!parsed.success) return reply({error: 'Invalid signal context.'}, 400);
  if (inFlight || Date.now() - lastStart < 200) return reply({error: 'Wait before requesting another decision.'}, 429);
  inFlight = true; lastStart = Date.now();
  try {
    return reply(await requestJev(parsed.data, {key: process.env.TYPESAFE_API_KEY, signal: request.signal}));
  } catch (error) {
    return reply({error: error instanceof JevError ? error.message : 'Decision unavailable.'}, error instanceof JevError ? error.status : 502);
  } finally { inFlight = false; }
}
