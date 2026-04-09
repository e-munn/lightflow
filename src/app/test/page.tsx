'use client';

/**
 * Director rating harness.
 *
 * Plays 8-second clips from each preset song on loop, runs the deterministic
 * Director pipeline (attention -> modulator) over the clip, and shows the
 * lighting response as a fullscreen flash. Rate each clip with j (bad) /
 * k (good) / ; (skip), tag failures with 1-6.
 *
 * Ratings persist to localStorage so reloads don't lose progress.
 * Stats panel shows aggregate accuracy and tag breakdowns.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { AnalysisResult, StemFrame } from '@/types/v3';
import { computeAttention, resetAttention } from '@/lib/attention';
import {
  MODULATORS,
  resetDecayingStrobe,
  resetBeatStrobe,
  resetDirector,
  getDirectorChoice,
  getDirectorPulseRate,
  DIRECTOR_VERSION,
  DIRECTOR_DESCRIPTION,
} from '@/lib/modulators';
import { estimateBeatOffset, beatPhases } from '@/lib/beatAlign';

// Hardcoded fallback if no manifest.json is present.
const FALLBACK_PRESETS: Array<{ name: string; slug: string; ext?: string }> = [
  { name: "Actin' Tough (Dean Turnley)", slug: 'actin_tough' },
  { name: "I Don't Sell (Makonnen)", slug: 'i_dont_sell_makonnen' },
  { name: 'Life During Wartime [jazz version]', slug: 'life_during_wartime' },
  { name: 'Hide and Seek (VIP)', slug: 'hide_and_seek' },
  { name: 'Tell Me', slug: 'tell_me_KLICKAUD' },
  { name: 'Gorilla (Little Simz)', slug: 'Little_Simz_-_Gorilla_Know_Good_Flip_KLICKAUD' },
  { name: 'Смерти Больше Нет', slug: 'Смерти_Больше_Нет_KLICKAUD' },
  { name: 'Pop Lock Drop It (Whethan Remix)', slug: 'Huey_-_Pop_Lock_Drop_It_Whethan_Remix_KLICKAUD' },
];

const CLIP_LENGTH_SEC = 8;
const CLIP_LENGTH_CS = Math.round(CLIP_LENGTH_SEC * 100);
const CLIPS_PER_SONG = 6;     // even spread across the song
const LOCAL_BACKUP_KEY = 'lightflow_test_ratings_v2';   // localStorage mirror
// DIRECTOR_VERSION + DIRECTOR_DESCRIPTION are imported from modulators.ts

const TAG_LIST = [
  { key: 'sparse',  label: 'too sparse' },
  { key: 'busy',    label: 'too busy' },
  { key: 'wrongFx', label: 'wrong fx' },
  { key: 'offBeat', label: 'off-beat' },
  { key: 'boring',  label: 'boring' },
  { key: 'wrongStem', label: 'wrong stem' },
] as const;

// Signal flash uses plain white so we're rating the Director's
// *brightness/timing*, not getting distracted by color differentiation.

interface Clip {
  songSlug: string;
  songName: string;
  songExt: string;
  startSec: number;
  startCs: number;       // start in centiseconds (stable int)
  lengthCs: number;
  /** Stable ID. Format: "<slug>@<startCs>+<lengthCs>". Decoupled from
   *  CLIPS_PER_SONG, frame counts, or analysis duration so the same clip
   *  always has the same ID across reloads, refactors, and reanalysis. */
  id: string;
}

interface Rating {
  id: string;
  rating: 'good' | 'bad' | 'skip';
  tags: string[];
  ts: number;
  version: string;
  songSlug: string;
  startCs: number;
  lengthCs: number;
}

type RatingsMap = Record<string, Rating>;

/** Build the stable clip ID from its three intrinsic properties. */
function makeClipId(slug: string, startCs: number, lengthCs: number): string {
  return `${slug}@${startCs}+${lengthCs}`;
}

/** Local backup so we don't lose ratings if the API is unreachable. */
function loadLocalBackup(): RatingsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_BACKUP_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLocalBackup(ratings: RatingsMap) {
  try { window.localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify(ratings)); } catch { /* ignore */ }
}

