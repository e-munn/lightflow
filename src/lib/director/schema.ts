/**
 * Zod schemas for the Claude lighting director.
 *
 * Architecture: Claude is an EDITOR, not an author.
 *   1. StemSummary   — compressed stem-aware analysis (engine → Claude)
 *   2. DraftPlan     — what the local engine (focus decider + modulators)
 *                      would already do, rendered offline section-by-section
 *   3. PlanPatch     — small diff Claude returns to refine the draft
 *   4. ShowPlan      — DraftPlan + PlanPatch applied; what actually plays
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Grid constants (mirror src/lib/effects.ts)
// ---------------------------------------------------------------------------

export const NUM_TUBES = 8;
export const PIXELS_PER_TUBE = 16;

// ===========================================================================
// 1. StemSummary — what we send TO Claude
// ===========================================================================

export const StemTimelineSchema = z.object({
  energy: z.array(z.number()),
  onsets: z.array(z.number()).optional(),
});

export const DrumsTimelineSchema = z.object({
  energy: z.array(z.number()),
  kickOnsets: z.array(z.number()),
  snareOnsets: z.array(z.number()),
  hatDensity: z.array(z.number()),
});

export const SectionHintSchema = z.object({
  start: z.number(),
  end: z.number(),
  label: z.string(),
});

export const EventCandidateSchema = z.object({
  t: z.number(),
  type: z.enum([
    'drop_candidate',
    'breakdown_start',
    'riser_end',
    'vocal_entry',
    'vocal_exit',
    'bass_drop',
    'silence',
    'big_transient',
  ]),
  confidence: z.number(),
});

export const StemSummarySchema = z.object({
  song: z.string(),
  duration: z.number(),
  bpm: z.number(),
  bpmConfidence: z.number().default(0.8),
  frameRate: z.number().default(2),
  downbeats: z.array(z.number()),
  sections: z.array(SectionHintSchema),
  stems: z.object({
    vocals: StemTimelineSchema,
    drums: DrumsTimelineSchema,
    bass: StemTimelineSchema,
    other: StemTimelineSchema,
  }),
  chromaMean: z.array(z.array(z.number()).length(12)).optional(),
  events: z.array(EventCandidateSchema),
});

export type StemSummary = z.infer<typeof StemSummarySchema>;

// ===========================================================================
// Effect vocabulary (locked to src/lib/effects.ts:926-958)
// ===========================================================================

export const EFFECT_NAMES = [
  'solid', 'gradient', 'color_wash', 'bass_fill', 'kick_flash',
  'snare_accent', 'hat_sparkle', 'vocal_wave', 'energy_pulse', 'chase',
  'scan', 'rain', 'ripple', 'buildup_rise', 'strobe', 'blackout',
  'fade_in', 'fade_out', 'pan_sweep', 'spectral_color', 'flux_burst',
  'breathe', 'meteor', 'firefly', 'strobe_chase', 'impact', 'lighthouse',
  'breathe_y', 'candles', 'firecracker', 'abracadabra',
] as const;

export const EffectNameSchema = z.enum(EFFECT_NAMES);

export const IntensitySourceSchema = z.enum([
  'none', 'vocals', 'bass', 'kick', 'snare', 'hat', 'drums', 'other', 'rms',
]);

export const ColorSchema = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
});

export const RegionSchema = z.object({
  preset: z
    .enum(['all', 'top', 'bottom', 'outer', 'inner', 'left', 'right'])
    .optional(),
  tubes: z.array(z.number()).optional(),
  pixelRange: z.object({ start: z.number(), end: z.number() }).optional(),
});

export const BlendModeSchema = z.enum(['max', 'add', 'replace']);

export const EffectInstanceSchema = z.object({
  effect: EffectNameSchema,
  color: ColorSchema.default({ r: 1, g: 1, b: 1 }),
  secondaryColor: ColorSchema.optional(),
  intensitySource: IntensitySourceSchema.default('none'),
  region: RegionSchema.default({ preset: 'all' }),
  speed: z.number().default(1),
  direction: z
    .enum(['up', 'down', 'left', 'right', 'outward', 'inward'])
    .default('up'),
  blendMode: BlendModeSchema.default('max'),
  intensity: z.number().default(1),
  attackMs: z.number().default(50),
  releaseMs: z.number().default(200),
  attackBeats: z.number().optional(),
  releaseBeats: z.number().optional(),
  panFollow: z.boolean().default(false),
  onsetMode: z.boolean().default(false),
});

export type EffectInstance = z.infer<typeof EffectInstanceSchema>;

// ===========================================================================
// 2. DraftPlan — what the engine produced offline
// ===========================================================================

/**
 * Bar-level pattern archetypes the engine can synthesize inside a
 * section instead of playing one solid fx block.
 *
 * Hard rule: **a single fast-pulse run never exceeds 2 bars (8 beats)
 * of consecutive on-time.** All non-solid patterns chunk the section
 * into 1-bar pulse bursts with raw gaps and rate decay so the timeline
 * looks composed instead of a flat 16-bar strobe.
 */
