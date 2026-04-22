/**
 * Show storage for the MIDI recorder.
 *
 * GET  /api/shows        → { slugs: string[] } of songs with a saved show
 * POST /api/shows        → writes public/songs/<slug>_show.json (last-rec-wins)
 *                          body: { song, songDuration, bpm, events }
 *
 * Persistence: on-disk JSON under public/songs/ so the browser can also
 * fetch them via the static asset path for replay/training consumption.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

const SONGS_DIR = join(process.cwd(), 'public', 'songs');
const SHOW_SUFFIX = '_show.json';

export async function GET() {
  try {
    const entries = await readdir(SONGS_DIR);
    const slugs = entries
      .filter((f) => f.endsWith(SHOW_SUFFIX))
      .map((f) => f.slice(0, -SHOW_SUFFIX.length));
    return NextResponse.json({ slugs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const slug = String(body.slug ?? body.song ?? '').trim();
    if (!slug) {
      return NextResponse.json({ error: 'missing slug' }, { status: 400 });
    }
    if (!Array.isArray(body.events)) {
      return NextResponse.json({ error: 'events must be an array' }, { status: 400 });
    }
    const safe = slug.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const outPath = join(SONGS_DIR, `${safe}${SHOW_SUFFIX}`);

    const show = {
      song: slug,
      recordedAt: new Date().toISOString(),
      songDuration: body.songDuration ?? null,
      bpm: body.bpm ?? null,
      startTime: body.startTime ?? null,
      endTime: body.endTime ?? null,
      eventCount: body.events.length,
      events: body.events,
    };

    await writeFile(outPath, JSON.stringify(show, null, 2), 'utf8');
    return NextResponse.json({ ok: true, slug: safe, path: `/songs/${safe}${SHOW_SUFFIX}` });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const slug = url.searchParams.get('slug');
    if (!slug) {
      return NextResponse.json({ error: 'missing slug' }, { status: 400 });
    }
    const safe = slug.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const target = join(SONGS_DIR, `${safe}${SHOW_SUFFIX}`);
    // unlink via writeFile to empty file would be wrong; import unlink properly.
    const { unlink } = await import('fs/promises');
    try {
      await unlink(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Utility: read a single show. Handy for replay flows.
export async function _unused_readShow(slug: string) {
  try {
    const safe = slug.replace(/[^a-zA-Z0-9._\-]/g, '_');
    const buf = await readFile(join(SONGS_DIR, `${safe}${SHOW_SUFFIX}`), 'utf8');
    return JSON.parse(buf);
  } catch {
    return null;
  }
}
