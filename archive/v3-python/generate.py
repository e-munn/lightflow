"""Generate a show plan using Claude as creative lighting director.

Sends song analysis (sections, BPM, patterns) to Claude and gets back
a ShowPlan with layered effects per section.
"""

from __future__ import annotations

import json
from pathlib import Path

import anthropic

from schemas import (
    AnalysisResult, ShowPlan, SectionPlan, EffectInstance,
    Color, Region, BlendMode, TransitionType,
)

EFFECT_VOCABULARY = """
Available effects (use these exact names):
- solid: Static fill. Good for base layers and ambient glow.
- gradient: Intensity gradient along a direction (bright→dark). Good for backgrounds.
- bass_fill: Bottom-up fill driven by bass energy. Deep, heavy feel.
- kick_flash: Full-region flash on kick hits. Punchy, energetic. Supports onset_mode.
- snare_accent: Flash on snare hits. Good on outer tubes for accents. Supports onset_mode.
- hat_sparkle: Random sparkle pixels driven by hi-hat. Twinkling, airy. Supports onset_mode.
- vocal_wave: Flowing vertical wave driven by vocal energy. Smooth, emotional.
- energy_pulse: Pulsing brightness synced to beat. Rhythmic, hypnotic.
- chase: Light chasing along tubes or pixels. Dynamic, moving. Speed auto-modulates with stem energy — use lower base speed values (0.3-0.7).
- scan: Scanner beam ping-ponging across tubes. Dramatic, sweeping. Speed auto-modulates with stem energy — use lower base speed values (0.3-0.7).
- rain: Falling pixel drops with tails. Atmospheric, gentle.
- ripple: Radial wave from center outward. Organic, flowing.
- buildup_rise: Rising fill that builds intensity. Tension, anticipation.
- strobe: On/off flash at BPM-synced rate. High energy, climactic.
- blackout: Zeros out the region. Use with replace blend for dramatic pauses.
- fade_in: Fade from black. Good for section transitions.
- fade_out: Fade to black. Good for endings.
- pan_sweep: Light column follows a stem's stereo pan across tubes. Tight beam that tracks L/R movement.
- flux_burst: Expanding radial ring triggered by spectral flux. Good for buildups and transitions.
- breathe: Slow sine modulation with per-tube phase offset. Organic, living feel. Perfect for intros and breakdowns.
- breathe_y: Vertical breathing wave — brightness sweeps up and down tubes. Good for breakdowns.
- meteor: Bright pixel with exponential decay tail falling down tubes. Cinematic — great for intros and ambient sections.
- firefly: 12 independent dots with asymmetric glow cycles. Magical, organic. Perfect for intros and breakdowns.
- strobe_chase: Strobe that advances one tube per beat. More spatial than uniform strobe. High energy for drops.
- impact: Onset-triggered flash → expanding ring decay. Use for drop hits and big moments.
- lighthouse: Wide Gaussian beam ping-ponging across tubes. Vertical brightness gradient. Ambient, mid-energy.
- candles: Slow bottom-weighted glow dots. Warm, intimate. Great for intros and breakdowns.
- firecracker: Intense sparkle burst expanding radially. Explosive, celebratory.
- abracadabra: Randomly wandering focused light with decay trail. Magical, playful.

STEM → EFFECT OPTIONS (vary these across sections!):
- kick: kick_flash, impact, strobe, energy_pulse, bass_fill, firecracker, strobe_chase
- snare: snare_accent, impact, strobe, scan, firecracker, chase
- hat: hat_sparkle, rain, chase, scan, strobe_chase, energy_pulse, meteor
- bass: bass_fill, solid, breathe, breathe_y, gradient, ripple, buildup_rise
- vocals: vocal_wave, lighthouse, breathe, scan, abracadabra, pan_sweep
- none (ambient): firefly, candles, meteor, rain, breathe, lighthouse, ripple

Each effect has these parameters:
- intensity_source: Which stem drives it: "bass", "kick", "snare", "hat", "vocals", "other", or "none" (static).
- region: {preset: "all"|"top"|"bottom"|"outer"|"inner"|"left"|"right"} or {tubes: [0,1,...7]} or {pixel_range: [start, end]}
- speed: Float multiplier for animation speed. Default 1.0.
- direction: "up", "down", "left", "right" — for chase, gradient, meteor.
- blend_mode: "max" (default, prevents washout), "add" (for sparkles), "replace" (for overrides).
- intensity: Float 0-1. Master intensity for this layer.
- attack_ms: How fast the effect responds to energy increases. Lower = snappier.
- release_ms: How fast it fades after energy drops. Higher = smoother.
- pan_follow: Boolean. When true, effect position tracks the stem's stereo pan across tubes.
- onset_mode: Boolean. When true, uses transient peaks for percussive effects. Makes hits sharper.
- attack_beats: Float (optional). Overrides attack_ms with a beat-relative value.
- release_beats: Float (optional). Overrides release_ms with a beat-relative value. Common values: 0.25 (tight), 0.5 (trailing), 1.0 (sustain), 2.0 (wash).
"""