export const BAR_PATTERNS = [
  'solid',
  'solid-blackout-last',
  'every-4-bars',
  'every-2-bars',
  'alternating',
] as const;

export const BarPatternSchema = z.enum(BAR_PATTERNS);
export type BarPattern = z.infer<typeof BarPatternSchema>;

export const DraftSectionSchema = z.object({
  sectionLabel: z.string(),
  start: z.number(),
  end: z.number(),
  /** The focus decider's chosen stem for this section */
  focusStem: z.enum(['bass', 'kick', 'snare', 'hat', 'other', 'vocals']),
  /** Modulator the Director would pick here (raw / pulse / strobe) */
  modulator: z.string(),
  /** Layered base effects */
  effects: z.array(EffectInstanceSchema),
  /** One-line reason the engine chose this (for Claude to read) */
  rationale: z.string(),
  /** Bar-level pattern — engine sets 'solid' by default; Claude may override. */
  barPattern: BarPatternSchema.default('solid'),
});

export type DraftSection = z.infer<typeof DraftSectionSchema>;

export const DraftPlanSchema = z.object({
  song: z.string(),
  bpm: z.number(),
  directorVersion: z.string(),
  sections: z.array(DraftSectionSchema),
});

export type DraftPlan = z.infer<typeof DraftPlanSchema>;

// ===========================================================================
// 3. PlanPatch — small diff Claude returns
// ===========================================================================

export const HitCueSchema = z.object({
  t: z.number(),
  label: z.string(),
  effect: EffectInstanceSchema,
  duration: z.number().default(0.25),
});

export type HitCue = z.infer<typeof HitCueSchema>;

export const SectionEditSchema = z.object({
  sectionIndex: z.number(),
  intentOverride: z.string().optional()
    .describe('One-line Claude interpretation of the section'),
  paletteShift: z.object({
    color: ColorSchema,
    reason: z.string(),
  }).optional(),
  intensityScale: z.number().optional()
    .describe('Multiplier on all effect intensities in this section'),
  addEffect: EffectInstanceSchema.optional()
    .describe('At most one added effect per section'),
  removeEffectIndex: z.number().optional()
    .describe('Index into draft section.effects to remove'),
  swapEffect: z.object({
    index: z.number(),
    to: EffectNameSchema,
  }).optional(),
  barPattern: BarPatternSchema.optional(),
  reason: z.string().describe('Why this edit — for the UI undo panel'),
});

export type SectionEdit = z.infer<typeof SectionEditSchema>;

