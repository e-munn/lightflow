/**
 * Apply a Claude-authored PlanPatch onto the engine's DraftPlan.
 *
 * Deterministic and pure. The draft is the source of truth; the patch
 * can only tweak within the small vocabulary defined in schema.ts.
 */

import type {
  DraftPlan,
  PlanPatch,
  ShowPlan,
  SectionPlan,
  EffectInstance,
  HitCue,
  ClaudePatch,
} from './schema';

// ---------------------------------------------------------------------------
// ClaudePatch → PlanPatch
// Claude returns a minimal high-level patch. We translate it into the rich
// PlanPatch shape the engine knows how to apply. Keeps Claude's output
// schema simple enough that Zod4 → JSON Schema → Anthropic conversion
// doesn't blow up on defaulted nested objects.
// ---------------------------------------------------------------------------

const PALETTE_COLORS: Record<string, { r: number; g: number; b: number }> = {
  warm:    { r: 1.0, g: 0.6, b: 0.3 },
  cool:    { r: 0.3, g: 0.6, b: 1.0 },
  neutral: { r: 0.9, g: 0.9, b: 0.9 },
  vivid:   { r: 1.0, g: 0.2, b: 0.8 },
  dark:    { r: 0.3, g: 0.2, b: 0.4 },
};

/**
 * Map a Claude hit-cue label to a concrete effect + default visuals.
 *
 * Claude's `ClaudeHitCue` only carries {t, label, intensity}, so the
 * specific visual is picked here. Each label family gets a sensibly
 * different effect so "drop", "breakdown", "lift" etc. don't all look
 * identical in the HUD and on the rig.
 */
interface HitCueVisual {
  effect: EffectInstance['effect'];
  color: EffectInstance['color'];
  duration: number;
  attackMs: number;
  releaseMs: number;
}

function hitCueVisual(label: string): HitCueVisual {
  const l = label.toLowerCase();

  // Pre-drop anticipation blackout
  if (/blackout|silence|cut/.test(l)) {
    return {
      effect: 'blackout',
      color: { r: 0, g: 0, b: 0 },
      duration: 0.35,
      attackMs: 5,
      releaseMs: 80,
    };
  }

  // THE drop — full white impact
  if (/^drop|bass[- ]?drop|big[- ]?drop/.test(l)) {
    return {
      effect: 'impact',
      color: { r: 1, g: 1, b: 1 },
      duration: 0.5,
      attackMs: 8,
      releaseMs: 320,
    };
  }

  // Risers / lifts — rising fill, amber
  if (/lift|riser|build[- ]?up|build$/.test(l)) {
    return {
      effect: 'buildup_rise',
      color: { r: 1, g: 0.75, b: 0.25 },
      duration: 0.4,
      attackMs: 20,
      releaseMs: 250,
    };
  }

  // Stabs / chops — short burst
  if (/stab|chop|hit\b/.test(l)) {
    return {
      effect: 'flux_burst',
      color: { r: 1, g: 0.5, b: 0.1 },
      duration: 0.22,
      attackMs: 5,
      releaseMs: 150,
    };
  }

  // Breakdown marker — sweeping scanner
  if (/breakdown|break\b/.test(l)) {
    return {
      effect: 'scan',
      color: { r: 0.4, g: 0.3, b: 0.9 },
      duration: 0.6,
      attackMs: 30,
      releaseMs: 400,
    };
  }

  // Section openers — kick_flash with section-ish color
  if (/chorus|verse|section|opener|start/.test(l)) {
    return {
      effect: 'kick_flash',
      color: { r: 0.9, g: 0.6, b: 1 },
      duration: 0.3,
      attackMs: 10,
      releaseMs: 180,
    };
  }

  // Vocal chops / ad-libs
  if (/vocal|ad[- ]?lib|phrase/.test(l)) {
    return {
      effect: 'snare_accent',
      color: { r: 0.95, g: 0.3, b: 0.7 },
      duration: 0.25,
      attackMs: 8,
      releaseMs: 160,
    };
  }

  // Default — neutral impact
  return {
    effect: 'impact',
    color: { r: 0.9, g: 0.9, b: 1 },
    duration: 0.3,
    attackMs: 15,
    releaseMs: 200,
  };
}

