'use client';

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { Settings, Menu, Copy, EyeOff } from 'lucide-react';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { AnalysisResult, StemFrame } from '@/types/v3';
import { computeAttention, resetAttention, configureAttention, setBassFirstEnabled } from '@/lib/attention';
import { MODULATORS, resetDecayingStrobe, resetBeatStrobe, resetDirector, getDirectorChoice, getDirectorChoiceLabel, getDirectorPulseRate, getDirectorUseRaw, pulseAtBeatRate, DIRECTOR_VERSION } from '@/lib/modulators';
import { estimateBeatOffset, beatPhases } from '@/lib/beatAlign';
import { analyzeAudio } from '@/lib/api';
import { resetPhaseChase, resetSpatialDirector } from '@/lib/spatial';
import { SignalGraph, resetSignalGraph } from '@/components/SignalGraph';
import { Screen3D, resetScreen3D } from '@/components/Screen3D';
import { useMidi, type ShowEvent } from '@/hooks/useMidi';
import { MidiPanel } from '@/components/MidiPanel';
import { sendDMX } from '@/lib/dmxClient';
import type { Scout } from '@/lib/scout/schema';
import { loadScout, getActiveMoment, isAnticipating, getSectionAnnotation, buildStemWeights, detectStemEntries, type StemEntryCue } from '@/lib/scout/apply';

interface PresetSong {
  name: string;
  slug: string;
  ext?: string;   // defaults to .mp3
}

// Hardcoded fallback list — used when manifest.json can't be loaded. Locally
// the manifest (built by scripts/ingest_audio_dir.py) lists the full library;
// on the hosted deploy there is no manifest, so these three demo songs (whose
// mp3 + analysis + scout files are tracked in git) are what you get.
const FALLBACK_PRESETS: PresetSong[] = [
  { name: 'Calabria (Austin Marc)', slug: 'calabria_-_austin_marc', ext: '.mp3' },
  { name: 'Damn Right (Audrey Nuna)', slug: 'damn_right_-_audrey_nuna', ext: '.mp3' },
  { name: 'mcdonalds', slug: 'mcdonalds', ext: '.mp3' },
];

const STEMS = ['bass', 'kick', 'snare', 'hat', 'other'] as const;

// Stems span blues/greens/yellows; "other" is neutral gray.
// Effects share a darker violet family.
const STEM_COLOR_RGB: Record<string, string> = {
  bass:  '#166534', // green-800 (dark green)
  kick:  '#22c55e', // green-500
  snare: '#a3e635', // lime-400 (mid green-yellow)
  hat:   '#facc15', // yellow-400
  other: '#6b7280', // gray-500
};

const STEM_COLORS: Record<string, { active: string; dormant: string }> = {
  bass:  { active: 'bg-amber-800 text-amber-200', dormant: 'text-amber-900' },
  kick:  { active: 'bg-red-800 text-red-200', dormant: 'text-red-900' },
  snare: { active: 'bg-blue-800 text-blue-200', dormant: 'text-blue-900' },
  hat:   { active: 'bg-purple-800 text-purple-200', dormant: 'text-purple-900' },
  other: { active: 'bg-gray-700 text-gray-200', dormant: 'text-gray-700' },
};

