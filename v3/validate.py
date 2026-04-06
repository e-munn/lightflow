"""Validate and score a ShowPlan against design rules and simulated render stats.

Layer 1: Structural rule checks (instant, deterministic)
Layer 2: Headless render simulation (brightness, variance, coverage, motion, energy correlation)
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from effects import EffectContext, LiveInput, render_section_frame, apply_glow, reset_smoothing, EFFECT_REGISTRY
from schemas import (
    NUM_TUBES, PIXELS_PER_TUBE,
    AnalysisResult, ShowPlan, SectionPlan, EffectInstance, StemFrame,
)


# ---------------------------------------------------------------------------
# Constants for rule checking
# ---------------------------------------------------------------------------

BASE_EFFECTS = {"solid", "gradient", "breathe"}

CALM_EFFECTS = {"breathe", "firefly", "lighthouse", "candles", "meteor",
                "rain", "color_wash", "breathe_y"}

DROP_EFFECTS = {"strobe", "strobe_chase", "impact", "kick_flash",
                "bass_fill", "firecracker"}

ONSET_EFFECTS = {"kick_flash", "snare_accent", "hat_sparkle", "impact"}

PERCUSSIVE_STEMS = {"kick", "snare", "hat"}

ALL_EFFECTS = set(EFFECT_REGISTRY.keys())

STEM_EFFECT_MAP = {
    "kick": {"kick_flash", "impact", "strobe", "energy_pulse", "bass_fill", "firecracker", "strobe_chase"},
    "snare": {"snare_accent", "impact", "strobe", "scan", "firecracker", "chase"},
    "hat": {"hat_sparkle", "rain", "chase", "scan", "strobe_chase", "energy_pulse", "meteor"},
    "bass": {"bass_fill", "solid", "breathe", "breathe_y", "gradient", "ripple", "buildup_rise"},
    "vocals": {"vocal_wave", "lighthouse", "breathe", "scan", "abracadabra", "pan_sweep"},
}


# ---------------------------------------------------------------------------
# Rule violation
# ---------------------------------------------------------------------------

@dataclass
class Violation:
    rule: int          # which design rule (1-21)
    section_idx: int   # -1 for global
    severity: str      # "error" or "warning"
    message: str


# ---------------------------------------------------------------------------
# Layer 1: Structural rule checks
# ---------------------------------------------------------------------------

def check_rules(show: ShowPlan, analysis: AnalysisResult) -> list[Violation]:
    """Check the ShowPlan against the 21 design rules. Returns violations."""
    violations: list[Violation] = []
    sections = show.sections

    # Build onset density from analysis
    onset_density = {}
    n_frames = len(analysis.frames)
    if n_frames > 0:
        for name in ["kick", "snare", "hat"]:
            vals = [getattr(f.onsets, name) for f in analysis.frames]
            onset_density[name] = sum(1 for v in vals if v > 0.3) / n_frames

    # Build pan range from analysis
    pan_range = {}
    for name in ["bass", "vocals", "other"]:
        pan_vals = [getattr(f.pans, name) for f in analysis.frames]
        pan_range[name] = max(pan_vals) - min(pan_vals) if pan_vals else 0.0

    # Map section labels to analysis sections for energy lookup
    analysis_sections = {(s.start, s.end): s for s in analysis.sections}

    for i, sp in enumerate(sections):
        effects = sp.effects
        effect_names = [e.effect for e in effects]

        # Rule 1: 2-5 effects per section
        if len(effects) < 2:
            violations.append(Violation(1, i, "error",
                f"Section {i} '{sp.section_label}' has {len(effects)} effects (min 2)"))
        elif len(effects) > 5:
            violations.append(Violation(1, i, "warning",
                f"Section {i} '{sp.section_label}' has {len(effects)} effects (max 5)"))

        # Rule 2: Must have a base/ambient layer
        has_base = any(e.effect in BASE_EFFECTS for e in effects)
        if not has_base:
            violations.append(Violation(2, i, "error",
                f"Section {i} '{sp.section_label}' has no base layer ({BASE_EFFECTS})"))

        # Rule 4: intensity_source should match stem-effect mapping
        for e in effects:
            src = e.intensity_source
            if src != "none" and src in STEM_EFFECT_MAP:
                if e.effect not in STEM_EFFECT_MAP[src] and e.effect not in BASE_EFFECTS:
                    violations.append(Violation(4, i, "warning",
                        f"Section {i}: '{e.effect}' is unusual for stem '{src}'"))

        # Rule 5: Not everything on "all"
        all_regions = [e.region.preset for e in effects if e.region.preset]
        if len(all_regions) >= 3 and all(r == "all" for r in all_regions):
            violations.append(Violation(5, i, "warning",
                f"Section {i} '{sp.section_label}': all {len(all_regions)} effects use region 'all'"))

        # Normalize label for matching (drop_1 → drop, buildup_2 → buildup)
        label = sp.section_label.rstrip("_0123456789").lower()

        # Rule 6: Drops should feel different from verses
        if label == "drop":
            has_drop_effect = any(e.effect in DROP_EFFECTS for e in effects)
            if not has_drop_effect:
                violations.append(Violation(6, i, "error",
                    f"Section {i} '{sp.section_label}' has no high-energy effects ({DROP_EFFECTS})"))

        # Rule 7: Buildups should use buildup_rise or increasing chase
        if label == "buildup":
            has_buildup = any(e.effect in {"buildup_rise", "chase"} for e in effects)
            if not has_buildup:
                violations.append(Violation(7, i, "warning",
                    f"Section {i} '{sp.section_label}' has no buildup_rise or chase"))

        # Rule 8: hard_cut only for drops after buildups
        if sp.transition_in.value == "hard_cut" and label != "drop":
            violations.append(Violation(8, i, "warning",
                f"Section {i} '{sp.section_label}' uses hard_cut but isn't a drop"))

        # Rule 12: attack_ms should be low for percussive stems
        for e in effects:
            if e.intensity_source in PERCUSSIVE_STEMS:
                attack = e.resolve_attack_ms(show.bpm)
                if attack > 40:
                    violations.append(Violation(12, i, "warning",
                        f"Section {i}: '{e.effect}' on '{e.intensity_source}' has high attack ({attack:.0f}ms)"))

        # Rule 14: onset_mode for percussive effects when density > 0.3
        for e in effects:
            if e.effect in ONSET_EFFECTS and e.intensity_source in onset_density:
                if onset_density[e.intensity_source] > 0.3 and not e.onset_mode:
                    violations.append(Violation(14, i, "warning",
                        f"Section {i}: '{e.effect}' on '{e.intensity_source}' should use onset_mode (density={onset_density[e.intensity_source]:.2f})"))

        # Rule 13: pan_follow when pan_range > 0.3
        for e in effects:
            src = e.intensity_source
            if src in pan_range and pan_range[src] > 0.3 and not e.pan_follow:
                if e.effect in {"pan_sweep", "chase", "scan", "vocal_wave", "lighthouse"}:
                    violations.append(Violation(13, i, "warning",
                        f"Section {i}: '{e.effect}' on '{src}' could use pan_follow (range={pan_range[src]:.2f})"))

        # Rule 18: prefer release_beats over release_ms
        for e in effects:
            if e.release_beats is None and e.intensity_source != "none":
                violations.append(Violation(18, i, "warning",
                    f"Section {i}: '{e.effect}' uses release_ms instead of release_beats"))

        # Rule 19: intros should breathe
        if label == "intro":
            has_calm = any(e.effect in CALM_EFFECTS for e in effects)
            if not has_calm:
                violations.append(Violation(19, i, "error",
                    f"Section {i} '{sp.section_label}' has no ambient/breathing effects"))

        # Rule 20: drops must be explosive
        if label == "drop":
            if sp.transition_in.value != "hard_cut":
                violations.append(Violation(20, i, "warning",
                    f"Section {i} '{sp.section_label}' should use hard_cut transition"))

    # Rule 9: No same effect+stem in >2 consecutive sections
    for i in range(2, len(sections)):
        prev2 = {(e.effect, e.intensity_source) for e in sections[i-2].effects}
        prev1 = {(e.effect, e.intensity_source) for e in sections[i-1].effects}
        curr = {(e.effect, e.intensity_source) for e in sections[i].effects}
        repeated = prev2 & prev1 & curr
        for effect, source in repeated:
            if effect not in BASE_EFFECTS:
                violations.append(Violation(9, i, "warning",
                    f"'{effect}' on '{source}' repeated in sections {i-2},{i-1},{i}"))

    # Rule 10: Each section should have at least one new effect
    for i in range(1, len(sections)):
        prev_effects = {e.effect for e in sections[i-1].effects}
        curr_effects = {e.effect for e in sections[i].effects}
        new_effects = curr_effects - prev_effects
        if not new_effects:
            violations.append(Violation(10, i, "warning",
                f"Section {i} '{sections[i].section_label}' introduces no new effects vs previous"))

    # Check for unknown effects
    for i, sp in enumerate(sections):
        for e in sp.effects:
            if e.effect not in ALL_EFFECTS:
                violations.append(Violation(0, i, "error",
                    f"Section {i}: unknown effect '{e.effect}'"))

    return violations


# ---------------------------------------------------------------------------
# Layer 2: Simulated render stats
# ---------------------------------------------------------------------------

@dataclass
class SectionStats:
    section_idx: int
    label: str
    start: float
    end: float
    avg_brightness: float = 0.0
    brightness_variance: float = 0.0
    spatial_coverage: float = 0.0       # fraction of tubes with avg brightness > 0.05
    motion_score: float = 0.0           # mean frame-to-frame pixel change
    energy_correlation: float = 0.0     # correlation between audio energy and visual brightness


@dataclass
class RenderReport:
    section_stats: list[SectionStats]
    global_avg_brightness: float = 0.0
    global_brightness_variance: float = 0.0
    global_spatial_coverage: float = 0.0
    global_motion_score: float = 0.0
    global_energy_correlation: float = 0.0


def simulate_render(show: ShowPlan, analysis: AnalysisResult,
                    sample_fps: int = 10) -> RenderReport:
    """Run the effect engine headlessly and compute render statistics.

    Uses a lower FPS than real-time (default 10) for speed.
    """
    reset_smoothing()
    live = LiveInput()

    frame_times = np.array([f.time for f in analysis.frames])
    section_stats: list[SectionStats] = []

    all_brightnesses = []
    all_energy_vals = []

    for si, sp in enumerate(show.sections):
        duration = sp.end - sp.start
        n_samples = max(2, int(duration * sample_fps))
        times = np.linspace(sp.start + 0.01, sp.end - 0.01, n_samples)

        brightnesses = []
        per_tube_brightness = np.zeros(NUM_TUBES)
        prev_grid = None
        frame_diffs = []
        section_energies = []

        for t in times:
            # Find nearest analysis frame
            idx = min(np.searchsorted(frame_times, t), len(analysis.frames) - 1)
            frame = analysis.frames[idx]

            dt = 1.0 / sample_fps
            ctx = EffectContext(frame=frame, time=t, bpm=show.bpm, dt=dt, live=live)

            grid = render_section_frame(sp.effects, ctx)
            grid = apply_glow(grid, amount=0.3)
            grid = np.clip(grid, 0, 1)

            # Brightness: mean across all pixels
            frame_brightness = float(grid.mean())
            brightnesses.append(frame_brightness)

            # Per-tube brightness (mean across pixels in each tube)
            for col in range(NUM_TUBES):
                per_tube_brightness[col] += grid[:, col, :].mean()

            # Motion: frame-to-frame change
            if prev_grid is not None:
                diff = float(np.abs(grid - prev_grid).mean())
                frame_diffs.append(diff)
            prev_grid = grid.copy()

            # Audio energy at this frame
            stem_vals = [frame.stems.bass, frame.stems.kick, frame.stems.snare,
                         frame.stems.hat, frame.stems.vocals, frame.stems.other]
            section_energies.append(sum(stem_vals) / len(stem_vals))

        per_tube_brightness /= n_samples
        active_tubes = int((per_tube_brightness > 0.05).sum())

        avg_b = float(np.mean(brightnesses))
        var_b = float(np.var(brightnesses))
        motion = float(np.mean(frame_diffs)) if frame_diffs else 0.0
        coverage = active_tubes / NUM_TUBES

        # Energy correlation
        if len(brightnesses) == len(section_energies) and len(brightnesses) > 2:
            corr_matrix = np.corrcoef(brightnesses, section_energies)
            energy_corr = float(corr_matrix[0, 1]) if not np.isnan(corr_matrix[0, 1]) else 0.0
        else:
            energy_corr = 0.0

        stats = SectionStats(
            section_idx=si,
            label=sp.section_label,
            start=sp.start,
            end=sp.end,
            avg_brightness=avg_b,
            brightness_variance=var_b,
            spatial_coverage=coverage,
            motion_score=motion,
            energy_correlation=energy_corr,
        )
        section_stats.append(stats)

        all_brightnesses.extend(brightnesses)
        all_energy_vals.extend(section_energies)

    # Global stats
    global_corr = 0.0
    if len(all_brightnesses) > 2:
        cm = np.corrcoef(all_brightnesses, all_energy_vals)
        global_corr = float(cm[0, 1]) if not np.isnan(cm[0, 1]) else 0.0

    return RenderReport(
        section_stats=section_stats,
        global_avg_brightness=float(np.mean(all_brightnesses)) if all_brightnesses else 0.0,
        global_brightness_variance=float(np.var(all_brightnesses)) if all_brightnesses else 0.0,
        global_spatial_coverage=float(np.mean([s.spatial_coverage for s in section_stats])) if section_stats else 0.0,
        global_motion_score=float(np.mean([s.motion_score for s in section_stats])) if section_stats else 0.0,
        global_energy_correlation=global_corr,
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

@dataclass
class ScoreCard:
    rule_score: float           # 0-100, penalties for violations
    render_score: float         # 0-100, from render stats
    overall_score: float        # weighted combination
    violations: list[Violation]
    render_report: RenderReport
    grade: str                  # A/B/C/D/F


def compute_score(violations: list[Violation], render: RenderReport) -> ScoreCard:
    """Combine rule violations + render stats into a single score."""

    # --- Rule score (start at 100, subtract per violation) ---
    rule_score = 100.0
    for v in violations:
        if v.severity == "error":
            rule_score -= 8.0
        else:  # warning
            rule_score -= 3.0
    rule_score = max(0.0, rule_score)

    # --- Render score (5 metrics, each 0-20 points) ---
    render_score = 0.0

    # 1. Brightness: ideal range 0.15-0.45
    b = render.global_avg_brightness
    if 0.15 <= b <= 0.45:
        render_score += 20.0
    elif 0.08 <= b < 0.15 or 0.45 < b <= 0.60:
        render_score += 12.0
    elif b < 0.08:
        render_score += 4.0   # too dark
    else:
        render_score += 6.0   # too bright

    # 2. Brightness variance: want > 0.005 (dynamic, not static)
    v = render.global_brightness_variance
    if v > 0.01:
        render_score += 20.0
    elif v > 0.005:
        render_score += 14.0
    elif v > 0.001:
        render_score += 8.0
    else:
        render_score += 2.0  # basically static

    # 3. Spatial coverage: want > 0.8
    c = render.global_spatial_coverage
    render_score += min(20.0, c * 25.0)

    # 4. Motion: want > 0.01
    m = render.global_motion_score
    if m > 0.02:
        render_score += 20.0
    elif m > 0.01:
        render_score += 14.0
    elif m > 0.005:
        render_score += 8.0
    else:
        render_score += 2.0

    # 5. Energy correlation: want positive (visual tracks audio)
    ec = render.global_energy_correlation
    if ec > 0.5:
        render_score += 20.0
    elif ec > 0.3:
        render_score += 15.0
    elif ec > 0.1:
        render_score += 10.0
    elif ec > 0.0:
        render_score += 5.0
    else:
        render_score += 0.0  # negative correlation = anti-musical

    # --- Overall: 40% rules, 60% render ---
    overall = rule_score * 0.4 + render_score * 0.6

    # Grade
    if overall >= 85:
        grade = "A"
    elif overall >= 70:
        grade = "B"
    elif overall >= 55:
        grade = "C"
    elif overall >= 40:
        grade = "D"
    else:
        grade = "F"

    return ScoreCard(
        rule_score=round(rule_score, 1),
        render_score=round(render_score, 1),
        overall_score=round(overall, 1),
        violations=violations,
        render_report=render,
        grade=grade,
    )


# ---------------------------------------------------------------------------
# Report formatting
# ---------------------------------------------------------------------------

def format_report(score: ScoreCard) -> str:
    """Format a human-readable validation report."""
    lines = []
    lines.append("=" * 60)
    lines.append(f"  SHOW VALIDATION REPORT — Grade: {score.grade} ({score.overall_score}/100)")
    lines.append("=" * 60)
    lines.append("")

    # Scores
    lines.append(f"  Rule compliance:  {score.rule_score:5.1f}/100")
    lines.append(f"  Render quality:   {score.render_score:5.1f}/100")
    lines.append(f"  Overall:          {score.overall_score:5.1f}/100")
    lines.append("")

    # Violations
    errors = [v for v in score.violations if v.severity == "error"]
    warnings = [v for v in score.violations if v.severity == "warning"]

    if errors:
        lines.append(f"  ERRORS ({len(errors)}):")
        for v in errors:
            lines.append(f"    [Rule {v.rule}] {v.message}")
        lines.append("")

    if warnings:
        lines.append(f"  WARNINGS ({len(warnings)}):")
        for v in warnings:
            lines.append(f"    [Rule {v.rule}] {v.message}")
        lines.append("")

    if not errors and not warnings:
        lines.append("  No rule violations!")
        lines.append("")

    # Render stats
    r = score.render_report
    lines.append("  RENDER STATS:")
    lines.append(f"    Avg brightness:       {r.global_avg_brightness:.3f}  (ideal: 0.15-0.45)")
    lines.append(f"    Brightness variance:  {r.global_brightness_variance:.4f}  (want > 0.005)")
    lines.append(f"    Spatial coverage:     {r.global_spatial_coverage:.2f}  (want > 0.80)")
    lines.append(f"    Motion score:         {r.global_motion_score:.4f}  (want > 0.01)")
    lines.append(f"    Energy correlation:   {r.global_energy_correlation:.3f}  (want > 0.3)")
    lines.append("")

    # Per-section
    lines.append("  PER-SECTION:")
    lines.append(f"    {'#':>2} {'Label':<12} {'Bright':>7} {'Var':>7} {'Cover':>6} {'Motion':>7} {'Corr':>6}")
    lines.append("    " + "-" * 52)
    for s in r.section_stats:
        lines.append(
            f"    {s.section_idx:2d} {s.label:<12} "
            f"{s.avg_brightness:7.3f} {s.brightness_variance:7.4f} "
            f"{s.spatial_coverage:6.2f} {s.motion_score:7.4f} {s.energy_correlation:6.3f}"
        )
    lines.append("")
    lines.append("=" * 60)

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_show(show: ShowPlan, analysis: AnalysisResult,
                  sample_fps: int = 10) -> ScoreCard:
    """Full validation: structural rules + simulated render. Returns ScoreCard."""
    violations = check_rules(show, analysis)
    render = simulate_render(show, analysis, sample_fps=sample_fps)
    return compute_score(violations, render)


def validate_and_report(show: ShowPlan, analysis: AnalysisResult,
                        sample_fps: int = 10) -> str:
    """Validate and return a formatted report string."""
    score = validate_show(show, analysis, sample_fps=sample_fps)
    return format_report(score)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    """CLI: python validate.py <show_plan.json> <analysis.json>"""
    if len(sys.argv) < 3:
        print("Usage: python validate.py <show_plan.json> <analysis.json>")
        print("       python validate.py --rules-only <show_plan.json> <analysis.json>")
        sys.exit(1)

    rules_only = False
    args = sys.argv[1:]
    if args[0] == "--rules-only":
        rules_only = True
        args = args[1:]

    show_path, analysis_path = args[0], args[1]

    with open(show_path) as f:
        show = ShowPlan(**json.load(f))
    with open(analysis_path) as f:
        analysis = AnalysisResult(**json.load(f))

    if rules_only:
        violations = check_rules(show, analysis)
        if not violations:
            print("No rule violations.")
        else:
            for v in violations:
                print(f"[{v.severity.upper():7s}] Rule {v.rule:2d} | Section {v.section_idx:2d} | {v.message}")
        sys.exit(1 if any(v.severity == "error" for v in violations) else 0)

    report = validate_and_report(show, analysis)
    print(report)

    # Exit code: 0 if grade A/B, 1 otherwise
    score = validate_show(show, analysis)
    sys.exit(0 if score.grade in ("A", "B") else 1)


if __name__ == "__main__":
    main()