STYLE_DESCRIPTIONS = {
    "energetic": "Bold, high-contrast, lots of movement. Kick flashes, bass fills, chases. Think festival main stage.",
    "elegant": "Smooth, warm, understated. Gentle washes, vocal waves, slow gradients. Think upscale wedding reception.",
    "dramatic": "High contrast, strategic blackouts, building tension. Scans, buildups, hard cuts on drops.",
    "chill": "Ambient, slow-moving, soft colors. Color washes, rain, ripples. Think lounge or cocktail hour.",
    "party": "Fun, colorful, beat-synced. Energy pulses, hat sparkles, chases. Think dance floor.",
}


def build_prompt(analysis: AnalysisResult, style: str = "energetic") -> str:
    """Build the Claude prompt from analysis data."""
    style_desc = STYLE_DESCRIPTIONS.get(style, style)

    # Summarize sections
    sections_summary = []
    for s in analysis.sections:
        sections_summary.append(
            f"  {s.start:.1f}-{s.end:.1f}s: {s.label} "
            f"(energy={s.energy_level:.2f}, bass={s.bass_presence:.2f}, vocals={'yes' if s.has_vocals else 'no'})"
        )

    # Summarize energy profile
    stem_names = ["bass", "kick", "snare", "hat", "vocals", "other"]
    energy_summary = {}
    for name in stem_names:
        vals = [getattr(f.stems, name) for f in analysis.frames]
        energy_summary[name] = {
            "mean": round(sum(vals) / len(vals), 3),
            "max": round(max(vals), 3),
        }

    # Pan movement summary
    pan_summary = {}
    for name in ["bass", "vocals", "other"]:
        pan_vals = [getattr(f.pans, name) for f in analysis.frames]
        mean_pan = sum(pan_vals) / len(pan_vals)
        pan_range = max(pan_vals) - min(pan_vals)
        pan_summary[name] = {
            "mean_pan": round(mean_pan, 3),
            "pan_range": round(pan_range, 3),
        }

    # Onset density (fraction of frames with strong transients > 0.3)
    onset_summary = {}
    for name in ["kick", "snare", "hat"]:
        onset_vals = [getattr(f.onsets, name) for f in analysis.frames]
        density = sum(1 for v in onset_vals if v > 0.3) / len(onset_vals)
        onset_summary[name] = {"onset_density": round(density, 3)}

    # Spectral flux summary
    flux_vals = [f.spectral_flux for f in analysis.frames]
    flux_summary = {
        "mean": round(sum(flux_vals) / len(flux_vals), 3),
        "max": round(max(flux_vals), 3),
    }

    prompt = f"""You are a creative lighting director designing a show for 8 Astera Titan Tubes arranged in a vertical line behind a DJ booth. Each tube has 16 RGB pixels.

SONG: {analysis.song}
BPM: {analysis.bpm}
Duration: {analysis.duration:.1f}s
Patterns: four_on_floor={analysis.patterns.four_on_floor}, backbeat={analysis.patterns.backbeat}, hats={analysis.patterns.hat_rate}

SECTIONS:
{chr(10).join(sections_summary)}

ENERGY PROFILE (0-1 scale, mean/max):
{json.dumps(energy_summary, indent=2)}

STEREO PAN MOVEMENT (mean_pan: center position, pan_range: how much it moves):
{json.dumps(pan_summary, indent=2)}

ONSET DENSITY (fraction of frames with strong transients):
{json.dumps(onset_summary, indent=2)}

SPECTRAL FLUX (detects filter sweeps, new instruments, timbral changes):
{json.dumps(flux_summary, indent=2)}

STYLE: {style} — {style_desc}

{EFFECT_VOCABULARY}

DESIGN RULES:
1. Each section gets 2-5 layered effects. More layers for high-energy sections, fewer for calm ones.
2. Always have a base/ambient layer (solid, gradient, or breathe) as the foundation.
3. Layer reactive effects on top using the STEM → EFFECT OPTIONS mapping above. Don't always pick the obvious match — explore alternatives!
4. Match intensity_source to the right stem — don't put vocals on a kick_flash.
5. Use regions to create spatial interest — don't put everything on "all".
6. Drops should feel dramatically different from verses/breakdowns.
7. Buildups should use buildup_rise or increasing chase speed.
8. Use crossfade transitions by default, hard_cut only for drops after buildups.
9. NEVER use the same effect for the same stem in more than 2 consecutive sections. Cycle through alternatives.
10. Each section should include at least one effect not used in the previous section.
11. For hats specifically: alternate between hat_sparkle, rain, chase, scan, and meteor across sections.
12. Keep attack_ms low (10-30) for percussive stems (kick, snare, hat) and higher (50-200) for sustained stems (bass, vocals).
13. Use pan_follow=true when a stem's pan_range > 0.3 — the effect will track stereo movement across tubes.
14. Use onset_mode=true for percussive effects (kick_flash, snare_accent, hat_sparkle) when onset_density > 0.3 — makes hits snappier.
15. Layer flux_burst during buildups and transitions — it reacts to filter sweeps and timbral changes.
16. Use pan_sweep when a stem has significant stereo movement (pan_range > 0.3).
17. Chase and scan auto-modulate speed with stem energy — use lower base speed values (0.3-0.7) to avoid being too fast during drops.
18. Prefer release_beats over release_ms for musical timing. Common values: 0.25 (tight), 0.5 (trailing), 1.0 (sustain), 2.0 (wash). This scales automatically with BPM.
19. Intros must breathe and evolve — use breathe, firefly, lighthouse, candles. Never just a static solid. Set release_beats 1.0-2.0 for smooth, flowing feel.
20. Drops must feel explosive — layer strobe/strobe_chase, impact, kick_flash (onset_mode=true), bass_fill. Use hard_cut transition. Short release_beats (0.25-0.5).
21. Kick flash should use release_beats 0.5-1.0 for musical trailing decay that breathes with tempo.

NOTE: Do NOT include "color" or "secondary_color" fields. The system renders in monochrome (white intensity only). Color fields are ignored.

Return a JSON object with this exact structure:
{{
  "song": "{analysis.song}",
  "bpm": {analysis.bpm},
  "style": "{style}",
  "sections": [
    {{
      "section_label": "intro",
      "start": 0.0,
      "end": 15.0,
      "transition_in": "crossfade",
      "transition_duration": 0.5,
      "effects": [
        {{
          "effect": "breathe",
          "intensity_source": "none",
          "region": {{"preset": "all"}},
          "blend_mode": "max",
          "intensity": 0.4,
          "release_beats": 2.0
        }},
        {{
          "effect": "firefly",
          "intensity_source": "none",
          "region": {{"preset": "all"}},
          "blend_mode": "add",
          "intensity": 0.3,
          "speed": 0.8,
          "release_beats": 1.5
        }}
      ]
    }}
  ]
}}

Design a complete show plan for ALL {len(analysis.sections)} sections. Be creative with effect combinations, spatial layouts, and variety. Make each section feel distinct — vary which effects represent each stem across sections."""

    return prompt