export const PlanPatchSchema = z.object({
  /** One-line arc narrative for the whole song */
  arc: z.string(),
  /** Style / vibe tag — informs downstream palette logic */
  style: z.string(),
  /** Targeted section tweaks. Empty is a valid patch. */
  sectionEdits: z.array(SectionEditSchema).default([]),
  /** Timestamped one-shots. The engine cannot infer these — this is
   *  Claude's biggest contribution. */
  hitCues: z.array(HitCueSchema).default([]),
  /** Taste-rule violations Claude corrected, for the UI */
  warnings: z.array(z.string()).default([]),
});

export type PlanPatch = z.infer<typeof PlanPatchSchema>;

// ===========================================================================
// 3b. ClaudePatch — the *minimal* schema we actually send to Claude as the
//     output structure. PlanPatch is too rich (deeply-nested EffectInstance
//     with 15+ default fields) for Zod4→JSON-Schema→Anthropic tool conversion
//     to handle. We keep Claude's output high-level and translate it into
//     the full PlanPatch inside `applyPatch`.
//
//     Rules Claude is allowed to express:
//       - section intent override (free text)
//       - per-section intensity scaling (0.5 … 1.5)
//       - per-section color hint (warm / cool / neutral / vivid / dark)
//       - hit cues: { t, label, intensity }
//       - warnings: free text rule-violation notes
// ===========================================================================

export const ClaudeSectionEditSchema = z.object({
  sectionIndex: z.number(),
  intent: z.string().describe('One-line interpretation of the section'),
  intensityScale: z.number().describe('0.5 (calmer) to 1.5 (busier). 1.0 = no change.'),
  palette: z.enum(['warm', 'cool', 'neutral', 'vivid', 'dark']).describe('Color family hint'),
  barPattern: BarPatternSchema.describe(
    'How pulse bursts are distributed across the section bars. ' +
    'Use "solid" for short or slow sections. Use "every-4-bars" or "every-2-bars" ' +
    'for any fast-pulse section longer than 4 bars — the engine will emit 1-bar ' +
    'pulse bursts with raw gaps and step the rate down across bursts. ' +
    'Use "solid-blackout-last" for endings. Use "alternating" for sustained ' +
    'tension that shouldn\'t decay.',
  ),
  reason: z.string().describe('Why this edit — shown in the UI'),
});
export type ClaudeSectionEdit = z.infer<typeof ClaudeSectionEditSchema>;

export const ClaudeHitCueSchema = z.object({
  t: z.number().describe('Time in seconds from song start'),
  label: z.string().describe('Short name: drop / lift / breakdown / stab / chorus-start / etc'),
  intensity: z.number().describe('0 to 1 — how punchy this hit should be'),
});
export type ClaudeHitCue = z.infer<typeof ClaudeHitCueSchema>;

export const ClaudePatchSchema = z.object({
  arc: z.string().describe('One-line narrative of the whole song'),
  style: z.string().describe('Genre / vibe tag (e.g. "boom-bap", "disco", "ambient")'),
  sectionEdits: z.array(ClaudeSectionEditSchema).describe('High-level section tweaks'),
  hitCues: z.array(ClaudeHitCueSchema).describe('Timestamped punctuation moments'),
  warnings: z.array(z.string()).describe('Issues Claude noticed in the draft'),
});
export type ClaudePatch = z.infer<typeof ClaudePatchSchema>;

// ===========================================================================
// 4. ShowPlan — draft + patch merged (what actually plays)
// ===========================================================================

export const SectionPlanSchema = DraftSectionSchema.extend({
  intent: z.string(),
});
export type SectionPlan = z.infer<typeof SectionPlanSchema>;

export const ShowPlanSchema = z.object({
  song: z.string(),
  bpm: z.number(),
  style: z.string(),
  arc: z.string(),
  directorVersion: z.string(),
  sections: z.array(SectionPlanSchema),
  hitCues: z.array(HitCueSchema).default([]),
  /** Provenance: which edits came from Claude */
  claudeWarnings: z.array(z.string()).default([]),
});

export type ShowPlan = z.infer<typeof ShowPlanSchema>;
