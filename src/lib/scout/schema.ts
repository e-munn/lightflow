import { z } from 'zod';

const StemName = z.enum(['bass', 'kick', 'snare', 'hat', 'other', 'vocals']);

// ── Moment cues ─────────────────────────────────────────────────────

const MomentCueSchema = z.object({
  t: z.number(),
  type: z.enum([
    'drop', 'lift', 'breakdown', 'fake_out',
    'vocal_entry', 'bass_drop', 'silence', 'key_change',
  ]),
  anticipationBeats: z.number(),
  durationBeats: z.number(),
  intensity: z.number(),
  confidence: z.number(),
});

// ── Section annotations ─────────────────────────────────────────────

const SectionAnnotationSchema = z.object({
  sectionIndex: z.number(),
  semanticLabel: z.string(),
  stemFocus: StemName.optional(),
  signalMode: z.enum(['raw', 'shaped']).optional(),
  modulatorHint: z.string().optional(),
  intensityScale: z.number().optional(),
  suppressEscalation: z.boolean().optional(),
});

// ── Top-level scout file ────────────────────────────────────────────

export const ScoutSchema = z.object({
  version: z.number(),
  song: z.string(),
  bpm: z.number(),
  arc: z.string(),
  primaryStem: StemName.optional(),
  modulatorBias: z.enum(['conservative', 'moderate', 'aggressive']).optional(),
  moments: z.array(MomentCueSchema),
  sections: z.array(SectionAnnotationSchema),
});

export type Scout = z.infer<typeof ScoutSchema>;
export type MomentCue = z.infer<typeof MomentCueSchema>;
export type SectionAnnotation = z.infer<typeof SectionAnnotationSchema>;

// Compat types for apply.ts — config is now flattened into top-level
export type SongConfig = {
  primaryStem?: string;
  stemWeights?: Record<string, number>;
  stemSignalMode?: Record<string, string>;
  modulatorBias?: string;
};
export type BlackoutRule = { condition: string; beats?: number };
