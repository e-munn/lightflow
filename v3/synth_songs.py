"""Generate synthetic AnalysisResult objects for validator stress-testing.

Creates fake songs with varied BPMs, section structures, energy profiles,
and rhythmic patterns — no audio processing needed.
"""

from __future__ import annotations

import json
import math
import random
from pathlib import Path

from schemas import (
    AnalysisResult, Section, StemFrame, StemEnergies, StemOnsets,
    StemPans, StemBrightness, RhythmicPattern,
)


# ---------------------------------------------------------------------------
# Section templates
# ---------------------------------------------------------------------------

SONG_TEMPLATES = {
    "edm_banger": {
        "bpm_range": (126, 132),
        "sections": [
            ("intro", 0.2, 0.1, False),
            ("buildup", 0.5, 0.3, False),
            ("drop", 0.9, 0.9, False),
            ("breakdown", 0.3, 0.2, True),
            ("buildup", 0.6, 0.4, True),
            ("drop", 1.0, 1.0, False),
            ("outro", 0.2, 0.1, False),
        ],
        "patterns": {"four_on_floor": True, "backbeat": False, "hat_rate": "16ths"},
    },
    "hip_hop": {
        "bpm_range": (85, 100),
        "sections": [
            ("intro", 0.3, 0.3, False),
            ("verse", 0.5, 0.4, True),
            ("verse", 0.6, 0.5, True),
            ("drop", 0.8, 0.7, True),
            ("verse", 0.5, 0.4, True),
            ("drop", 0.9, 0.8, True),
            ("outro", 0.2, 0.2, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": True, "hat_rate": "8ths"},
    },
    "ambient_chill": {
        "bpm_range": (70, 90),
        "sections": [
            ("intro", 0.1, 0.05, False),
            ("verse", 0.25, 0.15, True),
            ("breakdown", 0.15, 0.1, True),
            ("verse", 0.3, 0.2, True),
            ("outro", 0.1, 0.05, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": False, "hat_rate": "sparse"},
    },
    "dnb": {
        "bpm_range": (170, 178),
        "sections": [
            ("intro", 0.3, 0.2, False),
            ("buildup", 0.6, 0.5, False),
            ("drop", 1.0, 0.9, False),
            ("breakdown", 0.2, 0.1, True),
            ("drop", 1.0, 1.0, False),
            ("outro", 0.3, 0.2, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": True, "hat_rate": "16ths"},
    },
    "house_vocal": {
        "bpm_range": (120, 128),
        "sections": [
            ("intro", 0.3, 0.2, False),
            ("verse", 0.5, 0.4, True),
            ("buildup", 0.6, 0.5, True),
            ("drop", 0.85, 0.8, False),
            ("breakdown", 0.3, 0.15, True),
            ("buildup", 0.7, 0.6, True),
            ("drop", 0.9, 0.85, False),
            ("outro", 0.2, 0.1, False),
        ],
        "patterns": {"four_on_floor": True, "backbeat": False, "hat_rate": "8ths"},
    },
    "techno_minimal": {
        "bpm_range": (130, 140),
        "sections": [
            ("intro", 0.2, 0.15, False),
            ("verse", 0.5, 0.5, False),
            ("buildup", 0.65, 0.6, False),
            ("drop", 0.85, 0.85, False),
            ("breakdown", 0.3, 0.2, False),
            ("drop", 0.9, 0.9, False),
            ("outro", 0.25, 0.2, False),
        ],
        "patterns": {"four_on_floor": True, "backbeat": False, "hat_rate": "16ths"},
    },
    "pop_dance": {
        "bpm_range": (115, 125),
        "sections": [
            ("intro", 0.3, 0.2, True),
            ("verse", 0.5, 0.35, True),
            ("buildup", 0.6, 0.4, True),
            ("drop", 0.8, 0.7, True),
            ("verse", 0.5, 0.35, True),
            ("drop", 0.85, 0.75, True),
            ("outro", 0.3, 0.15, True),
        ],
        "patterns": {"four_on_floor": True, "backbeat": True, "hat_rate": "8ths"},
    },
    "trap": {
        "bpm_range": (135, 155),
        "sections": [
            ("intro", 0.2, 0.1, False),
            ("verse", 0.6, 0.5, True),
            ("drop", 0.95, 0.9, False),
            ("verse", 0.5, 0.4, True),
            ("buildup", 0.7, 0.6, False),
            ("drop", 1.0, 1.0, False),
            ("outro", 0.15, 0.1, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": True, "hat_rate": "16ths"},
    },
    "reggaeton": {
        "bpm_range": (90, 100),
        "sections": [
            ("intro", 0.3, 0.25, False),
            ("verse", 0.55, 0.45, True),
            ("drop", 0.75, 0.65, True),
            ("verse", 0.5, 0.4, True),
            ("drop", 0.8, 0.7, True),
            ("outro", 0.25, 0.2, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": True, "hat_rate": "quarters"},
    },
    "breaks_heavy": {
        "bpm_range": (130, 142),
        "sections": [
            ("intro", 0.25, 0.15, False),
            ("buildup", 0.55, 0.4, False),
            ("drop", 0.95, 0.85, False),
            ("breakdown", 0.2, 0.1, False),
            ("buildup", 0.65, 0.5, False),
            ("drop", 1.0, 0.95, False),
            ("breakdown", 0.15, 0.08, False),
            ("drop", 0.9, 0.9, False),
            ("outro", 0.2, 0.1, False),
        ],
        "patterns": {"four_on_floor": False, "backbeat": True, "hat_rate": "8ths"},
    },
}


def _section_duration(label: str, bpm: float) -> float:
    """Return a plausible duration for a section type."""
    beats_per_sec = bpm / 60.0
    bars = {
        "intro": random.choice([8, 16]),
        "verse": random.choice([16, 32]),
        "buildup": random.choice([8, 16]),
        "drop": random.choice([16, 32]),
        "breakdown": random.choice([8, 16]),
        "outro": random.choice([8, 16]),
    }
    n_bars = bars.get(label, 16)
    return (n_bars * 4) / beats_per_sec


def _generate_frames(sections: list[Section], bpm: float, fps: int = 30) -> list[StemFrame]:
    """Generate per-frame stem data for the entire song."""
    frames = []
    total_duration = sections[-1].end

    n_frames = int(total_duration * fps)
    beat_dur = 60.0 / bpm

    for i in range(n_frames):
        t = i / fps

        # Find current section
        current = sections[0]
        for s in sections:
            if s.start <= t < s.end:
                current = s
                break

        energy = current.energy_level
        bass_p = current.bass_presence
        has_vox = current.has_vocals

        # Beat phase for rhythmic modulation
        beat_phase = (t / beat_dur) % 1.0
        bar_phase = (t / beat_dur / 4.0) % 1.0

        # Kick: peaks on beat (phase near 0)
        kick_envelope = max(0, 1.0 - beat_phase * 4) * energy
        kick_val = kick_envelope * bass_p * random.uniform(0.8, 1.0)

        # Snare: peaks on beats 2 and 4 (bar_phase ~0.25 and ~0.75)
        snare_phase = min(abs(bar_phase - 0.25), abs(bar_phase - 0.75))
        snare_envelope = max(0, 1.0 - snare_phase * 8) * energy
        snare_val = snare_envelope * random.uniform(0.7, 1.0)

        # Hat: higher frequency, jittery
        hat_val = energy * 0.5 * random.uniform(0.2, 1.0)

        # Bass: smooth, follows energy
        bass_val = bass_p * (0.5 + 0.5 * math.sin(t * 0.5)) * random.uniform(0.85, 1.0)

        # Vocals: present in some sections
        vocal_val = (0.4 + 0.3 * math.sin(t * 0.3)) * random.uniform(0.8, 1.0) if has_vox else random.uniform(0, 0.05)

        # Other: ambient texture
        other_val = energy * 0.3 * random.uniform(0.5, 1.0)

        # Onsets: sharp transient peaks
        kick_onset = max(0, 1.0 - beat_phase * 6) * energy if beat_phase < 0.15 else 0.0
        snare_onset = max(0, 1.0 - snare_phase * 12) * energy if snare_phase < 0.08 else 0.0
        hat_onset = random.uniform(0, 0.6) * energy if random.random() < 0.3 else 0.0

        # Pans: gentle stereo movement
        bass_pan = math.sin(t * 0.1) * 0.2
        vocal_pan = math.sin(t * 0.3 + 1.0) * 0.4 if has_vox else 0.0
        other_pan = math.sin(t * 0.7) * 0.5

        # Spectral features
        centroid = 2000 + energy * 3000 + random.uniform(-500, 500)
        flux = energy * 0.3 * random.uniform(0.5, 1.5)
        # Buildups get high flux
        if current.label == "buildup":
            progress = (t - current.start) / max(0.1, current.end - current.start)
            flux += progress * 0.4

        frames.append(StemFrame(
            time=round(t, 4),
            stems=StemEnergies(
                bass=max(0, min(1, bass_val)),
                kick=max(0, min(1, kick_val)),
                snare=max(0, min(1, snare_val)),
                hat=max(0, min(1, hat_val)),
                vocals=max(0, min(1, vocal_val)),
                other=max(0, min(1, other_val)),
            ),
            onsets=StemOnsets(
                kick=max(0, min(1, kick_onset)),
                snare=max(0, min(1, snare_onset)),
                hat=max(0, min(1, hat_onset)),
            ),
            pans=StemPans(
                bass=max(-1, min(1, bass_pan)),
                vocals=max(-1, min(1, vocal_pan)),
                other=max(-1, min(1, other_pan)),
            ),
            brightness=StemBrightness(
                vocals=max(0, min(1, 0.5 + energy * 0.3)),
                other=max(0, min(1, 0.3 + energy * 0.2)),
            ),
            centroid=centroid,
            spectral_flux=max(0, min(1, flux)),
        ))

    return frames


def generate_synthetic(name: str, template_name: str, seed: int | None = None) -> AnalysisResult:
    """Generate a synthetic AnalysisResult from a template."""
    if seed is not None:
        random.seed(seed)

    template = SONG_TEMPLATES[template_name]
    bpm = random.uniform(*template["bpm_range"])
    bpm = round(bpm, 1)

    # Build sections with durations
    sections = []
    t = 0.0
    for label, energy, bass, has_vocals in template["sections"]:
        dur = _section_duration(label, bpm)
        # Add some energy jitter
        energy = max(0, min(1, energy + random.uniform(-0.05, 0.05)))
        bass = max(0, min(1, bass + random.uniform(-0.05, 0.05)))
        sections.append(Section(
            start=round(t, 2),
            end=round(t + dur, 2),
            label=label,
            energy_level=round(energy, 3),
            bass_presence=round(bass, 3),
            has_vocals=has_vocals,
        ))
        t += dur

    patterns = RhythmicPattern(**template["patterns"], pattern_confidence=0.8)
    frames = _generate_frames(sections, bpm)

    return AnalysisResult(
        song=name,
        source_file=f"synthetic/{name}.mp3",
        duration=round(t, 2),
        bpm=bpm,
        bpm_confidence=0.9,
        fps=30,
        sections=sections,
        patterns=patterns,
        frames=frames,
    )


def generate_all(output_dir: str | None = None) -> list[AnalysisResult]:
    """Generate one synthetic song per template. Optionally save to disk."""
    results = []
    for i, (template_name, _) in enumerate(SONG_TEMPLATES.items()):
        name = f"synth_{template_name}"
        analysis = generate_synthetic(name, template_name, seed=42 + i)
        results.append(analysis)

        if output_dir:
            out = Path(output_dir)
            out.mkdir(parents=True, exist_ok=True)
            path = out / f"{name}_analysis.json"
            path.write_text(analysis.model_dump_json(indent=2))
            print(f"  Wrote {path} ({len(analysis.frames)} frames, {len(analysis.sections)} sections)")

    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "synthetic"
    results = generate_all(out_dir)
    print(f"\nGenerated {len(results)} synthetic songs:")
    for r in results:
        labels = [s.label for s in r.sections]
        print(f"  {r.song}: {r.bpm} BPM, {r.duration:.0f}s, sections: {' → '.join(labels)}")
