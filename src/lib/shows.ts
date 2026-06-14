// Tailored shows — hand-authored scene timelines for specific tracks.
//
// A show is a list of CUES: absolute looks pinned to a timestamp in the song.
// When lightflow plays the audio itself it owns the clock, so cues fire frame-
// accurately (see project_live_branch "SHOW mode"). Each cue is an ABSOLUTE
// state, not a delta — so the player only ever has to apply the most-recent cue
// at the current time, which makes seeking/scrubbing correct for free.
//
// Designing a show = listening to the track's structure (intro / drop /
// breakdown / climax / the silences) and confidently picking which scene (1-0)
// and colour each moment wants, plus blacking out the dead air. Scenes are the
// living looks in scenes.ts; colours are the COLOR_KEYS override (null = amber,
// the rig's resting colour). Add new shows to SHOWS keyed by slug.

export interface Cue {
  t: number; // seconds into the track
  scene?: string; // scene key '1'-'0' (SCENE_BY_KEY) — force-set, not toggled
  color?: string | null; // colour key (COLOR_KEYS) · null = amber · omit = leave colour as-is
  blackout?: boolean; // kill the look (for silences / stabs)
  note?: string; // why this cue — designer intent, shown nowhere but the source
}

export interface Show {
  slug: string; // matches the audio file in public/songs/<slug>.<ext>
  title: string;
  artist: string; // performing artist
  audio: string; // public URL of the track lightflow plays to own the clock
  bpm: number; // sets the beat clock on play so scene motion locks to the song
  duration: number; // seconds (for the progress bar)
  cues: Cue[]; // MUST be sorted ascending by t
}

// "Don't Turn It Off (v5)" — ~151s, 126 BPM. Cue skeleton from build_show.py
// (downbeat-snapped sections), plus the track's signature stop/start silences
// hand-placed as blackouts. Arc: warm intro → silence gap → groove build → drop
// → bass-out breakdown → climax → the stutter-silence outro → fade.
const dontTurnItOff: Show = {
  slug: 'dont_turn_it_off_v5',
  title: 'Don’t Turn It Off (v5)',
  artist: 'Banjo',
  audio: '/songs/dont_turn_it_off_v5.m4a',
  bpm: 126,
  duration: 151.2,
  cues: [
    { t: 0.0, scene: '1', color: null, note: 'intro — Halo solo, warm' },
    { t: 6.0, blackout: true, note: 'signature silence gap — go dark' },
    { t: 7.6, scene: '4', color: null, note: 'groove builds in — Rise' },
    { t: 32.62, scene: '0', color: 'b', note: 'DROP — Party strobe, blue (on the downbeat)' },
    { t: 66.64, scene: '2', color: 'b', note: 'breakdown, bass out — Spots solo, blue beams' },
    { t: 93.11, scene: '8', color: 'w', note: 'climax — Peak strobe, white' },
    { t: 108.2, scene: '0', color: 'r', note: 'climax sustain — Party strobe, hot red' },
    { t: 138.46, scene: '1', color: null, note: 'outro — Halo, warm' },
    { t: 141.1, blackout: true, note: 'stutter silence #1' },
    { t: 141.9, scene: '1', color: null, note: 'tail — Halo' },
    { t: 144.0, blackout: true, note: 'stutter silence #2' },
    { t: 147.6, scene: '1', color: null, note: 'final tail — Halo' },
    { t: 149.5, blackout: true, note: 'end' },
  ],
};

