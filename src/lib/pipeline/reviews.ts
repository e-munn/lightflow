import type { IdentityReview } from './types';

export function validateReview(value: unknown, duration: number): Omit<IdentityReview, 'id' | 'createdAt'> {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== 'object' || typeof v.start !== 'number' || typeof v.end !== 'number' ||
      !Number.isFinite(v.start) || !Number.isFinite(v.end) || v.start < 0 || v.end < v.start || v.end > duration ||
      !['sampled', 'continuous'].includes(String(v.method)) || !['clear', 'issue'].includes(String(v.outcome)) ||
      !['user', 'assistant', 'automated'].includes(String(v.reviewer)) || typeof v.text !== 'string' || !v.text.trim() || v.text.length > 2000 ||
      (v.method === 'continuous' && v.end === v.start)) throw Error('Choose a valid reviewed interval, method, outcome, and note');
  return { start: v.start, end: v.end, method: v.method, outcome: v.outcome, reviewer: v.reviewer, text: v.text.trim() } as Omit<IdentityReview, 'id' | 'createdAt'>;
}

export function identityStatus(reviews: IdentityReview[], duration: number) {
  const visual = reviews.filter(r => r.reviewer !== 'automated');
  if (!visual.length) return 'Not audited';
  if (visual.some(r => r.outcome === 'issue')) return 'Issues flagged';
  // Sampled spans must never be summed into a claim of continuous review.
  const intervals = visual.filter(r => r.method === 'continuous').map(r => [r.start, r.end]).sort((a, b) => a[0] - b[0]);
  let end = 0;
  for (const [a, b] of intervals) { if (a > end + 0.001) break; end = Math.max(end, b); }
  return end >= duration - 0.001 ? 'Entire span reviewed' : 'Partially reviewed';
}