def _stream_message(client: anthropic.Anthropic, model: str, messages: list,
                    max_tokens: int) -> tuple[str, str]:
    """Stream a message and return (text, stop_reason). Prints a dot per 100 chunks."""
    import sys
    text = ""
    stop_reason = "end_turn"
    chunks = 0
    with client.messages.stream(model=model, max_tokens=max_tokens,
                                messages=messages) as stream:
        for event in stream.text_stream:
            text += event
            chunks += 1
            if chunks % 100 == 0:
                sys.stdout.write(".")
                sys.stdout.flush()
    if chunks >= 100:
        print()  # newline after dots
    stop_reason = stream.get_final_message().stop_reason
    tokens = stream.get_final_message().usage.output_tokens
    print(f"  Response: {len(text)} chars, {tokens} tokens, stop={stop_reason}")
    return text, stop_reason


def generate_show(
    analysis: AnalysisResult,
    style: str = "energetic",
    model: str = "claude-sonnet-4-6",
) -> ShowPlan:
    """Call Claude to generate a show plan."""
    client = anthropic.Anthropic()

    prompt = build_prompt(analysis, style)
    print(f"  Generating show plan (style: {style})...")
    print(f"  Model: {model}")

    text, stop = _stream_message(client, model,
                                 [{"role": "user", "content": prompt}],
                                 max_tokens=32768)

    raw = _extract_json(text)
    if raw is not None:
        return _parse_show_plan(raw, analysis)

    # Truncated by max_tokens — try to salvage partial JSON
    if stop == "max_tokens":
        print(f"  Response truncated, attempting to salvage partial JSON...")
        raw = _salvage_truncated_json(text)
        if raw is not None:
            return _parse_show_plan(raw, analysis)

    print(f"  Retrying with explicit JSON instruction...")
    return _retry_generate(client, model, prompt, analysis)


def _extract_json(text: str) -> dict | None:
    """Try to extract JSON from a response that may have markdown wrapping."""
    json_str = text
    if "```json" in text:
        json_str = text.split("```json")[1].split("```")[0]
    elif "```" in text:
        json_str = text.split("```")[1].split("```")[0]
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  JSON parse error: {e}")
        return None