export function claudePatchToPlanPatch(c: ClaudePatch): PlanPatch {
  return {
    arc: c.arc,
    style: c.style,
    sectionEdits: c.sectionEdits.map((e) => ({
      sectionIndex: e.sectionIndex,
      intentOverride: e.intent,
      intensityScale: e.intensityScale,
      paletteShift: PALETTE_COLORS[e.palette]
        ? { color: PALETTE_COLORS[e.palette], reason: `palette: ${e.palette}` }
        : undefined,
      barPattern: e.barPattern,
      reason: e.reason,
    })),
    hitCues: c.hitCues.map((h) => {
      const v = hitCueVisual(h.label);
      return {
        t: h.t,
        label: h.label,
        duration: v.duration,
        effect: {
          effect: v.effect,
          color: v.color,
          secondaryColor: undefined,
          intensitySource: 'none' as const,
          region: { preset: 'all' as const },
          speed: 1,
          direction: 'up' as const,
          blendMode: 'max' as const,
          intensity: h.intensity,
          attackMs: v.attackMs,
          releaseMs: v.releaseMs,
          attackBeats: undefined,
          releaseBeats: undefined,
          panFollow: false,
          onsetMode: false,
        },
      };
    }),
    warnings: c.warnings,
  };
}

function scaleIntensity(effect: EffectInstance, scale: number): EffectInstance {
  return {
    ...effect,
    intensity: Math.max(0, Math.min(1, effect.intensity * scale)),
  };
}

function applyPaletteShift(
  effects: EffectInstance[],
  color: { r: number; g: number; b: number },
): EffectInstance[] {
  // Only shift effects that currently use a neutral/white-ish or unset color.
  // Leave effects that chose a specific non-white color alone.
  return effects.map((e) => {
    const { r, g, b } = e.color;
    const isNeutral =
      Math.abs(r - g) < 0.1 && Math.abs(g - b) < 0.1 && r > 0.5;
    return isNeutral ? { ...e, color } : e;
  });
}

export function applyPatch(draft: DraftPlan, patch: PlanPatch): ShowPlan {
  const editsByIndex = new Map<number, typeof patch.sectionEdits[number]>();
  for (const edit of patch.sectionEdits) {
    editsByIndex.set(edit.sectionIndex, edit);
  }

  const sections: SectionPlan[] = draft.sections.map((section, i) => {
    const edit = editsByIndex.get(i);
    if (!edit) {
      return { ...section, intent: section.rationale };
    }

    let effects = section.effects.slice();

    // Remove first so indices stay stable for swap
    if (edit.removeEffectIndex !== undefined) {
      effects = effects.filter((_, j) => j !== edit.removeEffectIndex);
    }

    if (edit.swapEffect) {
      const { index, to } = edit.swapEffect;
      // Swap the effect name but keep all other fields
      if (index < effects.length) {
        effects[index] = { ...effects[index], effect: to };
      }
    }

    if (edit.addEffect) {
      effects.push(edit.addEffect);
    }

    if (edit.intensityScale !== undefined && edit.intensityScale !== 1) {
      effects = effects.map((e) => scaleIntensity(e, edit.intensityScale!));
    }

    if (edit.paletteShift) {
      effects = applyPaletteShift(effects, edit.paletteShift.color);
    }

    return {
      ...section,
      effects,
      barPattern: edit.barPattern ?? section.barPattern,
      intent: edit.intentOverride ?? section.rationale,
    };
  });

  // Validate hit cues are inside the song duration
  const songEnd = draft.sections.length
    ? draft.sections[draft.sections.length - 1].end
    : Infinity;
  const hitCues: HitCue[] = patch.hitCues.filter(
    (cue) => cue.t >= 0 && cue.t <= songEnd,
  );

  return {
    song: draft.song,
    bpm: draft.bpm,
    style: patch.style,
    arc: patch.arc,
    directorVersion: draft.directorVersion,
    sections,
    hitCues,
    claudeWarnings: patch.warnings,
  };
}