// "Energy" — Flava D & Stush. ~213s, ~143 BPM bassline/UKG. Arc: long
// atmospheric intro that builds → riser tension → first drop at 41s (75s long,
// breathes mid-way) → quick bass-out breakdown → the bigger second drop at 123s
// → sustained colour → wind-down → silence.
// Cue times are DOWNBEAT-SNAPPED (via scripts/build_show.py, which repurposes
// the branch's detect_song_sections + a grid snap): drops land on the bar, and
// scenes hold for many bars — the engine's 16-bar variation keeps them alive.
const energy: Show = {
  slug: 'energy_flava_d_stush',
  title: 'Energy',
  artist: 'Flava D & Stush',
  audio: '/songs/energy_flava_d_stush.m4a',
  bpm: 143.6,
  duration: 212.7,
  cues: [
    { t: 0.0, scene: '1', color: null, note: 'intro — Halo solo, warm' },
    { t: 14.1, scene: '4', color: null, note: 'build — Rise, full rig low (16 bars to the drop)' },
    { t: 27.5, scene: '7', color: null, note: 'riser tension — Pulse (8 bars to the drop)' },
    { t: 40.87, scene: '0', color: 'b', note: 'DROP 1 — Party strobe, blue (on the downbeat)' },
    { t: 64.64, scene: '8', color: 'w', note: 'lift within body 1 — Peak strobe, white' },
    { t: 91.86, scene: '6', color: null, note: 'body 1 groove — Drive, warm (no strobe)' },
    { t: 112.43, scene: '2', color: 'b', note: 'breakdown, bass out — Spots solo, blue beams' },
    { t: 133.0, scene: '0', color: 'r', note: 'DROP 2 — Party strobe, hot red (~32-bar hold)' },
    { t: 181.0, scene: '8', color: 'w', note: 'final climax push — Peak strobe, white' },
    { t: 191.0, scene: '4', color: null, note: 'comedown — Rise' },
    { t: 198.0, scene: '1', color: null, note: 'outro — Halo, fade warm' },
    { t: 206.0, blackout: true, note: 'silence / end' },
  ],
};

// "Beto's Horns (fred remix)" — Fred again.. & CA7RIEL & Paco Amoroso. ~226s,
// 129 BPM emotive house. Cue skeleton from build_show.py (downbeat-snapped),
// with build/riser steps added as whole-bar offsets from each drop. Arc: build
// → drop 56s → breakdown → drop 2 124s → intimate breakdown 131s → riser →
// final climax 184s → fade.
const betosHorns: Show = {
  slug: 'betos_horns_fred_remix',
  title: 'Beto’s Horns (fred remix)',
  artist: 'Fred again.. & CA7RIEL & Paco Amoroso',
  audio: '/songs/betos_horns_fred_remix.m4a',
  bpm: 129.2,
  duration: 226.2,
  cues: [
    { t: 0.0, scene: '1', color: null, note: 'intro — Halo solo, warm' },
    { t: 26.5, scene: '4', color: null, note: 'build — Rise (16 bars to drop 1)' },
    { t: 41.3, scene: '7', color: null, note: 'riser — Pulse (8 bars to drop 1)' },
    { t: 56.17, scene: '0', color: 'b', note: 'DROP 1 — Party strobe, blue' },
    { t: 82.76, scene: '2', color: 'b', note: 'breakdown — Spots solo, blue beams' },
    { t: 101.49, scene: '6', color: null, note: 'rebuild — Drive, warm groove' },
    { t: 123.97, scene: '8', color: 'w', note: 'drop 2 peak — Peak strobe, white' },
    { t: 131.49, scene: '1', color: null, note: 'intimate breakdown — Halo solo (the emotional Fred moment)' },
    { t: 154.7, scene: '4', color: null, note: 'build returns — Rise' },
    { t: 169.6, scene: '7', color: null, note: 'riser — Pulse (8 bars to the final drop)' },
    { t: 184.46, scene: '0', color: 'r', note: 'FINAL CLIMAX — Party strobe, hot red' },
    { t: 220.1, scene: '1', color: null, note: 'outro — Halo, fade warm' },
    { t: 222.24, blackout: true, note: 'silence / end' },
  ],
};

export const SHOWS: Record<string, Show> = {
  [dontTurnItOff.slug]: dontTurnItOff,
  [energy.slug]: energy,
  [betosHorns.slug]: betosHorns,
};

export const SHOW_LIST: Show[] = Object.values(SHOWS);

// Largest cue index whose time is <= t (or -1 before the first cue). Because
// cues are absolute, applying just this one reproduces the correct look at any
// position — forward play or backward scrub alike.
export function cueIndexAt(show: Show, t: number): number {
  let idx = -1;
  for (let i = 0; i < show.cues.length; i++) {
    if (show.cues[i].t <= t) idx = i;
    else break;
  }
  return idx;
}
