"""Author a scene-cue show from a track, the reliable way.

Repurposes the offline analysis from the v3 branch (`detect_song_sections`,
which needs only the mix + BPM — no demucs/stems) to find musically-derived
section boundaries, then:
  1. snaps every boundary to the DOWNBEAT grid (so scene changes land on the
     bar, never "off grid"),
  2. maps each section to a scene by energy / bass / position,
  3. merges consecutive same-scene sections and enforces a minimum hold so a
     scene can hang for many bars (the engine adds the mid-scene variation),
  4. prints a cues[] block ready to paste into src/lib/shows.ts.

Usage:  KMP_DUPLICATE_LIB_OK=TRUE python scripts/build_show.py "<audio>" [min_bars]
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "archive" / "v3-python"))
import numpy as np  # noqa: E402
import librosa  # noqa: E402
from analyze import detect_song_sections  # noqa: E402


def map_scene(E: float, B: float, p: float, label: str) -> tuple[str, str | None]:
    """(scene key, color) for a section. color None = amber default.

    Scenes: 1 Halo · 2 Spots · 3 Shockers (isolation) · 4 Rise 5 Surge 6 Drive
    7 Pulse (ramp) · 8 Peak 9 Blinder 0 Party (max, strobe).
    """
    if label == "intro" or (p < 0.12 and E < 0.32):
        return "1", None                 # warm halo intro
    if label == "outro" or (p > 0.85 and E < 0.36):
        return "1", None                 # warm halo outro
    if E < 0.32 and B < 0.14:
        return "2", "b"                  # breakdown / bass-out -> spots, blue
    if label == "buildup":
        return "7", None                 # riser tension -> pulse
    if E >= 0.6:
        return "8", None                 # big drop -> peak (strobe)
    if E >= 0.46:
        return "6", None                 # driving section
    if E >= 0.36:
        return "5", None                 # surge
    return "4", None                     # low full-rig


def build(path: str, min_bars: float = 8.0):
    y, sr = librosa.load(path, mono=True)
    dur = float(librosa.get_duration(y=y, sr=sr))
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.atleast_1d(tempo)[0])
    # half-time guard: dance tracks often track at half tempo (e.g. 63 vs 126).
    # Fold up so the bar grid + min-hold reason about real bars.
    while tempo < 90:
        tempo *= 2
    bt = librosa.frames_to_time(beats, sr=sr)
    bar = 4 * 60.0 / tempo

    # downbeat phase = the beat-of-4 carrying the most onset energy
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    ot = librosa.frames_to_time(np.arange(len(onset)), sr=sr)
    bo = np.array([onset[int(np.argmin(np.abs(ot - t)))] for t in bt])
    phase = int(np.argmax([bo[p::4].mean() for p in range(4)]))
    downs = bt[phase::4]

    def snap(t: float) -> float:
        return round(float(downs[int(np.argmin(np.abs(downs - t)))]), 2)

    secs = detect_song_sections(y, sr, tempo)

    # per-section scene, then merge runs + enforce a minimum hold (in bars)
    cues = []
    for s in secs:
        scene, color = map_scene(s.energy_level, s.bass_presence, s.start / dur, s.label)
        t = snap(s.start)
        if cues:
            prev = cues[-1]
            same = prev["scene"] == scene and prev["color"] == color
            too_soon = (t - prev["t"]) < min_bars * bar
            if same or too_soon:
                continue
        cues.append({"t": t, "scene": scene, "color": color, "label": s.label,
                     "E": s.energy_level, "B": s.bass_presence})
    cues.append({"t": snap(dur), "blackout": True, "label": "end"})

    return tempo, dur, bar, cues


def main():
    path = sys.argv[1]
    min_bars = float(sys.argv[2]) if len(sys.argv) > 2 else 8.0
    tempo, dur, bar, cues = build(path, min_bars)
    print(f"# {Path(path).name}")
    print(f"# tempo={tempo:.1f} bpm  bar={bar:.3f}s  dur={dur:.1f}s  min_hold={min_bars} bars")
    print("  cues: [")
    for c in cues:
        if c.get("blackout"):
            print(f"    {{ t: {c['t']}, blackout: true, note: 'end' }},")
        else:
            col = "null" if c["color"] is None else f"'{c['color']}'"
            bars = ""
            print(f"    {{ t: {c['t']}, scene: '{c['scene']}', color: {col}, "
                  f"note: '{c['label']} E={c['E']} B={c['B']}' }},")
    print("  ],")


if __name__ == "__main__":
    main()
