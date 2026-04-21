import type { Scout, MomentCue, SectionAnnotation } from './schema';

/**
 * Find the active moment cue at the given time, accounting for
 * anticipation windows. Returns the highest-confidence cue if
 * multiple overlap.
 */
export function getActiveMoment(
  moments: MomentCue[],
  time: number,
  bpm: number,
  confidenceThreshold = 0.5,
): MomentCue | null {
  const beatSec = 60 / bpm;
  let best: MomentCue | null = null;

  for (const m of moments) {
    if (m.confidence < confidenceThreshold) continue;
    const start = m.t - m.anticipationBeats * beatSec;
    const end = m.t + m.durationBeats * beatSec;
    if (time >= start && time < end) {
      if (!best || m.confidence > best.confidence) best = m;
    }
  }
  return best;
}

/**
 * Whether we're in the anticipation window (before the cue's timestamp)
 * vs the active window (at or after the timestamp).
 */
export function isAnticipating(cue: MomentCue, time: number, bpm: number): boolean {
  return time < cue.t;
}

/**
 * Get the section annotation for a given analysis section index.
 */
export function getSectionAnnotation(
  sections: SectionAnnotation[],
  sectionIndex: number,
): SectionAnnotation | null {
  return sections.find(s => s.sectionIndex === sectionIndex) ?? null;
}

/**
 * Parse a modulatorHint string into mod + rate for the director.
 */
export function parseModulatorHint(hint: string): { mod: 'raw' | 'pulse'; rate: number } {
  if (hint === 'raw') return { mod: 'raw', rate: 0 };
  if (hint === 'blackout') return { mod: 'raw', rate: -1 };
  // 'pulse:N' or 'strobe:N'
  const rate = parseInt(hint.split(':')[1], 10);
  return { mod: 'pulse', rate };
}

/**
 * Build adjusted stem priority weights from scout config.
 * Returns a map that can be multiplied onto the attention layer's PRIORITY.
 */
export function buildStemWeights(scout: Scout | null): Record<string, number> {
  const weights: Record<string, number> = {};
  if (!scout) return weights;

  if (scout.primaryStem) {
    weights[scout.primaryStem] = 1.3;
  }
  return weights;
}

/**
 * Detect stem entries from analysis frames. Returns moment-cue-shaped
 * objects with type "stem_entry:<stem>". Runs deterministically at song
 * load — no Claude needed.
 */
export interface StemEntryCue {
  t: number;
  type: string;
  stem: string;
  durationBeats: number;
  confidence: number;
}

export function detectStemEntries(
  frames: Array<{ time: number; stems: unknown }>,
  bpm: number,
  fps: number,
): StemEntryCue[] {
  const STEMS = ['bass', 'kick', 'snare', 'hat', 'other', 'vocals'];
  const entries: StemEntryCue[] = [];
  const windowSize = fps * 2;
  const step = Math.max(1, Math.floor(fps / 5));
  const beatSec = 60 / bpm;

  for (const stem of STEMS) {
    let lastEntryTime = -10;
    for (let i = windowSize; i < frames.length - windowSize; i += step) {
      let prevSum = 0, nextSum = 0;
      for (let j = i - windowSize; j < i; j++) {
        const st = frames[j].stems as unknown as Record<string, number>;
        prevSum += st[stem] ?? 0;
      }
      for (let j = i; j < i + windowSize; j++) {
        const st = frames[j].stems as unknown as Record<string, number>;
        nextSum += st[stem] ?? 0;
      }
      const prevMean = prevSum / windowSize;
      const nextMean = nextSum / windowSize;
      if (prevMean < 0.05 && nextMean > 0.15 && frames[i].time - lastEntryTime > 5) {
        const t = Math.round(frames[i].time / beatSec) * beatSec;
        entries.push({
          t: +t.toFixed(2),
          type: `stem_entry:${stem}`,
          stem,
          durationBeats: 8,
          confidence: +Math.min(1, (nextMean - prevMean) * 3).toFixed(2),
        });
        lastEntryTime = frames[i].time;
      }
    }
  }

  return entries.filter(e => e.confidence >= 0.5).sort((a, b) => a.t - b.t);
}

/**
 * Load and validate a scout file. Returns null if missing or invalid.
 */
export async function loadScout(songSlug: string): Promise<Scout | null> {
  try {
    const res = await fetch(`/songs/${songSlug}_scout.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const { ScoutSchema } = await import('./schema');
    const parsed = ScoutSchema.safeParse(data);
    if (!parsed.success) {
      console.warn('[scout] Invalid scout file:', parsed.error);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
