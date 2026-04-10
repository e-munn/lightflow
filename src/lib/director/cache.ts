/**
 * Simple disk cache for director runs.
 *
 * Key: SHA-256 of (analysis JSON + director version + prompt version).
 * Value: the full `{summary, draft, patch, show, claudeError}` response.
 *
 * Invalidation is automatic: bumping DIRECTOR_VERSION in modulators.ts
 * changes the draft, which changes the hash. The prompt version below
 * should be bumped when you meaningfully edit prompt.ts so cached
 * Claude outputs don't stick around after you've taught it new taste.
 *
 * Stored at ./.director-cache/ (git-ignored). Dev-only convenience —
 * disabled in production (writes are safe, reads just miss).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DIRECTOR_VERSION } from '@/lib/modulators';

// Bump when you edit prompt.ts meaningfully — forces a re-run on next drop.
export const PROMPT_VERSION = 'p2-2026-04-09-barpattern';

const CACHE_DIR = path.resolve(process.cwd(), '.director-cache');

export function cacheKey(analysis: unknown): string {
  const h = createHash('sha256');
  h.update(DIRECTOR_VERSION);
  h.update('|');
  h.update(PROMPT_VERSION);
  h.update('|');
  // Stable stringify: JSON.stringify is deterministic for object literals
  // coming from JSON.parse() of a fixed file, which is our path here.
  h.update(JSON.stringify(analysis));
  return h.digest('hex').slice(0, 24);
}

async function ensureDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const buf = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf8');
    return JSON.parse(buf) as T;
  } catch {
    return null;
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await ensureDir();
    await fs.writeFile(
      path.join(CACHE_DIR, `${key}.json`),
      JSON.stringify(value),
      'utf8',
    );
  } catch (err) {
    // Cache failures are never fatal
    console.warn('[director cache] write failed:', err);
  }
}
