/**
 * Rating storage API.
 *
 * GET  /api/ratings        → entire ratings JSON
 * POST /api/ratings        → upsert one rating (body: { id, rating, tags?, version, songSlug, startCs, lengthCs })
 * DELETE /api/ratings?id=  → drop one rating
 *
 * Persists to data/test_ratings.json at the repo root. The file is plain
 * JSON and meant to be committed, so the team's rating set lives in version
 * control alongside the Director it's evaluating.
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Avoid Next caching the API route at build time
export const dynamic = 'force-dynamic';

const RATINGS_PATH = path.join(process.cwd(), 'data', 'test_ratings.json');

interface Rating {
  id: string;             // stable clip id e.g. "actin_tough@420+800"
  rating: 'good' | 'bad' | 'skip';
  tags: string[];
  ts: number;             // wall-clock ms
  version: string;        // director version this rating was made against
  songSlug: string;
  startCs: number;        // start position in centiseconds
  lengthCs: number;       // clip length in centiseconds
}

interface RatingsFile {
  version: 1;
  updatedAt: number;
  ratings: Record<string, Rating>;   // id -> rating
}

const EMPTY: RatingsFile = { version: 1, updatedAt: 0, ratings: {} };

async function readFile(): Promise<RatingsFile> {
  try {
    const raw = await fs.readFile(RATINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as RatingsFile;
    if (!parsed.ratings || typeof parsed.ratings !== 'object') return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

async function writeFile(data: RatingsFile) {
  await fs.mkdir(path.dirname(RATINGS_PATH), { recursive: true });
  await fs.writeFile(RATINGS_PATH, JSON.stringify(data, null, 2));
}

export async function GET() {
  const data = await readFile();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { id, rating, tags, version, songSlug, startCs, lengthCs } = body as Partial<Rating>;
  if (!id || !rating || !version || !songSlug ||
      typeof startCs !== 'number' || typeof lengthCs !== 'number') {
    return NextResponse.json({ error: 'missing required fields' }, { status: 400 });
  }
  if (rating !== 'good' && rating !== 'bad' && rating !== 'skip') {
    return NextResponse.json({ error: 'invalid rating' }, { status: 400 });
  }

  const data = await readFile();
  data.ratings[id] = {
    id,
    rating,
    tags: Array.isArray(tags) ? tags : [],
    ts: Date.now(),
    version,
    songSlug,
    startCs,
    lengthCs,
  };
  data.updatedAt = Date.now();
  await writeFile(data);
  return NextResponse.json({ ok: true, count: Object.keys(data.ratings).length });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  const data = await readFile();
  if (data.ratings[id]) {
    delete data.ratings[id];
    data.updatedAt = Date.now();
    await writeFile(data);
  }
  return NextResponse.json({ ok: true });
}