export default function Home() {
  const { audioState, loadAudioFile, play, pause, seek } = useAudioAnalyzer();

  // MIDI show-recorder input surface
  const [midiPanelOpen, setMidiPanelOpen] = useState(false);
  // Set of slugs that already have a saved show — used for the song-list
  // indicator dot. Refreshed on mount and after each save.
  const [recordedSlugs, setRecordedSlugs] = useState<Set<string>>(new Set());


  // Fetch the list of songs that already have a saved show.
  const refreshRecordedSlugs = useCallback(async () => {
    try {
      const res = await fetch('/api/shows');
      if (!res.ok) return;
      const { slugs } = (await res.json()) as { slugs?: string[] };
      if (Array.isArray(slugs)) setRecordedSlugs(new Set(slugs));
    } catch {
      // noop
    }
  }, []);
  useEffect(() => { refreshRecordedSlugs(); }, [refreshRecordedSlugs]);

  // Show recording was removed (2026-08-22); MIDI input still drives transport/panel.
  const midi = useMidi({ onShowEvent: useCallback((_ev: ShowEvent) => {}, []) });

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [songName, setSongName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Scout: optional per-song metadata from Claude (loaded from _scout.json)
  const [scout, setScout] = useState<Scout | null>(null);
  const [scoutLoading, setScoutLoading] = useState(false);
  const currentSlugRef = useRef<string | null>(null);
  const [stemEntries, setStemEntries] = useState<StemEntryCue[]>([]);

  // The single output signal: 0-1 brightness
  const [signal, setSignal] = useState(0);
  const [dominantStem, setDominantStem] = useState<string>('bass');
  const [soloStem, setSoloStem] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState({ hold: 0, held: 0, energy: 0 });
  const [pinnedMod, setPinnedMod] = useState<string | null>(null);
  const modulator = pinnedMod ?? 'director';
  const [directorChoice, setDirectorChoice] = useState<string>('raw');
  // v1.2: rich label reflecting actual rate, e.g. "strobe·16", "pulse·4".
  // Used for display on the active effect button.
  const [directorLabel, setDirectorLabel] = useState<string>('raw');
  const [activeScoutCue, setActiveScoutCue] = useState<string | null>(null);
  // Independent layer toggles
  const [signalOn, setSignalOn] = useState(true);   // 1-Channel: full screen brightness
  const [spectroOn, setSpectroOn] = useState(false); // screen mode: false = flat full-screen brightness, true = 3D scene (Z toggles; persisted)
  const [multiOn, setMultiOn] = useState(false);    // Multi-channel: 3 horizontal stem panels
  // Smoothed per-stem envelopes (from attention.stemSignals). Tracks the
  // same bass-style smoothing the main signal uses — one per channel.
  const [smoothStems, setSmoothStems] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0, vocals: 0,
  });
  const [accent, setAccent] = useState(0);
  const [accentStem, setAccentStem] = useState('kick');
  const [stemSignals, setStemSignals] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [stemPans, setStemPans] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [stemNovelty, setStemNovelty] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  // Persisted settings
  const [lookAhead, setLookAhead] = useState(0.02);
  const [keyMap, setKeyMap] = useState<'basic' | 'pro'>('basic');
  const [scrubberView, setScrubberView] = useState<'waveform' | 'timeline'>('waveform');
  const [settingsOpen, setSettingsOpen] = useState(false);
  // DMX output controls — master brightness multiplier and CCT (0=warm, 1=cool)
  const [dmxBrightness, setDmxBrightness] = useState(1);
  const [dmxWarmth, setDmxWarmth] = useState(0.5);
  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lightflow.settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.lookAhead === 'number') setLookAhead(Math.min(0.08, Math.max(0, s.lookAhead)));
        if (s.keyMap === 'basic' || s.keyMap === 'pro') setKeyMap(s.keyMap);
        if (s.scrubberView === 'waveform' || s.scrubberView === 'timeline') setScrubberView(s.scrubberView);
        if (typeof s.spectroOn === 'boolean') setSpectroOn(s.spectroOn);
        if (typeof s.dmxBrightness === 'number') setDmxBrightness(Math.min(1, Math.max(0, s.dmxBrightness)));
        if (typeof s.dmxWarmth === 'number') setDmxWarmth(Math.min(1, Math.max(0, s.dmxWarmth)));
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('lightflow.settings', JSON.stringify({ lookAhead, keyMap, scrubberView, spectroOn, dmxBrightness, dmxWarmth })); } catch {}
  }, [lookAhead, keyMap, scrubberView, spectroOn, dmxBrightness, dmxWarmth]);
  const panHistoryRef = useRef<Record<string, number[]>>({});
  // Timestamp of last strong snare hit — used to suppress hat channel
  // during the bleed-tail window (~150ms after the snare). Demucs lets
  // snare noise tails leak into the hat stem; a temporal gate kills
  // it cleanly where subtraction can't.
  const lastSnareHitRef = useRef<number>(-10);
  // Snare sustain — keeps the MID panel lit for ~400ms after a hit so
  // it doesn't read as "left behind" when bass and hat fill the time
  // axis between snare strikes (typical on a 2-and-4 snare pattern).
  const snareSustainRef = useRef<number>(0);
  // Perceptual-decay state per band. Each band tracks its last attack
  // moment + peak so brightness follows a fast-release curve after a
  // hit instead of faithfully tracking the physical tail. Models the
  // ear releasing the transient within 150-250ms regardless of the
  // actual audio envelope.
  const lowDecayRef  = useRef<{ time: number; peak: number; prev: number }>({ time: -10, peak: 0, prev: 0 });
  const midDecayRef  = useRef<{ time: number; peak: number; prev: number }>({ time: -10, peak: 0, prev: 0 });
  const highDecayRef = useRef<{ time: number; peak: number; prev: number }>({ time: -10, peak: 0, prev: 0 });
  const [stemLevels, setStemLevels] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [stemScores, setStemScores] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });

  const lastFrameTimeRef = useRef(0);

  const [songMenuOpen, setSongMenuOpen] = useState(false);
  const [songFilter, setSongFilter] = useState('');
  const [customSongs, setCustomSongs] = useState<{ name: string; file: File }[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [songDurations, setSongDurations] = useState<Record<string, number>>({});
  // Preset list: load from manifest.json (built by scripts/ingest_audio_dir.py),
  // fall back to the hardcoded list if manifest isn't available.
  const [presetSongs, setPresetSongs] = useState<PresetSong[]>(FALLBACK_PRESETS);
  // Gate the auto-load effect until the manifest has resolved (success OR
  // fail). Without this, auto-load races the manifest fetch and picks a
  // fallback preset before the saved-song lookup has the full list to
  // match against.
  const [presetsReady, setPresetsReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/songs/manifest.json');
        if (res.ok) {
          const arr = await res.json();
          if (Array.isArray(arr) && arr.length) {
            setPresetSongs(arr);
          }
        }
      } catch { /* fall back */ }
      setPresetsReady(true);
    })();
  }, []);
  // Lazy-load song durations via metadata only (no full audio download)
  useEffect(() => {
    if (!songMenuOpen) return;
    presetSongs.forEach(song => {
      if (songDurations[song.slug] != null) return;
      const a = new Audio();
      a.preload = 'metadata';
      a.src = `/songs/${song.slug}${song.ext ?? '.mp3'}`;
      a.addEventListener('loadedmetadata', () => {
        setSongDurations(prev => ({ ...prev, [song.slug]: a.duration }));
      }, { once: true });
    });
  }, [songMenuOpen, songDurations, presetSongs]);
  const [uiHidden, setUiHidden] = useState(false);
  // While hidden, any mouse movement brings the controls back.
  useEffect(() => {
    if (!uiHidden) return;
    const reveal = () => setUiHidden(false);
    window.addEventListener('mousemove', reveal);
    return () => window.removeEventListener('mousemove', reveal);
  }, [uiHidden]);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(id);
  }, [toast]);

  // Program timeline: blocks recording stem-focus and effect choices over time
  type Block = { lane: string; start: number; end: number; rate?: number; intensityScale?: number };
  const [programBlocks, setProgramBlocks] = useState<Block[]>([]);
  const stemBlockRef = useRef<{ stem: string; start: number } | null>(null);
  const fxBlockRef = useRef<{ fx: string; start: number } | null>(null);
  const resetProgramTimeline = useCallback(() => {
    setProgramBlocks([]);
    stemBlockRef.current = null;
    fxBlockRef.current = null;
  }, []);

  // Keyboard mappings (home-row, two-handed):
  //   A S D F G   hold to solo stem (bass/kick/snare/hat/other)
  //   H J K L ;   hold to preview effect (raw/strobe/pulse/wobble/blackout)
  //   `           toggle AUTO ↔ last manual pick
  //   Z           toggle spectro
  //   Space       play/pause
  //   ←/→         seek -5s/+5s
  //   ⇧←/⇧→       seek -1bar/+1bar
  //   ⌘←          back to song list
  useEffect(() => {
    const STEM_KEYS: Record<string, string> = keyMap === 'pro'
      ? { 'KeyA': 'bass', 'KeyS': 'kick', 'KeyD': 'snare', 'KeyF': 'hat', 'KeyG': 'other' }
      : { 'Digit1': 'bass', 'Digit2': 'kick', 'Digit3': 'snare', 'Digit4': 'hat', 'Digit5': 'other' };
    const FX_KEYS: Record<string, string> = keyMap === 'pro'
      ? { 'KeyH': 'raw', 'KeyJ': 'halfBarPulse', 'KeyK': 'blackout' }
      : {};
    const prevPinRef = { current: null as string | null };
    const handleDown = (e: KeyboardEvent) => {
      // Ignore typing in real text inputs only
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.repeat) return;
      // Blur any focused button so it doesn't intercept future Space presses
      if (tgt && tgt.tagName === 'BUTTON') tgt.blur();
      if (e.code === 'Space') { e.preventDefault(); audioState.isPlaying ? pause() : play(); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'ArrowLeft') { e.preventDefault(); setSongMenuOpen(v => !v); }
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          const barSec = (60 / (analysis?.bpm ?? 120)) * 4;
          seek(Math.max(0, audioState.currentTime - barSec));
        } else {
          seek(Math.max(0, audioState.currentTime - 5));
        }
      }
      else if (e.code === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          const barSec = (60 / (analysis?.bpm ?? 120)) * 4;
          seek(Math.min(audioState.duration, audioState.currentTime + barSec));
        } else {
          seek(Math.min(audioState.duration, audioState.currentTime + 5));
        }
      }
      else if (e.code === 'KeyZ') {
        e.preventDefault();
        setSpectroOn(v => {
          const next = !v;
          if (next) setMultiOn(false);
          return next;
        });
      }
      else if (e.code === 'Backquote') {
        e.preventDefault();
        setPinnedMod(prev => prev ? null : (prevPinRef.current ?? 'halfBarPulse'));
      }
      else if (STEM_KEYS[e.code]) { e.preventDefault(); setSoloStem(STEM_KEYS[e.code]); }
      else if (FX_KEYS[e.code]) {
        e.preventDefault();
        setPinnedMod(curr => { prevPinRef.current = curr; return FX_KEYS[e.code]; });
      }
    };
    const handleUp = (e: KeyboardEvent) => {
      if (STEM_KEYS[e.code]) setSoloStem(null);
      if (FX_KEYS[e.code]) setPinnedMod(null);
    };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => { window.removeEventListener('keydown', handleDown); window.removeEventListener('keyup', handleUp); };
  }, [audioState.isPlaying, audioState.currentTime, audioState.duration, play, pause, seek, analysis, keyMap]);

  // Precompute the entire program timeline by simulating attention + director
  // through every analysis frame. Runs once when a song loads, before playback.
  const [beatOffset, setBeatOffset] = useState(0);
  const precomputeTimeline = useCallback((res: AnalysisResult) => {
    if (!res.frames.length) return;
    resetAttention();
    resetDirector();
    // Grid-fit beat offset from the song's kick onsets so transitions
    // land on real musical downbeats, not the arbitrary recording origin.
    const offset = estimateBeatOffset(res);
    setBeatOffset(offset);
    const blocks: Block[] = [];
    let curStem: { stem: string; start: number } | null = null;
    let curFx:   { fx: string; start: number; rate: number } | null = null;
    let prevT = res.frames[0].time;
    for (const frame of res.frames) {
      const dt = Math.max(1e-3, frame.time - prevT);
      prevT = frame.time;
      const att = computeAttention(frame, dt, res.bpm);
      const ph = beatPhases(frame.time, res.bpm, offset);
      // Drive director (we don't need its output, just its choice)
      const sec = res.sections.find(s => s.start <= frame.time && s.end > frame.time);
      const rawStems = frame.stems as unknown as Record<string, number>;
      MODULATORS.director.fn({
        signal: att.signal,
        time: frame.time,
        beatPhase: ph.beatPhase,
        barPhase: ph.barPhase,
        bpm: res.bpm,
        dt,
        dominantStem: att.dominant,
        centroid: frame.centroid,
        sectionLabel: sec?.label,
        rawStems,
      });
      const fx = getDirectorChoice();
      const rate = getDirectorPulseRate();
      if (!curStem) curStem = { stem: att.dominant, start: frame.time };
      else if (curStem.stem !== att.dominant) {
        blocks.push({ lane: 'stem:' + curStem.stem, start: curStem.start, end: frame.time });
        curStem = { stem: att.dominant, start: frame.time };
      }
      // Split fx blocks on EITHER label or rate change so we preserve the
      // full rate continuum across playback (not just the coarse legacy label).
      if (!curFx) curFx = { fx, start: frame.time, rate };
      else if (curFx.fx !== fx || curFx.rate !== rate) {
        blocks.push({ lane: 'fx:' + curFx.fx, start: curFx.start, end: frame.time, rate: curFx.rate });
        curFx = { fx, start: frame.time, rate };
      }
    }
    const end = res.frames[res.frames.length - 1].time;
    if (curStem) blocks.push({ lane: 'stem:' + curStem.stem, start: curStem.start, end });
    if (curFx)   blocks.push({ lane: 'fx:' + curFx.fx,       start: curFx.start,   end, rate: curFx.rate });
    setProgramBlocks(blocks);
    // Reset state again so live playback starts clean
    resetAttention();
    resetDirector();
  }, []);

  // Load scout metadata for a song (optional, fails silently)
  const fetchScout = useCallback(async (slug: string) => {
    setScoutLoading(true);
    const data = await loadScout(slug);
    setScout(data);
    setScoutLoading(false);
    // v1.5 bass-first default. Scout can flip it off for non-bass-driven
    // songs by setting primaryStem to something other than bass.
    const bassFirst = !data?.primaryStem || data.primaryStem === 'bass';
    setBassFirstEnabled(bassFirst);
    if (data) {
      configureAttention(buildStemWeights(data));
    } else {
      configureAttention();
    }
  }, []);

  // Generate scout via Claude API, save result, and activate it
  const generateScout = useCallback(async () => {
    const slug = currentSlugRef.current;
    if (!slug || scoutLoading) return;
    setScoutLoading(true);
    try {
      const res = await fetch('/api/scout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ analysisUrl: `/songs/${slug}_analysis.json` }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { scout: data } = await res.json();
      if (data) {
        setScout(data);
        const bassFirst = !data.primaryStem || data.primaryStem === 'bass';
        setBassFirstEnabled(bassFirst);
        configureAttention(buildStemWeights(data));
      }
    } catch (err) {
      console.warn('[scout] generation failed:', err);
    } finally {
      setScoutLoading(false);
    }
  }, [scoutLoading]);

  // Load preset
  const loadPreset = useCallback(async (slug: string, name: string, ext: string = '.mp3') => {
    setIsLoading(true);
    setAnalysis(null);
    setScout(null);
    resetAttention();
    resetSignalGraph();
    resetProgramTimeline();
    resetDecayingStrobe();
    resetBeatStrobe();
    resetDirector();
    resetPhaseChase();
    resetSpatialDirector();
    resetScreen3D();
    panHistoryRef.current = {};
    try {
      const analysisRes = await fetch(`/songs/${slug}_analysis.json`).then(r => r.json()) as AnalysisResult;
      setAnalysis(analysisRes);
      setSongName(name);
      currentSlugRef.current = slug;
      // Persist so a refresh returns to this song.
      try {
        localStorage.setItem('lightflow:lastSong', JSON.stringify({ slug, name, ext }));
      } catch {
        // quota / private mode — not fatal
      }
      precomputeTimeline(analysisRes);
      setStemEntries(detectStemEntries(analysisRes.frames, analysisRes.bpm, analysisRes.fps));
      fetchScout(slug);
      await loadAudioFile(`/songs/${slug}${ext}`);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadAudioFile, precomputeTimeline, resetProgramTimeline, fetchScout]);

  // Load a user-dropped file in raw mode (no analysis → no Director, no
  // attention layer, no Program Focus Timeline). Audio just plays.
  // The UI shows a "raw mode" hint until full server-side analysis is wired.
  // In-memory analysis cache: dropping the same file (by name + size) twice
  // doesn't re-trigger a 30–90s demucs run.
  const analysisCacheRef = useRef<Map<string, AnalysisResult>>(new Map());
  const [analyzingStatus, setAnalyzingStatus] = useState<string | null>(null);


  const loadCustomFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setAnalysis(null);
    setScout(null);
    resetAttention();
    resetSignalGraph();
    resetDecayingStrobe();
    resetBeatStrobe();
    resetDirector();
    resetPhaseChase();
    resetSpatialDirector();
    resetScreen3D();
    resetProgramTimeline();
    panHistoryRef.current = {};
    setCustomSongs(prev => prev.find(c => c.name === file.name) ? prev : [...prev, { name: file.name, file }]);
    setSongName(file.name.replace(/\.[^.]+$/, ''));

    // Start audio loading and analysis in parallel — playback can start
    // before the analysis returns.
    const audioPromise = loadAudioFile(file).catch(err => {
      console.error('Failed to load audio:', err);
    });

    // Analyze (or hit cache)
    const cacheKey = `${file.name}::${file.size}::${file.lastModified}`;
    const cached = analysisCacheRef.current.get(cacheKey);
    if (cached) {
      setAnalyzingStatus(null);
      setAnalysis(cached);
      precomputeTimeline(cached);
      await audioPromise;
      setIsLoading(false);
      return;
    }

    setAnalyzingStatus('1/2 · separating stems…');
    try {
      const result = await analyzeAudio(file);
      analysisCacheRef.current.set(cacheKey, result);
      setAnalysis(result);
      precomputeTimeline(result);
    } catch (err) {
      console.error('Analysis failed:', err);
      setAnalyzingStatus('analysis failed — playing raw');
      setTimeout(() => setAnalyzingStatus(null), 4000);
    }

    await audioPromise;
    setIsLoading(false);
  }, [loadAudioFile, resetProgramTimeline, precomputeTimeline]);

  // Page-level drag & drop
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setIsDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      if ((e.target as HTMLElement).tagName === 'HTML' || e.relatedTarget == null) setIsDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files[0];
      if (file && file.type.startsWith('audio/')) loadCustomFile(file);
    };
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [loadCustomFile]);

  // Auto-load last-played song on mount (persisted in localStorage).
  // Falls back to the first preset. Custom drops can't persist — the File
  // blob is gone after a refresh — so we only remember preset slugs.
  const didAutoLoadRef = useRef(false);
  useEffect(() => {
    if (didAutoLoadRef.current) return;
    if (!presetsReady) return;                 // wait for manifest to resolve
    if (presetSongs.length === 0) return;
    didAutoLoadRef.current = true;

    let target = presetSongs[0];
    try {
      const raw = localStorage.getItem('lightflow:lastSong');
      if (raw) {
        const saved = JSON.parse(raw) as { slug?: string };
        const match = saved.slug && presetSongs.find(p => p.slug === saved.slug);
        if (match) target = match;
      }
    } catch {
      // ignore corrupted storage
    }

    loadPreset(target.slug, target.name, target.ext ?? '.mp3');
  }, [loadPreset, presetSongs, presetsReady]);

  // Energy waveform across the entire song, downsampled to fixed bar count
  const energyBars = useMemo(() => {
    if (!analysis?.frames.length) return null;
    const N_BARS = 400;
    const bars = new Float32Array(N_BARS);
    const frames = analysis.frames;
    const totalFrames = frames.length;
    for (let b = 0; b < N_BARS; b++) {
      const lo = Math.floor((b / N_BARS) * totalFrames);
      const hi = Math.floor(((b + 1) / N_BARS) * totalFrames);
      let sum = 0, n = 0;
      for (let i = lo; i < hi; i++) {
        const s = frames[i].stems as unknown as Record<string, number>;
        sum += (s.bass ?? 0) + (s.kick ?? 0) + (s.snare ?? 0) + (s.hat ?? 0) + (s.other ?? 0);
        n++;
      }
      bars[b] = n > 0 ? sum / n : 0;
    }
    // Normalize 0-1
    let max = 0;
    for (let i = 0; i < N_BARS; i++) if (bars[i] > max) max = bars[i];
    if (max > 0) for (let i = 0; i < N_BARS; i++) bars[i] = bars[i] / max;
    return bars;
  }, [analysis]);

  // Per-song + per-section normalization refs. Maps each stem's 99th
  // percentile energy to ~0.85 brightness so real peaks hit near-max
  // without sustained clipping. Earlier p90/0.9 combo clipped the top
  // 10% of frames which showed as 5+ seconds of pure white on drops.
  //
  // p99 captures the genuine song peaks. Combined with a soft-knee
  // above 0.9 (applied at render time) this gives: quiet songs brighten
  // up appropriately, loud songs don't over-compress, and nothing
  // hard-clips.
  const normRefs = useMemo(() => {
    if (!analysis?.frames.length) return null;
    const frames = analysis.frames;
    const sections = analysis.sections ?? [];

    const pctl = (vals: number[], p: number): number => {
      if (vals.length === 0) return 0;
      const sorted = vals.slice().sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    };
    const stemVals = (stem: string, slice: typeof frames) =>
      slice.map(f => (f.stems as unknown as Record<string, number>)[stem] ?? 0);

    const song = {
      bass:  Math.max(0.2, pctl(stemVals('bass', frames), 0.99)),
      snare: Math.max(0.2, pctl(stemVals('snare', frames), 0.99)),
      other: Math.max(0.2, pctl(stemVals('other', frames), 0.99)),
      kick:  Math.max(0.2, pctl(stemVals('kick', frames), 0.99)),
    };

    const perSection = sections.map(sec => {
      const slice = frames.filter(f => f.time >= sec.start && f.time < sec.end);
      return {
        start: sec.start,
        end: sec.end,
        bass:  Math.max(0.2, pctl(stemVals('bass',  slice), 0.99)),
        snare: Math.max(0.2, pctl(stemVals('snare', slice), 0.99)),
        other: Math.max(0.2, pctl(stemVals('other', slice), 0.99)),
        kick:  Math.max(0.2, pctl(stemVals('kick',  slice), 0.99)),
      };
    });

    return { song, perSection };
  }, [analysis]);

  // Soft-knee ceiling: below 0.9, passthrough. Above 0.9, asymptotic
  // approach toward 1.0 so nothing hard-clips. Keeps the top of the
  // dynamic range intact instead of a flat-white plateau.
  const softCeil = (x: number): number => {
    if (x <= 0.9) return x;
    // Map (0.9, ∞) → (0.9, 1.0) with exponential decay in the headroom
    return 0.9 + 0.1 * (1 - Math.exp(-(x - 0.9) * 4));
  };

  // Look up the normalization reference for a stem at a given time.
  // Blends section-specific (60%) with song-wide (40%) to soften jumps
  // at section boundaries.
  const getNormRef = useCallback((stem: 'bass' | 'snare' | 'other' | 'kick', t: number): number => {
    if (!normRefs) return 0.5;
    const sec = normRefs.perSection.find(s => t >= s.start && t < s.end);
    if (!sec) return normRefs.song[stem];
    return 0.6 * sec[stem] + 0.4 * normRefs.song[stem];
  }, [normRefs]);

  // Dismiss settings popover on outside click
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    // Defer to avoid catching the same click that opened it
    const id = setTimeout(() => document.addEventListener('pointerdown', handler), 0);
    return () => { clearTimeout(id); document.removeEventListener('pointerdown', handler); };
  }, [settingsOpen]);

  // Scrubber pointer handling
  const scrubRef = useRef<HTMLDivElement>(null);
  const scrubFromEvent = useCallback((clientX: number) => {
    const el = scrubRef.current;
    if (!el || !audioState.duration) return;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * audioState.duration;
    seek(t);
  }, [audioState.duration, seek]);

  // Find nearest analysis frame (with look-ahead to compensate for output delay)
  const currentFrame = useMemo((): StemFrame | null => {
    if (!analysis?.frames.length) return null;
    const t = audioState.currentTime + lookAhead;
    let lo = 0, hi = analysis.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (analysis.frames[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return analysis.frames[lo] || null;
  }, [analysis, audioState.currentTime, lookAhead]);

  // Core signal computation
  useEffect(() => {
    if (!currentFrame || !analysis || !audioState.isPlaying) return;
    // Skip the render loop while the song menu is open so hover
    // transitions don't fight the per-frame state churn.
    if (songMenuOpen) return;

    const now = performance.now();
    const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.1);
    lastFrameTimeRef.current = now;

    const stems = currentFrame.stems as unknown as Record<string, number>;

    if (soloStem) {
      // Solo mode: just show that stem raw
      setSignal(Math.min(1.0, (stems[soloStem] ?? 0) * 1.5));
      setDominantStem(soloStem);
      return;
    }

    const attention = computeAttention(currentFrame, dt, analysis.bpm);
    setDominantStem(attention.dominant);

    // ----------------------------------------------------------------
    // Signal source: attention layer picks the dominant stem live.
    // Scout annotations can override stem focus per section.
    // ----------------------------------------------------------------
    const activeBlocks = programBlocks;

    let scoutFocusStem: string | null = null;
    let scoutStemSignal: number | null = null;
    if (scout) {
      const sIdx = analysis.sections.findIndex(s => s.start <= audioState.currentTime && s.end > audioState.currentTime);
      const ann = sIdx >= 0 ? getSectionAnnotation(scout.sections, sIdx) : null;
      if (ann?.stemFocus) {
        const stemKey = ann.stemFocus === 'vocals' ? 'other' : ann.stemFocus;
        const raw = stems[stemKey] ?? 0;
        scoutStemSignal = Math.max(0, Math.min(1, raw * 1.6));
        scoutFocusStem = ann.stemFocus;
      }

    }

    // v1.4: stem entry detection — lock to newly entered stems (deterministic, no scout needed)
    if (!scoutFocusStem && stemEntries.length > 0) {
      const beatSec = 60 / analysis.bpm;
      const t = audioState.currentTime;
      for (const entry of stemEntries) {
        const start = entry.t;
        const end = entry.t + entry.durationBeats * beatSec;
        if (t >= start && t < end) {
          const stemKey = entry.stem === 'vocals' ? 'other' : entry.stem;
          const raw = stems[stemKey] ?? 0;
          if (raw > 0.1) {
            scoutStemSignal = Math.max(0, Math.min(1, raw * 1.6));
            scoutFocusStem = entry.stem;
          }
          break;
        }
      }
    }

    // v1.4: blend energy derivative into signal — transient attacks punch through
    const derivativeBoost = attention.dEnergy * 0.5;
    const attentionSignal = Math.min(1.0, attention.signal + derivativeBoost);
    const baseSignal = scoutStemSignal ?? attentionSignal;
    const dominantForCtx = scoutFocusStem ?? attention.dominant;

    // Apply selected modulator on top of the resolved signal
    const curSection = analysis.sections.find(s => s.start <= audioState.currentTime && s.end > audioState.currentTime);
    const curSectionIdx = curSection ? analysis.sections.indexOf(curSection) : -1;
    const rawStems = currentFrame.stems as unknown as Record<string, number>;

    // Resolve scout hints for this frame
    const scoutMoment = scout
      ? getActiveMoment(scout.moments, audioState.currentTime, analysis.bpm)
      : null;
    const scoutSection = scout && curSectionIdx >= 0
      ? getSectionAnnotation(scout.sections, curSectionIdx)
      : null;

    // If the director requests raw stem energy, bypass the attention layer's
    // envelope shaping and use the stem's natural dynamics directly.
    const directorWantsRaw = getDirectorUseRaw();
    let resolvedSignal = directorWantsRaw && dominantForCtx
      ? Math.min(1.0, (rawStems[dominantForCtx] ?? 0) * 1.5)
      : baseSignal;

    // Per-song + per-section normalization: map the dominant stem's
    // 99th percentile to ~0.85 brightness, with a soft-knee above 0.9
    // so nothing hard-clips during drops.
    if (
      dominantForCtx === 'bass' ||
      dominantForCtx === 'snare' ||
      dominantForCtx === 'other' ||
      dominantForCtx === 'kick'
    ) {
      const ref = getNormRef(dominantForCtx, audioState.currentTime);
      const TARGET = 0.85;
      resolvedSignal = softCeil(resolvedSignal * (TARGET / ref));
    }

    const modCtx = {
      signal: resolvedSignal,
      time: audioState.currentTime,
      ...beatPhases(audioState.currentTime, analysis.bpm, beatOffset),
      bpm: analysis.bpm,
      dt,
      dominantStem: dominantForCtx,
      centroid: currentFrame.centroid,
      sectionLabel: curSection?.label,
      rawStems,
      scoutMoment: scoutMoment ? {
        type: scoutMoment.type,
        anticipating: isAnticipating(scoutMoment, audioState.currentTime, analysis.bpm),
        intensity: scoutMoment.intensity,
      } : null,
      scoutSection: scoutSection ? {
        signalMode: scoutSection.signalMode,
        modulatorHint: scoutSection.modulatorHint,
        suppressEscalation: scoutSection.suppressEscalation,
      } : null,
    };

    let activeMod = modulator;
    let directorRate = 0;
    let sectionIntensityScale = scoutSection?.intensityScale ?? 1;
    if (modulator === 'director') {
      const t = audioState.currentTime;
      const fxBlock = activeBlocks.find(b => b.lane.startsWith('fx:') && b.start <= t && b.end > t);
      activeMod = fxBlock ? fxBlock.lane.slice(3) : 'raw';
      directorRate = fxBlock?.rate ?? 0;
    }
    let modulated: number;
    // v1.5 effects killswitch: short-circuit the pulse path from
    // precomputed programBlocks (they were built before the killswitch
    // flipped). Ordinary modulator calls route through MODULATORS which
    // are already wrapped in modulators.ts.
    const effectsKillswitch = true;
    if (!effectsKillswitch && modulator === 'director' && directorRate > 0) {
      modulated = Math.max(0, Math.min(1, pulseAtBeatRate(modCtx, directorRate)));
    } else {
      const modFn = MODULATORS[activeMod]?.fn ?? MODULATORS.raw.fn;
      modulated = Math.max(0, Math.min(1, modFn(modCtx)));
    }
    // Apply scout's per-section intensity scale
    if (sectionIntensityScale !== 1) {
      modulated = Math.max(0, Math.min(1, modulated * sectionIntensityScale));
    }
    if (scoutFocusStem) {
      setDominantStem(scoutFocusStem);
    }

    // MIDI overrides (show recorder).
    //   STROBE pad held → hard-pulse at STROBE RATE, replaces engine signal.
    //   PULSE pad tapped → velocity-sensitive single-shot envelope sized
    //                      by PULSE LENGTH (beats). Max'd onto the signal.
    //   BLACKOUT pad held → force signal to 0.
    //   FADE fader → global multiplier (applied last).
    // Priority: blackout > strobe > pulse overlay > engine > fade.
    if (midi.strobeHeld && !midi.blackoutHeld) {
      modulated = pulseAtBeatRate(modCtx, midi.strobeRate);
    }
    // PULSE envelope. Shape: half-sine over the captured duration so
    // both attack and release scale with length (1/16 beat = fast
    // blip, 4 beats = slow swell).
    const beatSec = 60 / analysis.bpm;
    const pulseDurMs = midi.lastPulseLengthBeats * beatSec * 1000;
    const pulseAge = performance.now() - midi.lastPulseAt;
    if (pulseAge >= 0 && pulseAge < pulseDurMs && pulseDurMs > 0) {
      const t = pulseAge / pulseDurMs;
      const env = Math.sin(Math.PI * t); // 0 → 1 at t=0.5 → 0
      const pulseValue = env * midi.pulseVelocity;
      modulated = Math.max(modulated, pulseValue);
    }
    if (midi.blackoutHeld) {
      modulated = 0;
    }
    if (midi.fade < 1) {
      modulated = modulated * midi.fade;
    }

    setSignal(modulated);
    // DMX out (Halo 100x, CCT 3ch @ addr 1): dim × master, cct from warmth, g/m neutral
    sendDMX([
      Math.round(modulated * dmxBrightness * 255),
      Math.round(dmxWarmth * 255),
      128,
    ]);
    setActiveScoutCue(scoutMoment ? `${scoutMoment.type}${isAnticipating(scoutMoment, audioState.currentTime, analysis.bpm) ? '…' : ''}` : null);
    const fxNow = activeMod;
    if (modulator === 'director') {
      setDirectorChoice(fxNow);
      setDirectorLabel(getDirectorChoiceLabel());
    }

    // (Program timeline is precomputed at song load — no per-frame recording.)

    // Spatial layer (Tube Test mode)
    setAccent(attention.accent);
    setAccentStem(attention.accentStem);
    // Plane/3D wants raw continuous stem energy, not the gated triggered
     // envelopes from Channel 1 (those drop out between triggers and look
     // like interruptions during strong sections).
    setStemSignals({
      kick:  Math.min(1, (stems.kick  ?? 0) * 1.2),
      bass:  Math.min(1, (stems.bass  ?? 0) * 1.2),
      snare: Math.min(1, (stems.snare ?? 0) * 1.2),
      hat:   Math.min(1, (stems.hat   ?? 0) * 1.2),
      other: Math.min(1, (stems.other ?? 0) * 1.2),
    });
    // Multi-channel view packs the mix into 3 frequency bands.
    //   LOW  = bass ∪ kick — whichever carries the low end for this song
    //          (baby_again-style tracks have kick-driven low, not bass)
    //   MID  = snare ∪ other — body of the arrangement
    //   HIGH = hat (strobe-style, no smoothing)
    // Each band uses its own per-song/per-section normalization so the
    // same song reads the same visual intensity regardless of mix level.
    const rawHat = stems.hat ?? 0;
    const rawSnare = stems.snare ?? 0;
    const hatOnset = (currentFrame.onsets as unknown as Record<string, number>).hat ?? 0;
    const snareOnset = (currentFrame.onsets as unknown as Record<string, number>).snare ?? 0;

    // Record snare hits for the temporal suppression window.
    if (snareOnset > 0.3 || rawSnare > 0.5) {
      lastSnareHitRef.current = audioState.currentTime;
    }

    // Demucs bleed correction: snare noise tails leak into the hat stem.
    // Four-layer defense:
    //   1. Temporal gate — hard-suppress hat for 150ms after any strong
    //      snare hit. This is the main fix; subtraction alone can't kill
    //      the delayed tail bleed.
    //   2. Subtract weighted snare from raw hat energy (continuous bleed)
    //   3. Penalize hat onset when it coincides with a stronger snare onset
    //   4. Ratio check — if hat energy isn't meaningfully above snare,
    //      it's almost certainly bleed; suppress.
    const timeSinceSnare = audioState.currentTime - lastSnareHitRef.current;
    const BLEED_WINDOW = 0.15; // seconds
    // Suppression: 1.0 at t=0 → 0.0 at t=BLEED_WINDOW
    const snareSuppress = timeSinceSnare < BLEED_WINDOW
      ? Math.max(0, 1 - timeSinceSnare / BLEED_WINDOW)
      : 0;

    // Ratio check: true hats are much louder than concurrent snare in
    // a clean separation. If hat < 1.2× snare, most of hat is bleed.
    const ratioOk = rawSnare < 0.1 || rawHat > rawSnare * 1.2;

    const hatBleedSub = Math.max(0, rawHat - rawSnare * 0.75);
    const hatOnsetClean = snareOnset > hatOnset * 0.5
      ? Math.max(0, hatOnset - snareOnset * 0.85)
      : hatOnset;
    const hatSuppressMul = 1 - snareSuppress * 0.92; // at snare hit, 92% off
    const hatRatioMul = ratioOk ? 1 : 0.15;
    const hatStrobe = Math.min(
      1,
      Math.max(hatBleedSub * 1.5, hatOnsetClean * 2.2) * hatSuppressMul * hatRatioMul,
    );
    const TARGET = 0.85;
    const tNow = audioState.currentTime;
    const norm = (value: number, stem: 'bass' | 'snare' | 'other' | 'kick') =>
      softCeil(value * (TARGET / getNormRef(stem, tNow)));

    const bassSmooth  = attention.stemSignals?.bass  ?? 0;
    const kickSmooth  = attention.stemSignals?.kick  ?? 0;
    const snareSmooth = attention.stemSignals?.snare ?? 0;
    const otherSmooth = attention.stemSignals?.other ?? 0;

    // LOW band: max of normalized bass and kick. Either can fill the
    // channel. On bass-driven tracks bass wins; on kick-driven tracks
    // (like baby_again with 85% of frames at near-zero bass) kick wins.
    const lowRaw = Math.max(norm(bassSmooth, 'bass'), norm(kickSmooth, 'kick'));

    // Perceptual-decay helper.
    // Trap / sub-bass tracks have 800ms-long 808 tails that measure as
    // high energy long after the listener has perceptually moved on
    // from the hit. The ear locks to the transient attack and releases
    // within 150-250ms regardless of the physical envelope. We model
    // that by committing to a fast exponential decay curve from the
    // attack peak, and displaying min(raw, curve) so tails can't drag
    // the panel bright longer than the ear expects.
    //
    // Same treatment applied to all three bands with band-appropriate
    // time constants (bass slowest, hat fastest).
    const songTime = audioState.currentTime;
    const ATTACK_JUMP = 0.15;
    const perceptualDecay = (
      raw: number,
      state: { time: number; peak: number; prev: number },
      tau: number,
    ): number => {
      const curveVal = state.peak * Math.exp(-(songTime - state.time) / tau);
      const isAttack = raw > curveVal + ATTACK_JUMP && raw > state.prev + ATTACK_JUMP * 0.5;
      if (isAttack) {
        state.time = songTime;
        state.peak = raw;
      }
      state.prev = raw;
      const curveNow = state.peak * Math.exp(-(songTime - state.time) / tau);
      return Math.min(raw, Math.max(curveNow, 0));
    };

    const lowBand = perceptualDecay(lowRaw, lowDecayRef.current, 0.22);

    // Snare sustain — exponential decay with ~400ms half-life. Retriggers
    // to 1.0 on every snare hit. Keeps the mid panel glowing between
    // sparse snare strikes instead of flashing and going dark.
    if (snareOnset > 0.2 || rawSnare > 0.3) {
      snareSustainRef.current = 1;
    }
    if (dt > 0) {
      snareSustainRef.current *= Math.pow(0.5, dt / 0.4);
    }
    // MID band: max of normalized snare (fast-decay), sustained snare
    // envelope (fills gaps), and "other" at full weight. Whichever is
    // loudest drives the panel. Perceptual decay at 0.25s — slightly
    // slower than bass because snare tails feel slightly longer
    // perceptually (noise-shaped vs. tonal).
    const midRaw = Math.max(
      norm(snareSmooth, 'snare'),
      snareSustainRef.current * 0.6,
      norm(otherSmooth, 'other'),
    );
    const midBand = perceptualDecay(midRaw, midDecayRef.current, 0.25);

    // HIGH band: hat with a short perceptual tau so strobe pulses
    // still read crisp but lingering tails (especially post-bleed-
    // filter residue) are cut short.
    const highBand = perceptualDecay(hatStrobe, highDecayRef.current, 0.10);

    setSmoothStems({
      bass:   lowBand,
      kick:   norm(kickSmooth, 'kick'),
      snare:  midBand,
      hat:    highBand,
      other:  norm(otherSmooth, 'other'),
      vocals: (stems.vocals ?? 0),
    });
    // Pass through pan data — we have bass, vocals, other; default 0 for others
    const pans = currentFrame.pans as unknown as Record<string, number>;
    setStemPans({
      bass: pans.bass ?? 0,
      kick: 0,
      snare: 0,
      hat: 0,
      other: pans.other ?? 0,
    });
    setStemNovelty(attention.novelty);

    setDebugInfo({
      hold: attention.holdBeats,
      held: attention.beatsHeld,
      energy: attention.overallEnergy,
    });
    setStemLevels({
      bass: stems.bass,
      kick: stems.kick,
      snare: stems.snare,
      hat: stems.hat,
      other: stems.other,
    });
    setStemScores(attention.scores);
  }, [currentFrame, analysis, audioState.currentTime, audioState.isPlaying, soloStem, modulator, scout, programBlocks, songMenuOpen, midi.strobeHeld, midi.blackoutHeld, midi.strobeRate, midi.fade, midi.lastPulseAt, midi.pulseVelocity, midi.lastPulseLengthBeats, dmxBrightness, dmxWarmth]);

  const isReady = !!audioState.source;
  const isRawMode = isReady && !analysis;

  // Format time
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div
      className="h-[100dvh] flex flex-col text-white overflow-hidden"
      style={{
        backgroundColor: isReady && signalOn && !multiOn
          ? `rgb(${Math.round(signal * 255)}, ${Math.round(signal * 255)}, ${Math.round(signal * 255)})`
          : '#000',
      }}
    >
      {isReady && (
        <>
          {/* Toast */}
          {toast && (
            <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-neutral-900/95 border border-white/15 text-white/90 text-xs font-medium shadow-2xl backdrop-blur pointer-events-none">
              {toast}
            </div>
          )}

          {/* Song sidebar */}
          {songMenuOpen && (
            <div
              className="fixed inset-0 z-30 flex pt-12"
              onClick={() => setSongMenuOpen(false)}
            >
              <div
                className="w-[88vw] max-w-96 md:w-96 ml-3 mb-3 rounded-xl bg-black/40 backdrop-blur-xl border border-white/10 shadow-2xl py-3 overflow-hidden flex flex-col max-h-[calc(100vh-5rem)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 pb-2 mb-1 border-b border-white/10 shrink-0">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50 font-semibold">
                    Songs <span className="text-white/30 normal-case tracking-normal">· {presetSongs.length}</span>
                  </div>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full border border-cyan-800 bg-cyan-950 text-cyan-300 font-mono"
                    title="Current Director algorithm version"
                  >
                    {DIRECTOR_VERSION}
                  </span>
                </div>
                <div className="px-3 pb-2 shrink-0">
                  <input
                    type="text"
                    value={songFilter}
                    onChange={(e) => setSongFilter(e.target.value)}
                    placeholder="filter…"
                    className="w-full px-3 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
                    autoFocus
                  />
                </div>
                <div className="overflow-y-auto flex-1 min-h-0">
                {presetSongs
                  .filter(s => !songFilter || s.name.toLowerCase().includes(songFilter.toLowerCase()))
                  .map((song) => {
                  const isCurrent = songName === song.name;
                  const hasShow = recordedSlugs.has(song.slug);
                  const dur = songDurations[song.slug];
                  return (
                    <button
                      key={song.slug}
                      onClick={() => { loadPreset(song.slug, song.name, song.ext ?? '.mp3'); setSongMenuOpen(false); }}
                      disabled={isLoading}
                      className={`w-full flex items-center gap-3 px-4 py-1.5 text-sm ${
                        isCurrent
                          ? 'text-white'
                          : 'text-white/55 hover:text-white'
                      }`}
                    >
                      {/* Recording indicator dot. Red when a saved show
                          exists for this song; hollow otherwise. */}
                      <span
                        className={`shrink-0 w-1.5 h-1.5 rounded-full ${
                          hasShow
                            ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                            : 'bg-transparent'
                        }`}
                        title={hasShow ? 'Has a recorded show' : ''}
                      />
                      <span className="truncate font-medium text-left flex-1">{song.name}</span>
                      <span className="text-[10px] font-mono text-white/40 shrink-0">
                        {dur != null ? fmt(dur) : '—'}
                      </span>
                    </button>
                  );
                })}
                {customSongs.length > 0 && (
                  <>
                    <div className="px-4 pt-3 pb-1 text-[10px] uppercase tracking-[0.2em] text-white/35 font-semibold">Custom · Raw mode</div>
                    {customSongs.map(song => {
                      const display = song.name.replace(/\.[^.]+$/, '');
                      const isCurrent = songName === display;
                      return (
                        <button
                          key={song.name}
                          onClick={() => { loadCustomFile(song.file); setSongMenuOpen(false); }}
                          disabled={isLoading}
                          className={`w-full flex items-center justify-between gap-3 px-4 py-1.5 text-sm ${
                            isCurrent ? 'text-white' : 'text-white/55 hover:text-white'
                          }`}
                        >
                          <span className="truncate font-medium text-left">{display}</span>
                          <span className="text-[10px] font-mono text-white/40 shrink-0">RAW</span>
                        </button>
                      );
                    })}
                  </>
                )}
                {isLoading && (
                  <div className="flex items-center justify-center gap-2 text-white/40 text-xs pt-3">
                    <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    Loading…
                  </div>
                )}
                </div>
                {/* Compact drop zone — single row, not full-height */}
                <label
                  htmlFor="custom-audio-input"
                  className="shrink-0 mx-3 mt-2 mb-3 rounded-lg border border-dashed border-white/15 hover:border-white/40 hover:bg-white/[0.03] transition-colors flex items-center gap-3 cursor-pointer px-3 py-2"
                >
                  <div className="w-7 h-7 rounded-full bg-white/5 border border-white/15 flex items-center justify-center shrink-0">
                    <Copy size={12} className="text-white/60" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white/80">Drop audio file</div>
                    <div className="text-[10px] text-white/40 truncate">or click to browse · plays in raw mode</div>
                  </div>
                </label>
                <input
                  id="custom-audio-input"
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { loadCustomFile(f); setSongMenuOpen(false); }
                  }}
                />
              </div>
            </div>
          )}
          {/* Drop hint overlay */}
          {isDragOver && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur pointer-events-none">
              <div className="px-8 py-6 rounded-2xl border-2 border-dashed border-white/40 bg-black/40 text-white/90 text-lg font-medium">
                Drop audio file to play
              </div>
            </div>
          )}

          {/* Spectro layer — full screen 3D scene */}
          {spectroOn && (() => {
            // 3-peak Three.js plane — low (bass+kick) peak at the front,
            // mid (snare+other) back-right, high (hat) back-left. Driven
            // by the same normalized bands the multi-view uses so both
            // visualizations agree on the signal. Pure black backdrop;
            // no fog, no flash overlay.
            const low  = smoothStems.bass  ?? 0;
            const mid  = smoothStems.snare ?? 0;
            const high = smoothStems.hat   ?? 0;
            return (
              <div className="fixed inset-0 z-0 bg-black">
                <Screen3D low={low} mid={mid} high={high} />
              </div>
            );
          })()}

          {!uiHidden && (
          <>
          {/* Top bar */}
          <div className="px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 shrink-0 flex items-center gap-2 z-10 relative">
            <button
              onClick={() => setSongMenuOpen(v => !v)}
              className="flex items-center gap-2 px-3 py-2 md:py-1.5 rounded-full bg-black/40 hover:bg-black/60 active:bg-black/70 text-white border border-white/10 shrink-0 min-w-0 max-w-[70vw] md:max-w-none"
              title="Browse songs (⌘←)"
            >
              <Menu size={14} className="opacity-70 shrink-0" />
              <h1 className="text-sm font-medium truncate">
                {songName}
                {analyzingStatus && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-cyan-400 font-mono animate-pulse">
                    {analyzingStatus}
                  </span>
                )}
              </h1>
              <span
                className="hidden md:inline text-[9px] px-1.5 py-0.5 rounded-full border border-cyan-800 bg-cyan-950 text-cyan-300 font-mono shrink-0"
                title="Director algo version"
              >
                {DIRECTOR_VERSION}
              </span>
            </button>
            <div className="flex-1" />
            {/* Scout UI hidden on show-recorder branch — focus is on MIDI input */}
            <div className="hidden md:flex items-center gap-3 shrink-0 font-mono">
              <span className="text-[10px] text-white/50">
                {dominantStem} · {(signal * 100).toFixed(0)}% · hold {debugInfo.held.toFixed(1)}/{debugInfo.hold}b · e{(debugInfo.energy * 100).toFixed(0)}
              </span>
              <span className="text-[10px] text-white/50">
                {analysis ? `${analysis.bpm?.toFixed(0)} BPM` : 'RAW'}
              </span>
            </div>
          </div>

          <div className="flex-1 relative">
            {/* Multi-channel: 3 stacked horizontal panels, each a
                black→white brightness driven by one stem's smoothed
                envelope. Covers the full content area when active. */}
            {multiOn && (() => {
              const CHANNELS: Array<{ stem: keyof typeof smoothStems; label: string }> = [
                { stem: 'hat',   label: 'HIGH · HAT'         },
                { stem: 'snare', label: 'MID · SNARE+BODY'   },
                { stem: 'bass',  label: 'LOW · BASS+KICK'    },
              ];
              return (
                <div className="absolute inset-0 flex flex-col bg-black z-10">
                  {CHANNELS.map(({ stem, label }) => {
                    const v = Math.max(0, Math.min(1, smoothStems[stem] ?? 0));
                    const level = Math.round(v * 255);
                    return (
                      <div
                        key={stem}
                        className="flex-1 flex items-end justify-start px-4 pb-2"
                        style={{ backgroundColor: `rgb(${level}, ${level}, ${level})` }}
                      >
                        <span
                          className="text-[10px] font-mono uppercase tracking-[0.2em] pointer-events-none"
                          style={{ color: v > 0.5 ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)' }}
                        >
                          {label} · {(v * 100).toFixed(0)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            {signalOn && !spectroOn && !multiOn && (
              <div className="absolute bottom-0 left-0 right-0 h-1/4 opacity-20 pointer-events-none">
                <SignalGraph signal={signal} dominant={dominantStem} time={audioState.currentTime} />
              </div>
            )}
            {false && !spectroOn && audioState.duration > 0 && (() => {
              const STEM_LANES = STEMS.map(s => ({ key: 'stem:' + s, label: s.toUpperCase(), color: STEM_COLOR_RGB[s] }));
              const FX_LANES = [
                { key: 'fx:raw',          label: 'RAW',      color: '#67e8f9' }, // cyan-300
                { key: 'fx:beatStrobe',   label: 'PULSE·F',  color: '#22d3ee' }, // cyan-400 (fast pulse ≥6/beat)
                { key: 'fx:halfBarPulse', label: 'PULSE',    color: '#06b6d4' }, // cyan-500
                { key: 'fx:blackout',     label: 'BLACKOUT', color: '#155e75' }, // cyan-800
              ];
              const GROUPS = [
                { name: 'Stems',   lanes: STEM_LANES },
                { name: 'Effects', lanes: FX_LANES },
              ];
              const LANES = [...STEM_LANES, ...FX_LANES];
              const dur = audioState.duration;
              const ROW_H = 16;
              const LABEL_W = 70;
              const liveBlocks: Block[] = programBlocks;
              return (
                <div className="absolute top-2 left-2 right-2 rounded-md border border-white/10 bg-black/30 backdrop-blur-sm p-2">
                  <div className="text-[9px] uppercase tracking-[0.2em] text-white/40 font-semibold mb-1.5">Program Focus Timeline</div>
                  <div className="space-y-2">
                    {GROUPS.map(group => (
                      <div key={group.name}>
                        <div className="text-[9px] uppercase tracking-[0.15em] text-white/35 font-semibold mb-1 pl-1">
                          {group.name}
                        </div>
                        <div className="flex">
                          <div className="shrink-0" style={{ width: LABEL_W }}>
                            {group.lanes.map(lane => (
                              <div key={lane.key} className="text-[9px] font-mono text-white/45 pr-2 text-right" style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}>
                                {lane.label}
                              </div>
                            ))}
                          </div>
                          <div className="relative flex-1" style={{ height: group.lanes.length * ROW_H }}>
                            {group.lanes.map((lane, i) => (
                              <div key={lane.key} className="absolute left-0 right-0 flex items-center" style={{ top: i * ROW_H, height: ROW_H }}>
                                <div className="relative w-full h-[10px] bg-white/[0.06] rounded-sm overflow-hidden">
                                  {liveBlocks.filter(b => b.lane === lane.key).map((b, j) => {
                                    const left = (b.start / dur) * 100;
                                    const width = Math.max(0.2, ((b.end - b.start) / dur) * 100);
                                    return (
                                      <div
                                        key={j}
                                        className="absolute inset-y-0"
                                        style={{ left: `${left}%`, width: `${width}%`, backgroundColor: lane.color, opacity: 0.45 }}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                            {/* Playhead spanning this group */}
                            <div
                              className="absolute top-0 bottom-0 w-px bg-cyan-300/60 pointer-events-none"
                              style={{ left: `${(audioState.currentTime / dur) * 100}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Independent layer toggles */}
          <div className="px-3 pt-2 pb-2 shrink-0 relative z-10 flex flex-wrap md:flex-nowrap items-center justify-between gap-2">
            <button
              onClick={audioState.isPlaying ? pause : play}
              className="px-3 md:px-4 py-2 md:py-1.5 min-h-9 md:min-h-0 rounded-full whitespace-nowrap border border-white/30 bg-white/10 hover:bg-white/15 active:bg-white/20 text-white font-semibold transition-colors flex items-center gap-2 shrink-0"
            >
              <span className="text-lg leading-none">{audioState.isPlaying ? '⏸' : '▶'}</span>
              <span className="hidden md:inline text-[10px] uppercase tracking-widest opacity-60">Space</span>
            </button>
            <button
              onClick={() => setSpectroOn(v => { const next = !v; if (next) setMultiOn(false); return next; })}
              className={`h-9 px-3 flex items-center justify-center rounded-full border text-[11px] font-mono uppercase tracking-widest shrink-0 transition-colors ${
                spectroOn ? 'bg-white text-black border-white' : 'bg-black/40 hover:bg-black/60 text-white/70 hover:text-white border-white/10'
              }`}
              title={spectroOn ? 'Screen: 3D scene — click for flat full-screen light (Z)' : 'Screen: flat full-screen light — click for 3D scene (Z)'}
            >
              {spectroOn ? '3D' : 'Flat'}
            </button>
            <button
              onClick={() => setUiHidden(true)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/70 text-white/70 hover:text-white border border-white/10 shrink-0"
              title="Hide controls"
            >
              <EyeOff size={14} />
            </button>
            {/* Settings (far right) */}
            <div className="relative shrink-0" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen(v => !v)}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/70 text-white/70 hover:text-white border border-white/10"
                title="Settings"
              >
                <Settings size={14} />
              </button>
              {settingsOpen && (
                <div className="absolute bottom-full right-0 mb-3 w-[90vw] max-w-80 md:w-80 p-5 rounded-xl border border-white/20 bg-neutral-950/95 backdrop-blur space-y-5 shadow-2xl z-50">
                  <div className="text-xs uppercase tracking-[0.2em] text-white/50 font-semibold pb-1 border-b border-white/10">
                    Settings
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs uppercase tracking-wider text-white/80 font-medium">Lead time</label>
                      <span className="text-sm font-mono text-white">{(lookAhead * 1000).toFixed(0)}ms</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.08}
                      step={0.002}
                      value={lookAhead}
                      onChange={(e) => setLookAhead(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                    <p className="text-[10px] text-white/40 leading-snug">
                      Compensates for output latency. Increase if visuals lag the audio.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs uppercase tracking-wider text-white/80 font-medium">DMX brightness</label>
                      <span className="text-sm font-mono text-white">{Math.round(dmxBrightness * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={dmxBrightness}
                      onChange={(e) => setDmxBrightness(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                    <p className="text-[10px] text-white/40 leading-snug">
                      Master multiplier on Halo dimmer (channel 1).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between items-baseline">
                      <label className="text-xs uppercase tracking-wider text-white/80 font-medium">Warmth</label>
                      <span className="text-sm font-mono text-white">{dmxWarmth < 0.5 ? 'warm' : dmxWarmth > 0.5 ? 'cool' : 'mid'}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={dmxWarmth}
                      onChange={(e) => setDmxWarmth(parseFloat(e.target.value))}
                      className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                    />
                    <p className="text-[10px] text-white/40 leading-snug">
                      Halo CCT (channel 2). 0 = warm (~2500K), 1 = cool (~10000K).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wider text-white/80 font-medium block">Keyboard mapping</label>
                    <div className="flex gap-2">
                      {([
                        { key: 'basic', label: 'Basic',     hint: '1–5' },
                        { key: 'pro',   label: 'Pro',       hint: 'ASDF · HJKL;' },
                      ] as const).map(opt => (
                        <button
                          key={opt.key}
                          onClick={() => setKeyMap(opt.key)}
                          className={`flex-1 px-3 py-2.5 rounded-lg border transition-colors text-left ${
                            keyMap === opt.key
                              ? 'bg-white/10 text-white border-white/60'
                              : 'bg-black/40 text-white/50 border-white/10 hover:bg-black/60 hover:text-white/80'
                          }`}
                        >
                          <div className="text-sm font-medium">{opt.label}</div>
                          <div className="text-[10px] font-mono opacity-70 mt-0.5">{opt.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom: simplified scrubber — waveform + playhead only */}
          <div className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0 relative z-10">
            <div
              ref={scrubRef}
              className="relative w-full bg-black/20 rounded-md overflow-hidden cursor-pointer select-none"
              style={{ height: 70 }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                scrubFromEvent(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) scrubFromEvent(e.clientX);
              }}
            >
              {energyBars && (
                <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox={`0 0 ${energyBars.length} 100`}>
                  {Array.from(energyBars).map((v, i) => {
                    const h = v * 100;
                    return (
                      <rect
                        key={i}
                        x={i + 0.1}
                        y={50 - h / 2}
                        width={0.8}
                        height={h}
                        fill="rgba(255,255,255,0.18)"
                      />
                    );
                  })}
                </svg>
              )}
              {/* Played-portion overlay */}
              <div
                className="absolute inset-y-0 left-0 bg-orange-200/[0.07] pointer-events-none"
                style={{ width: `${audioState.duration ? (audioState.currentTime / audioState.duration) * 100 : 0}%` }}
              />
              {/* Playhead */}
              <div
                className="absolute inset-y-0 w-px bg-orange-400 shadow-[0_0_6px_rgba(251,146,60,0.9)] pointer-events-none"
                style={{ left: `${audioState.duration ? (audioState.currentTime / audioState.duration) * 100 : 0}%` }}
              />
              <span className="absolute top-1.5 left-2 text-[10px] text-white/70 font-mono pointer-events-none z-10">
                {fmt(audioState.currentTime)} / {fmt(audioState.duration)}
              </span>
            </div>
          </div>
          </>
          )}
        </>
      )}
      <MidiPanel
        {...midi}
        open={midiPanelOpen}
        onToggle={() => setMidiPanelOpen((v) => !v)}
      />
    </div>
  );
}
