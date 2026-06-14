// The phone remote POSTs { key } here; we relay it to the console's SSE stream.
import { NextRequest, NextResponse } from 'next/server';
import { emit } from '@/lib/remoteBus';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const key = body?.key;
  if (typeof key === 'string') emit(JSON.stringify({ key }));
  return NextResponse.json({ ok: true });
}