async function fetchRatings(): Promise<RatingsMap> {
  try {
    const r = await fetch('/api/ratings', { cache: 'no-store' });
    if (!r.ok) return loadLocalBackup();
    const data = await r.json();
    return (data?.ratings as RatingsMap) ?? {};
  } catch {
    return loadLocalBackup();
  }
}

async function postRating(rating: Rating): Promise<boolean> {
  try {
    const r = await fetch('/api/ratings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rating),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export default function TestPage() {
  // Build the clip pool: load song list from manifest.json (built by
  // scripts/ingest_audio_dir.py), with the hardcoded preset list as fallback.
  // For each song, slice it into CLIPS_PER_SONG evenly-spaced 8s windows.
  const [songList, setSongList] = useState<typeof FALLBACK_PRESETS>([]);
  const [analyses, setAnalyses] = useState<Record<string, AnalysisResult>>({});
  const [loadingErr, setLoadingErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Try the manifest first
      let list = FALLBACK_PRESETS;
      try {
        const m = await fetch('/songs/manifest.json');
        if (m.ok) {
          const arr = (await m.json()) as typeof FALLBACK_PRESETS;
          if (Array.isArray(arr) && arr.length) list = arr;
        }
      } catch { /* fall back */ }
      if (cancelled) return;
      setSongList(list);

      // Load analyses for each
      const out: Record<string, AnalysisResult> = {};
      for (const s of list) {
        try {
          const res = await fetch(`/songs/${s.slug}_analysis.json`);
          if (!res.ok) continue;
          const data = await res.json() as AnalysisResult;
          out[s.slug] = data;
        } catch { /* skip */ }
      }
      if (!cancelled) setAnalyses(out);
    })().catch(e => setLoadingErr(String(e)));
    return () => { cancelled = true; };
  }, []);

  const clips = useMemo<Clip[]>(() => {
    // Build the flat clip list, then do a seeded Fisher-Yates shuffle so
    // the order is random-feeling but deterministic across reloads. URL
    // params reference clip keys, so the shuffle doesn't break bookmarks.
    const flat: Clip[] = [];
    for (const s of songList) {
      const a = analyses[s.slug];
      if (!a) continue;
      const dur = a.duration;
      const usable = dur * 0.85 - dur * 0.05;
      const step = usable / CLIPS_PER_SONG;
      for (let i = 0; i < CLIPS_PER_SONG; i++) {
        const start = dur * 0.05 + i * step;
        if (start + CLIP_LENGTH_SEC > dur) break;
        const startCs = Math.round(start * 100);
        flat.push({
          songSlug: s.slug,
          songName: s.name,
          songExt: s.ext ?? '.mp3',
          startSec: startCs / 100,
          startCs,
          lengthCs: CLIP_LENGTH_CS,
          id: makeClipId(s.slug, startCs, CLIP_LENGTH_CS),
        });
      }
    }
    // Seeded PRNG (mulberry32) for stable shuffles across reloads
    let seed = 0x9e3779b9;
    for (const c of flat) {
      for (let i = 0; i < c.id.length; i++) {
        seed = (seed * 0x01000193) ^ c.id.charCodeAt(i);
      }
    }
    const rng = () => {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Fisher–Yates
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    return flat;
  }, [analyses, songList]);

  // Persistent ratings — primary storage is data/test_ratings.json via the
  // /api/ratings route. We mirror to localStorage as a fallback so a network
  // hiccup doesn't lose the user's work.
  const [ratings, setRatings] = useState<RatingsMap>({});
  useEffect(() => {
    fetchRatings().then(r => {
      const local = loadLocalBackup();
      const merged: RatingsMap = { ...local, ...r };
      setRatings(merged);
      saveLocalBackup(merged);
    });
  }, []);

  // One-shot migration of legacy localStorage entries (old key format
  // "<slug>::<integer_seconds>"). Runs once after the new clips list has
  // loaded so we can match by approximate start time.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    if (typeof window === 'undefined' || clips.length === 0) return;
    let raw: string | null = null;
    try { raw = window.localStorage.getItem('lightflow_test_ratings_v1'); } catch { /* ignore */ }
    if (!raw) { migratedRef.current = true; return; }
    let oldMap: Record<string, { rating: 'good' | 'bad' | 'skip'; tags: string[]; ts: number; version: string }> = {};
    try { oldMap = JSON.parse(raw); } catch { migratedRef.current = true; return; }
    const oldEntries = Object.entries(oldMap);
    if (!oldEntries.length) { migratedRef.current = true; return; }

    let migrated = 0;
    const updates: Rating[] = [];
    for (const [oldKey, oldVal] of oldEntries) {
      const m = oldKey.match(/^(.+)::(\d+)$/);
      if (!m) continue;
      const slug = m[1];
      const startSec = parseInt(m[2], 10);
      // Find the clip whose intended start is closest to that integer second.
      const candidates = clips.filter(c => c.songSlug === slug);
      if (!candidates.length) continue;
      let best = candidates[0];
      let bestErr = Math.abs(best.startSec - startSec);
      for (const c of candidates) {
        const err = Math.abs(c.startSec - startSec);
        if (err < bestErr) { best = c; bestErr = err; }
      }
      if (bestErr > 1.0) continue;   // no good match
      const next: Rating = {
        id: best.id,
        rating: oldVal.rating,
        tags: oldVal.tags ?? [],
        ts: oldVal.ts ?? Date.now(),
        version: oldVal.version ?? DIRECTOR_VERSION,
        songSlug: best.songSlug,
        startCs: best.startCs,
        lengthCs: best.lengthCs,
      };
      updates.push(next);
      migrated++;
    }
    if (updates.length === 0) { migratedRef.current = true; return; }
    // POST all migrations, then mark done and refresh state
    Promise.all(updates.map(postRating)).then(() => {
      setRatings(prev => {
        const next = { ...prev };
        for (const u of updates) next[u.id] = u;
        saveLocalBackup(next);
        return next;
      });
      console.log(`[ratings] migrated ${migrated} legacy entries from localStorage`);
      // Don't delete the legacy key — leave a paper trail for now
      migratedRef.current = true;
    });
  }, [clips]);

  const persistRating = useCallback((clip: Clip, partial: Partial<Rating>) => {
    setRatings(prev => {
      const cur = prev[clip.id] ?? {
        id: clip.id,
        rating: 'skip' as const,
        tags: [] as string[],
        ts: 0,
        version: DIRECTOR_VERSION,
        songSlug: clip.songSlug,
        startCs: clip.startCs,
        lengthCs: clip.lengthCs,
      };
      const next: Rating = {
        ...cur,
        ...partial,
        id: clip.id,
        ts: Date.now(),
        version: DIRECTOR_VERSION,
        songSlug: clip.songSlug,
        startCs: clip.startCs,
        lengthCs: clip.lengthCs,
      };
      const map = { ...prev, [clip.id]: next };
      saveLocalBackup(map);
      // Fire-and-forget API write. If the server is down, the localStorage
      // mirror keeps the rating safe.
      postRating(next);
      return map;
    });
  }, []);

  const updateRating = useCallback((clip: Clip, r: Partial<Rating>) => {
    persistRating(clip, r);
  }, [persistRating]);

  const toggleTag = useCallback((clip: Clip, tag: string) => {
    setRatings(prev => {
      const cur = prev[clip.id];
      const tags = cur?.tags ?? [];
      const newTags = tags.includes(tag) ? tags.filter(t => t !== tag) : [...tags, tag];
      const next: Rating = {
        id: clip.id,
        rating: cur?.rating ?? 'skip',
        tags: newTags,
        ts: Date.now(),
        version: DIRECTOR_VERSION,
        songSlug: clip.songSlug,
        startCs: clip.startCs,
        lengthCs: clip.lengthCs,
      };
      const map = { ...prev, [clip.id]: next };
      saveLocalBackup(map);
      postRating(next);
      return map;
    });
  }, []);

  // Current clip index — initial value comes from ?clip=<key> in the URL,
  // resolved against the loaded clip pool. Subsequent changes write the
  // clip key back into the URL via replaceState so reloads & shared links
  // land on the same clip.
  const [idx, setIdx] = useState(0);
  const [resolvedFromUrl, setResolvedFromUrl] = useState(false);

  /** Returns true if this clip has NOT been rated under the current algo version. */
  const isUnratedCurrent = useCallback((c: Clip) => {
    const r = ratings[c.id];
    return !r || r.version !== DIRECTOR_VERSION;
  }, [ratings]);

  /** Find the index of the next clip (from `from`) that hasn't been rated
   *  under the current algo version. Wraps around; falls back to `from`. */
  const findNextUnrated = useCallback((from: number, direction: 1 | -1 = 1): number => {
    if (clips.length === 0) return 0;
    for (let off = 0; off < clips.length; off++) {
      const i = ((from + direction * off) % clips.length + clips.length) % clips.length;
      if (isUnratedCurrent(clips[i])) return i;
    }
    return from;
  }, [clips, isUnratedCurrent]);

  useEffect(() => {
    if (resolvedFromUrl || clips.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get('clip');
    if (wanted) {
      const i = clips.findIndex(c => c.id === wanted);
      if (i >= 0) {
        setIdx(i);
        setResolvedFromUrl(true);
        return;
      }
    }
    // No URL target — jump to the first clip not yet rated under the
    // current algo version. Gets you onto fresh material on page load.
    setIdx(findNextUnrated(0));
    setResolvedFromUrl(true);
  }, [clips, resolvedFromUrl, findNextUnrated]);
  // Push the current clip into the URL (replaceState — no history clutter)
  useEffect(() => {
    if (!resolvedFromUrl || !clips[idx]) return;
    const params = new URLSearchParams(window.location.search);
    params.set('clip', clips[idx].id);
    const url = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', url);
  }, [idx, clips, resolvedFromUrl]);
  const clip = clips[idx];

  // How long to wait after the Director has warmed up before accepting
  // ratings. Gives the listener a moment to actually hear the clip.
  const SETTLING_SEC = 2.0;

  // Audio playback (looped on the current clip's window).
  // We PAUSE audio until the Director has been synchronously warmed up,
  // so the first frame of audible playback already reflects correct state.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [settlingUntil, setSettlingUntil] = useState<number>(0);   // wall-clock ms
  const [settlingProgress, setSettlingProgress] = useState(0);      // 0..1

  useEffect(() => {
    if (!clip) return;
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.src = `/songs/${clip.songSlug}${clip.songExt}`;
    const onLoaded = () => {
      el.currentTime = clip.startSec;
      // Start playback AFTER the Director has warmed up (done by the sim effect)
      el.play().catch(() => { /* user gesture may be needed */ });
      setSettlingUntil(performance.now() + SETTLING_SEC * 1000);
    };
    el.addEventListener('loadedmetadata', onLoaded, { once: true });
    const onTimeUpdate = () => {
      if (el.currentTime >= clip.startSec + CLIP_LENGTH_SEC) {
        el.currentTime = clip.startSec;
      }
    };
    el.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      el.removeEventListener('loadedmetadata', onLoaded);
      el.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [clip?.id]);

  // Director simulation. WARMUP RUNS SYNCHRONOUSLY inside the effect so
  // when audio starts playing, every frame sees a fully-converged Director
  // state. Prevents the "first fx look different" flicker that happens when
  // audio plays during rAF-split warmup.
  const [signal, setSignal] = useState(0);
  const [dominantStem, setDominantStem] = useState('bass');
  const [fx, setFx] = useState('raw');
  const [pulseRate, setPulseRate] = useState(0);
  const [isSettling, setIsSettling] = useState(true);

  useEffect(() => {
    if (!clip) return;
    const analysis = analyses[clip.songSlug];
    if (!analysis) return;
    const el = audioRef.current;
    if (!el) return;

    // Reset all state machines for this clip
    resetAttention();
    resetDirector();
    resetBeatStrobe();
    resetDecayingStrobe();

    // Beat-offset: grid-fit the song's kick onsets to find the true
    // downbeat in the recording. Without this, "bar start" in the
    // Director aligns to t=0 instead of the actual musical downbeat
    // and transitions land off-beat.
    const beatOffset = estimateBeatOffset(analysis);

    // ---- Synchronous warmup ----
    // Replay every frame from song start up to the clip's start so the
    // attention + Director end up in exactly the state they'd be in at
    // real-time playback of the clip's beginning.
    const frames = analysis.frames;
    const targetFrameIdx = Math.min(
      frames.length,
      Math.max(0, Math.floor((clip.startSec / analysis.duration) * frames.length))
    );
    const dtw = 1 / (analysis.fps || 30);
    for (let i = 0; i < targetFrameIdx; i++) {
      const f = frames[i];
      if (!f) break;
      const att = computeAttention(f, dtw, analysis.bpm);
      const ph = beatPhases(f.time, analysis.bpm, beatOffset);
      MODULATORS.director.fn({
        signal: att.signal,
        time: f.time,
        beatPhase: ph.beatPhase,
        barPhase: ph.barPhase,
        bpm: analysis.bpm,
        dt: dtw,
        dominantStem: att.dominant,
        centroid: f.centroid,
      });
    }
    // Mark settling — vote buttons disabled until this elapses
    setIsSettling(true);

    // ---- Live rAF loop ----
    let rafId = 0;
    let lastT = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;

      // Update settling progress
      if (settlingUntil > 0) {
        const remaining = settlingUntil - now;
        if (remaining > 0) {
          setSettlingProgress(1 - remaining / (SETTLING_SEC * 1000));
          setIsSettling(true);
        } else if (isSettling) {
          setSettlingProgress(1);
          setIsSettling(false);
        }
      }

      const t = el.currentTime;
      const fIdx = Math.min(analysis.frames.length - 1, Math.floor(t * analysis.fps));
      const frame = analysis.frames[fIdx] as StemFrame | undefined;
      if (!frame) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      const att = computeAttention(frame, dt, analysis.bpm);
      const ph = beatPhases(t, analysis.bpm, beatOffset);
      const modulated = Math.max(0, Math.min(1, MODULATORS.director.fn({
        signal: att.signal,
        time: t,
        beatPhase: ph.beatPhase,
        barPhase: ph.barPhase,
        bpm: analysis.bpm,
        dt,
        dominantStem: att.dominant,
        centroid: frame.centroid,
      })));
      setSignal(modulated);
      setDominantStem(att.dominant);
      setFx(getDirectorChoice());
      setPulseRate(getDirectorPulseRate());
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [clip?.id, analyses, settlingUntil]);

  // Auto-advance after rating — jumps to next UNRATED-in-current-version clip,
  // not just the next index. Saves you from sitting on already-rated clips.
  const advance = useCallback(() => {
    setIdx(i => findNextUnrated(i + 1, 1));
  }, [findNextUnrated]);
  const back = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const jumpToFirstUnrated = useCallback(() => {
    setIdx(findNextUnrated(0, 1));
  }, [findNextUnrated]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!clip) return;
      // Block rating during the settling period
      if (isSettling && (e.code === 'KeyB' || e.code === 'KeyG' || e.code === 'KeyS')) {
        e.preventDefault();
        return;
      }
      if (e.code === 'KeyB') { e.preventDefault(); updateRating(clip, { rating: 'bad' });  advance(); }
      else if (e.code === 'KeyG') { e.preventDefault(); updateRating(clip, { rating: 'good' }); advance(); }
      else if (e.code === 'KeyS') { e.preventDefault(); updateRating(clip, { rating: 'skip' }); advance(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); advance(); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.code === 'KeyN') { e.preventDefault(); jumpToFirstUnrated(); }
      else if (e.code === 'Space') { e.preventDefault(); audioRef.current?.paused ? audioRef.current?.play() : audioRef.current?.pause(); }
      else if (/^Digit[1-6]$/.test(e.code)) {
        e.preventDefault();
        const n = parseInt(e.code.slice(5), 10) - 1;
        toggleTag(clip, TAG_LIST[n].key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clip?.id, advance, back, updateRating, toggleTag, isSettling, clip, jumpToFirstUnrated]);

  // Stats — scoped to the current DIRECTOR_VERSION so changes to the algo
  // don't retroactively improve/degrade numbers from past versions.
  const stats = useMemo(() => {
    const all = Object.values(ratings).filter(r => r.version === DIRECTOR_VERSION);
    const good = all.filter(r => r.rating === 'good').length;
    const bad = all.filter(r => r.rating === 'bad').length;
    const skip = all.filter(r => r.rating === 'skip').length;
    const tagCounts: Record<string, number> = {};
    for (const r of all) for (const t of r.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1;
    // Cross-version comparison
    const byVersion: Record<string, { good: number; bad: number; total: number }> = {};
    for (const r of Object.values(ratings)) {
      const v = r.version || 'unknown';
      byVersion[v] ??= { good: 0, bad: 0, total: 0 };
      byVersion[v].total++;
      if (r.rating === 'good') byVersion[v].good++;
      else if (r.rating === 'bad') byVersion[v].bad++;
    }
    return { good, bad, skip, total: all.length, tagCounts, byVersion };
  }, [ratings]);

  const cur = clip ? ratings[clip.id] : undefined;

  if (loadingErr) return <div className="p-8 text-red-400">Failed to load: {loadingErr}</div>;
  if (!clips.length) return <div className="p-8 text-white/60">Loading analyses…</div>;

  return (
    <div className="min-h-screen bg-black text-white font-mono">
      <audio ref={audioRef} hidden />

      {/* Full-screen pure white flash. Opacity = signal (linear). At
          signal=1.0 the screen is 100% white; at signal=0 it's fully dark. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: '#fff',
          opacity: signal,
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 px-6 pt-4 flex items-start justify-between text-sm gap-6">
        <div className="min-w-0">
          <div className="text-white/60 text-xs uppercase tracking-widest">
            clip {idx + 1} / {clips.length}
            {(() => {
              const unratedCount = clips.filter(isUnratedCurrent).length;
              return unratedCount > 0 && (
                <span className="ml-2 text-cyan-400">· {unratedCount} unrated</span>
              );
            })()}
          </div>
          <div className="text-base font-semibold mt-0.5 truncate">{clip?.songName}</div>
          <div className="text-white/60 text-xs">
            {clip?.startSec.toFixed(1)}s – {((clip?.startSec ?? 0) + CLIP_LENGTH_SEC).toFixed(1)}s
            {' · '}
            fx={fx}
            {pulseRate > 0 && <span className="text-cyan-300"> @{pulseRate}/beat</span>}
            {' · '}stem={dominantStem}
          </div>
        </div>

        {/* Prominent algo version banner */}
        <div className="px-3 py-2 rounded-md border border-cyan-500/40 bg-cyan-950/50 backdrop-blur text-[11px] max-w-md shrink">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] uppercase tracking-wider">algo</span>
            <span className="font-mono text-cyan-200 font-semibold">{DIRECTOR_VERSION}</span>
          </div>
          <div className="text-cyan-100/60 mt-1 leading-snug text-[10px]">{DIRECTOR_DESCRIPTION}</div>
        </div>

        <div className="text-right shrink-0">
          <div className="text-xs text-white/60 uppercase tracking-widest">this version</div>
          <div className="text-base font-semibold">
            {stats.total} rated · {stats.good} 👍 / {stats.bad} 👎 / {stats.skip} skip
          </div>
          <div className="text-xs text-white/60">
            {stats.good + stats.bad > 0 ? `${Math.round((stats.good / (stats.good + stats.bad)) * 100)}% good` : '—'}
          </div>
          {/* Cross-version comparison */}
          {Object.keys(stats.byVersion).length > 1 && (
            <div className="mt-2 text-[10px] font-mono text-white/50 text-right">
              {Object.entries(stats.byVersion)
                .sort((a, b) => b[1].total - a[1].total)
                .map(([v, s]) => {
                  const rate = s.good + s.bad > 0 ? Math.round((s.good / (s.good + s.bad)) * 100) : 0;
                  const isCurrent = v === DIRECTOR_VERSION;
                  return (
                    <div key={v} className={isCurrent ? 'text-cyan-300' : 'text-white/40'}>
                      {isCurrent && '▸ '}{v}: {rate}% ({s.good + s.bad})
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar: rating + tags + nav */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-6 pb-6 space-y-3">
        {cur && (
          <div className="text-center text-xs text-white/60">
            current rating: <span className="text-white">{cur.rating}</span>
            {cur.tags.length > 0 && <span> · tags: {cur.tags.join(', ')}</span>}
          </div>
        )}

        <div className="flex items-center justify-center gap-2 flex-wrap">
          {TAG_LIST.map((tag, i) => {
            const active = cur?.tags.includes(tag.key);
            return (
              <button
                key={tag.key}
                onClick={() => clip && toggleTag(clip, tag.key)}
                className={`px-3 py-2 rounded-full text-xs border transition-colors ${
                  active
                    ? 'bg-white/15 border-white/40 text-white'
                    : 'bg-black/40 border-white/15 text-white/55 hover:text-white'
                }`}
              >
                <span className="opacity-50 mr-1.5">{i + 1}</span>{tag.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={back}
            className="px-3 py-2 rounded-full text-xs border border-white/20 text-white/60 hover:text-white"
          >
            ← prev
          </button>
          <button
            disabled={isSettling}
            onClick={() => clip && !isSettling && (updateRating(clip, { rating: 'bad' }), advance())}
            className={`px-6 py-3 rounded-full text-base font-bold border-2 ${
              isSettling
                ? 'border-white/10 bg-white/[0.02] text-white/20 cursor-not-allowed'
                : 'border-red-500/60 bg-red-500/10 hover:bg-red-500/20 text-red-300'
            }`}
          >
            👎 BAD <span className="text-xs opacity-60 ml-1">(b)</span>
          </button>
          <button
            disabled={isSettling}
            onClick={() => clip && !isSettling && (updateRating(clip, { rating: 'skip' }), advance())}
            className={`px-4 py-3 rounded-full text-sm border ${
              isSettling
                ? 'border-white/5 text-white/20 cursor-not-allowed'
                : 'border-white/20 text-white/60 hover:text-white'
            }`}
          >
            skip <span className="text-xs opacity-60 ml-1">(s)</span>
          </button>
          <button
            disabled={isSettling}
            onClick={() => clip && !isSettling && (updateRating(clip, { rating: 'good' }), advance())}
            className={`px-6 py-3 rounded-full text-base font-bold border-2 ${
              isSettling
                ? 'border-white/10 bg-white/[0.02] text-white/20 cursor-not-allowed'
                : 'border-green-500/60 bg-green-500/10 hover:bg-green-500/20 text-green-300'
            }`}
          >
            👍 GOOD <span className="text-xs opacity-60 ml-1">(g)</span>
          </button>
          <button
            onClick={advance}
            className="px-3 py-2 rounded-full text-xs border border-white/20 text-white/60 hover:text-white"
          >
            next →
          </button>
        </div>

        {/* Settling progress bar — shown only during the ramp-up window */}
        {isSettling && (
          <div className="text-center">
            <div className="inline-block min-w-48 px-4 py-2 rounded-full bg-black/60 backdrop-blur border border-white/10">
              <div className="text-[10px] text-white/50 uppercase tracking-widest mb-1">listen</div>
              <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 transition-[width] duration-100 ease-linear"
                  style={{ width: `${Math.round(settlingProgress * 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Stats sidebar (top-tag breakdown) — minimal, top-right corner */}
      {Object.keys(stats.tagCounts).length > 0 && (
        <div className="absolute top-24 right-6 z-10 bg-black/60 backdrop-blur rounded-lg border border-white/10 px-3 py-2 text-[10px] space-y-0.5">
          <div className="text-white/50 uppercase tracking-wider mb-1">tag freq</div>
          {Object.entries(stats.tagCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <div key={t} className="flex justify-between gap-3">
              <span className="text-white/60">{t}</span>
              <span className="text-white">{n}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