def _salvage_truncated_json(text: str) -> dict | None:
    """Try to recover a usable show plan from truncated JSON.

    Strategy: find the last complete section (ends with }) in the sections array,
    close the array and object.
    """
    json_str = text
    if "```json" in text:
        json_str = text.split("```json")[1]
    elif "```" in text:
        json_str = text.split("```")[1]

    # Find last complete section object: look for the pattern of a closing }
    # followed by a comma or whitespace before the next section/end
    # We look for '}' that closes a section in the "sections" array
    sections_start = json_str.find('"sections"')
    if sections_start == -1:
        return None

    # Try progressively trimming from the end to find valid JSON
    # Look for the last '}' that could close a section object
    search_from = len(json_str) - 1
    while search_from > sections_start:
        pos = json_str.rfind('}', sections_start, search_from)
        if pos == -1:
            break
        # Try closing: ] then }
        candidate = json_str[:pos + 1] + ']}'
        try:
            raw = json.loads(candidate)
            if "sections" in raw and len(raw["sections"]) > 0:
                print(f"  Salvaged {len(raw['sections'])} complete sections from truncated response")
                return raw
        except json.JSONDecodeError:
            pass
        search_from = pos
    return None


def _retry_generate(
    client: anthropic.Anthropic,
    model: str,
    prompt: str,
    analysis: AnalysisResult,
) -> ShowPlan:
    """Retry generation with stricter instructions and higher token limit."""
    text, stop = _stream_message(
        client, model,
        [{"role": "user", "content": prompt
          + "\n\nIMPORTANT: Reply with ONLY the raw JSON object. "
          "No markdown, no explanation, no ```json fences. "
          "Start your response with { and end with }. "
          "Be concise — use short color values and minimal whitespace."}],
        max_tokens=49152,
    )

    raw = _extract_json(text)
    if raw is not None:
        return _parse_show_plan(raw, analysis)

    if stop == "max_tokens":
        raw = _salvage_truncated_json(text)
        if raw is not None:
            return _parse_show_plan(raw, analysis)

    raise RuntimeError("Failed to parse show plan JSON after retry")


def _parse_show_plan(raw: dict, analysis: AnalysisResult) -> ShowPlan:
    """Parse and validate the raw JSON into a ShowPlan."""
    sections = []
    for s in raw.get("sections", []):
        effects = []
        for e in s.get("effects", []):
            color_data = e.get("color", {"r": 1, "g": 1, "b": 1})
            color = Color(r=color_data.get("r", 1), g=color_data.get("g", 1), b=color_data.get("b", 1))

            secondary = None
            if "secondary_color" in e and e["secondary_color"]:
                sc = e["secondary_color"]
                secondary = Color(r=sc.get("r", 0), g=sc.get("g", 0), b=sc.get("b", 0))

            region_data = e.get("region", {"preset": "all"})
            region = Region(
                preset=region_data.get("preset"),
                tubes=region_data.get("tubes"),
                pixel_range=tuple(region_data["pixel_range"]) if "pixel_range" in region_data and region_data["pixel_range"] else None,
            )

            blend_str = e.get("blend_mode", "max")
            try:
                blend = BlendMode(blend_str)
            except ValueError:
                blend = BlendMode.MAX

            effects.append(EffectInstance(
                effect=e.get("effect", "solid"),
                color=color,
                secondary_color=secondary,
                intensity_source=e.get("intensity_source", "none"),
                region=region,
                speed=e.get("speed", 1.0),
                direction=e.get("direction", "up"),
                blend_mode=blend,
                intensity=e.get("intensity", 1.0),
                attack_ms=e.get("attack_ms", 50.0),
                release_ms=e.get("release_ms", 200.0),
                attack_beats=e.get("attack_beats"),
                release_beats=e.get("release_beats"),
                pan_follow=e.get("pan_follow", False),
                onset_mode=e.get("onset_mode", False),
            ))

        trans_str = s.get("transition_in", "crossfade")
        try:
            transition = TransitionType(trans_str)
        except ValueError:
            transition = TransitionType.CROSSFADE

        sections.append(SectionPlan(
            section_label=s.get("section_label", "unknown"),
            start=s.get("start", 0.0),
            end=s.get("end", 0.0),
            effects=effects,
            transition_in=transition,
            transition_duration=s.get("transition_duration", 0.5),
        ))

    show = ShowPlan(
        song=raw.get("song", analysis.song),
        bpm=raw.get("bpm", analysis.bpm),
        style=raw.get("style", "energetic"),
        sections=sections,
    )

    print(f"  Show plan: {len(show.sections)} sections, "
          f"{sum(len(s.effects) for s in show.sections)} total effects")
    return show
