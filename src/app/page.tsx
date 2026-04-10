'use client';

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { Settings, Menu, AudioLines, ListMusic, Copy, EyeOff } from 'lucide-react';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { AnalysisResult, StemFrame } from '@/types/v3';
import { computeAttention, resetAttention } from '@/lib/attention';
import { MODULATORS, resetDecayingStrobe, resetBeatStrobe, resetDirector, getDirectorChoice, getDirectorChoiceLabel, getDirectorPulseRate, pulseAtBeatRate, DIRECTOR_VERSION } from '@/lib/modulators';
import { estimateBeatOffset, beatPhases } from '@/lib/beatAlign';
import { analyzeAudio } from '@/lib/api';
import { resetPhaseChase, resetSpatialDirector } from '@/lib/spatial';
import { SignalGraph, resetSignalGraph } from '@/components/SignalGraph';
import { Screen3D, resetScreen3D } from '@/components/Screen3D';
import type {
  ShowPlan as DirectorShowPlan,
  DraftPlan as DirectorDraftPlan,
  PlanPatch as DirectorPlanPatch,
} from '@/lib/director/schema';
import { applyPatch as applyDirectorPatch } from '@/lib/director/applyPatch';
import {
  buildClaudeBlocks,
  getHitCueBoost,
} from '@/lib/director/engineAdapter';
import { DirectorHud, DirectorBadge } from '@/components/DirectorHud';

interface PresetSong {
  name: string;
  slug: string;
  ext?: string;   // defaults to .mp3
}

// Hardcoded fallback list — used only if manifest.json can't be loaded
// (e.g., before any songs have been ingested).
const FALLBACK_PRESETS: PresetSong[] = [
  { name: "Actin' Tough (Dean Turnley)", slug: 'actin_tough' },
  { name: "I Don't Sell (Makonnen)", slug: 'i_dont_sell_makonnen' },
  { name: 'Life During Wartime [jazz version]', slug: 'life_during_wartime' },
  { name: 'Hide and Seek (VIP)', slug: 'hide_and_seek' },
  { name: 'Tell Me', slug: 'tell_me_KLICKAUD' },
  { name: 'Gorilla (Little Simz)', slug: 'Little_Simz_-_Gorilla_Know_Good_Flip_KLICKAUD' },
  { name: 'Смерти Больше Нет', slug: 'Смерти_Больше_Нет_KLICKAUD' },
  { name: 'Pop Lock Drop It (Whethan Remix)', slug: 'Huey_-_Pop_Lock_Drop_It_Whethan_Remix_KLICKAUD' },
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

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [songName, setSongName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Claude director: parallel with analysis, non-blocking, display-only for now.
  // Streaming: as Claude produces partial patches, the ShowPlan is recomputed
  // on the fly by re-applying each partial to the draft.
  const [directorPlan, setDirectorPlan] = useState<DirectorShowPlan | null>(null);
  const [directorStatus, setDirectorStatus] = useState<
    'idle' | 'loading' | 'streaming' | 'ready' | 'error'
  >('idle');
  const [directorError, setDirectorError] = useState<string | null>(null);
  const [directorHudOpen, setDirectorHudOpen] = useState(false);

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
  // Independent layer toggles
  const [signalOn, setSignalOn] = useState(true);   // 1-Channel: full screen brightness
  const [spectroOn, setSpectroOn] = useState(true); // Spectro: 3D scene
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
      }
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('lightflow.settings', JSON.stringify({ lookAhead, keyMap, scrubberView, spectroOn })); } catch {}
  }, [lookAhead, keyMap, scrubberView, spectroOn]);
  const panHistoryRef = useRef<Record<string, number[]>>({});
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
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/songs/manifest.json');
        if (!res.ok) return;
        const arr = await res.json();
        if (Array.isArray(arr) && arr.length) {
          setPresetSongs(arr);
        }
      } catch { /* fall back */ }
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
  // When true and a Claude ShowPlan is available, the render loop uses
  // Claude-derived blocks in place of the engine's programBlocks. Off by
  // default so nothing changes until the user flips the switch.
  const [useClaudePlan, setUseClaudePlan] = useState(false);
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
      ? { 'KeyH': 'raw', 'KeyJ': 'beatStrobe', 'KeyK': 'halfBarPulse', 'KeyL': 'blackout' }
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
      else if (e.code === 'KeyZ') { e.preventDefault(); setSpectroOn(v => !v); }
      else if (e.code === 'Backquote') {
        e.preventDefault();
        setPinnedMod(prev => prev ? null : (prevPinRef.current ?? 'beatStrobe'));
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
      MODULATORS.director.fn({
        signal: att.signal,
        time: frame.time,
        beatPhase: ph.beatPhase,
        barPhase: ph.barPhase,
        bpm: res.bpm,
        dt,
        dominantStem: att.dominant,
        centroid: frame.centroid,
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

  // Claude director fetch — streams NDJSON partials from /api/director/stream.
  // Non-blocking, fails soft. As partial patches arrive the ShowPlan is
  // recomputed by re-applying the partial to the draft, so the HUD
  // progressively fills in sections / hit cues / warnings during the wait.
  const fetchDirectorPlan = useCallback(
    async (payload: { analysisUrl?: string; analysis?: AnalysisResult }) => {
      setDirectorStatus('loading');
      setDirectorError(null);
      setDirectorPlan(null);
      try {
        const res = await fetch('/api/director/stream', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let draft: DirectorDraftPlan | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;

            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(line);
            } catch {
              continue;
            }

            const t = msg.t as string;
            if (t === 'meta') {
              draft = msg.draft as DirectorDraftPlan;
              const cached = msg.cached as boolean;
              setDirectorStatus(cached ? 'ready' : 'streaming');
            } else if (t === 'partial' && draft) {
              try {
                const patch = msg.patch as DirectorPlanPatch;
                setDirectorPlan(applyDirectorPatch(draft, patch));
              } catch {
                // Partial may be malformed mid-stream; ignore and wait.
              }
            } else if (t === 'final' && draft) {
              const patch = msg.patch as DirectorPlanPatch;
              setDirectorPlan(applyDirectorPatch(draft, patch));
              setDirectorStatus('ready');
              const ce = msg.claudeError as string | null;
              if (ce) setDirectorError(ce);
            } else if (t === 'error') {
              throw new Error((msg.message as string) ?? 'stream error');
            }
          }
        }
      } catch (err) {
        setDirectorStatus('error');
        setDirectorError(err instanceof Error ? err.message : String(err));
      }
    },
    [],
  );

  // Load preset
  const loadPreset = useCallback(async (slug: string, name: string, ext: string = '.mp3') => {
    setIsLoading(true);
    setAnalysis(null);
    setDirectorPlan(null);
    setDirectorStatus('idle');
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
      precomputeTimeline(analysisRes);
      // Presets skip the stems phase (analysis already on disk) and go
      // straight to the director. Show the 2/2 label so the user knows
      // Claude is still working.
      setAnalyzingStatus('2/2 · director…');
      fetchDirectorPlan({ analysisUrl: `/songs/${slug}_analysis.json` });
      await loadAudioFile(`/songs/${slug}${ext}`);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadAudioFile, precomputeTimeline, resetProgramTimeline]);

  // Load a user-dropped file in raw mode (no analysis → no Director, no
  // attention layer, no Program Focus Timeline). Audio just plays.
  // The UI shows a "raw mode" hint until full server-side analysis is wired.
  // In-memory analysis cache: dropping the same file (by name + size) twice
  // doesn't re-trigger a 30–90s demucs run.
  const analysisCacheRef = useRef<Map<string, AnalysisResult>>(new Map());
  const [analyzingStatus, setAnalyzingStatus] = useState<string | null>(null);

  // Clear the 2/2 director label as soon as the director finishes (or errors).
  // This is separate from directorStatus because it also covers the initial
  // analysis phase (1/2) and the "playing raw" failure path.
  useEffect(() => {
    if (analyzingStatus?.startsWith('2/2') && directorStatus === 'ready') {
      setAnalyzingStatus(null);
    }
    if (analyzingStatus?.startsWith('2/2') && directorStatus === 'error') {
      setAnalyzingStatus('director failed — using engine baseline');
      const id = setTimeout(() => setAnalyzingStatus(null), 4000);
      return () => clearTimeout(id);
    }
  }, [directorStatus, analyzingStatus]);

  const loadCustomFile = useCallback(async (file: File) => {
    setIsLoading(true);
    setAnalysis(null);
    setDirectorPlan(null);
    setDirectorStatus('idle');
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
      fetchDirectorPlan({ analysis: cached });
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
      // Phase 2: Claude director. The HUD badge carries full progress,
      // but the top-bar label shows a single line so it's obvious the
      // song isn't "ready" yet.
      setAnalyzingStatus('2/2 · director…');
      fetchDirectorPlan({ analysis: result });
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

  // Auto-load first song on mount
  const didAutoLoadRef = useRef(false);
  useEffect(() => {
    if (didAutoLoadRef.current) return;
    if (presetSongs.length === 0) return;
    didAutoLoadRef.current = true;
    const first = presetSongs[0];
    loadPreset(first.slug, first.name, first.ext ?? '.mp3');
  }, [loadPreset, presetSongs]);

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
    // Signal source resolution.
    //
    // Default (engine): signal comes from the attention layer, which
    // picks a dominant stem live each frame.
    //
    // Claude mode: if useClaudePlan is on AND the active section has a
    // focus stem, we source the signal DIRECTLY from that stem's raw
    // energy (boosted slightly) instead of the attention layer's pick.
    // This is what makes Claude's focus decisions audible on the lights:
    // when Claude says "focus vocals here", brightness follows vocals
    // instead of whatever attention thinks is loudest.
    //
    // The same section also gives us the rate (from modulator) and
    // intensity scale (from the block's baked value).
    // ----------------------------------------------------------------
    const activeBlocks =
      useClaudePlan && directorPlan
        ? buildClaudeBlocks(directorPlan)
        : programBlocks;

    let claudeFocusStem: string | null = null;
    let claudeStemSignal: number | null = null;
    if (useClaudePlan && directorPlan) {
      const t = audioState.currentTime;
      const sec = directorPlan.sections.find(s => s.start <= t && s.end > t);
      if (sec) {
        // Map "vocals" to "other" since the engine's stem vocabulary
        // doesn't carry a separate vocals envelope on this path.
        const stemKey = sec.focusStem === 'vocals' ? 'other' : sec.focusStem;
        const raw = stems[stemKey] ?? 0;
        // Boost to match the 0..1 range the attention layer normally
        // delivers. 1.6 is the empirical multiplier — raw stem energies
        // peak ~0.6 on most tracks.
        claudeStemSignal = Math.max(0, Math.min(1, raw * 1.6));
        claudeFocusStem = sec.focusStem;
      }
    }

    const baseSignal = claudeStemSignal ?? attention.signal;
    const dominantForCtx = claudeFocusStem ?? attention.dominant;

    // Apply selected modulator on top of the resolved signal
    const modCtx = {
      signal: baseSignal,
      time: audioState.currentTime,
      ...beatPhases(audioState.currentTime, analysis.bpm, beatOffset),
      bpm: analysis.bpm,
      dt,
      dominantStem: dominantForCtx,
      centroid: currentFrame.centroid,
    };

    let activeMod = modulator;
    let directorRate = 0;
    let sectionIntensityScale = 1;
    if (modulator === 'director') {
      const t = audioState.currentTime;
      const fxBlock = activeBlocks.find(b => b.lane.startsWith('fx:') && b.start <= t && b.end > t);
      activeMod = fxBlock ? fxBlock.lane.slice(3) : 'raw';
      directorRate = fxBlock?.rate ?? 0;
      sectionIntensityScale = fxBlock?.intensityScale ?? 1;
    }
    let modulated: number;
    if (modulator === 'director' && directorRate > 0) {
      modulated = Math.max(0, Math.min(1, pulseAtBeatRate(modCtx, directorRate)));
    } else {
      const modFn = MODULATORS[activeMod]?.fn ?? MODULATORS.raw.fn;
      modulated = Math.max(0, Math.min(1, modFn(modCtx)));
    }
    // Apply Claude's per-section intensity scale (no-op when not using
    // Claude's plan since the fallback scale is 1).
    if (useClaudePlan && sectionIntensityScale !== 1) {
      modulated = Math.max(0, Math.min(1, modulated * sectionIntensityScale));
    }
    // Override the displayed dominant stem so the HUD / signal graph
    // shows what's actually driving the signal.
    if (claudeFocusStem) {
      setDominantStem(claudeFocusStem);
    }
    // Hit cue overlay: if Claude placed a one-shot at this moment, boost
    // the brightness for the duration of the cue's envelope. Fires
    // regardless of the useClaudePlan toggle — hit cues are additive and
    // never hurt the baseline.
    if (directorPlan) {
      const boost = getHitCueBoost(directorPlan, audioState.currentTime);
      if (boost.envelope > 0) {
        modulated = Math.max(modulated, boost.envelope);
      }
    }
    setSignal(modulated);
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
  }, [currentFrame, analysis, audioState.currentTime, audioState.isPlaying, soloStem, modulator, useClaudePlan, directorPlan, programBlocks, songMenuOpen]);

  const isReady = !!audioState.source;
  const isRawMode = isReady && !analysis;

  // Format time
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div
      className="h-[100dvh] flex flex-col text-white overflow-hidden"
      style={{
        backgroundColor: isReady && signalOn
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
                  const dur = songDurations[song.slug];
                  return (
                    <button
                      key={song.slug}
                      onClick={() => { loadPreset(song.slug, song.name, song.ext ?? '.mp3'); setSongMenuOpen(false); }}
                      disabled={isLoading}
                      className={`w-full flex items-center justify-between gap-3 px-4 py-1.5 text-sm ${
                        isCurrent
                          ? 'text-white'
                          : 'text-white/55 hover:text-white'
                      }`}
                    >
                      <span className="truncate font-medium text-left">{song.name}</span>
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
            // Stem-reactive radial gradient backdrop. Each stem owns one blob;
            // its alpha tracks its live signal and its position drifts with
            // pan + a slow per-stem time offset. Sum > sum-of-static so it
            // breathes with the music like the 3D scene does.
            const t = audioState.currentTime;
            const blob = (stem: string, baseX: number, baseY: number, color: string, phase: number) => {
              const sig = stemSignals[stem] ?? 0;
              const pan = stemPans[stem] ?? 0;
              const alpha = 0.14 + sig * 0.18;
              const wobX = Math.sin(t * 0.25 + phase) * 5;
              const wobY = Math.cos(t * 0.18 + phase * 1.3) * 4;
              const x = baseX + wobX + pan * 8;
              const y = baseY + wobY;
              const radius = 70 + sig * 15;
              return `radial-gradient(circle at ${x}% ${y}%, rgba(${color},${alpha}) 0%, transparent ${radius}%)`;
            };
            // Blobs roughly trace the 3D wave's footprint: clustered in the
            // lower-right where the spectrograph crest sits, leaving the
            // upper-left dark like the scene.
            const gradients = [
              blob('bass',  55, 75, '22,101,52',   0),    // dark green - foreground left of crest
              blob('kick',  72, 60, '34,197,94',   1.2),  // green - crest base
              blob('snare', 88, 50, '163,230,53',  2.4),  // lime - bright peak
              blob('hat',   78, 70, '250,204,21',  3.6),  // yellow - crest highlight
              blob('other', 95, 80, '156,163,175', 4.8),  // gray - far right tail
            ].join(', ');
            return (
            <div className="fixed inset-0 z-0">
              <div
                className="absolute inset-0"
                style={{ background: `${gradients}, #000` }}
              />
              <Screen3D
                stemSignals={stemSignals}
                stemPans={stemPans}
                stemNovelty={stemNovelty}
              />
              {/* Single-channel brightness flash overlay */}
              {signalOn && (
                <div
                  className="absolute inset-0 bg-white pointer-events-none mix-blend-screen"
                  style={{ opacity: signal * 0.45 }}
                />
              )}
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
            <DirectorBadge
              status={directorStatus}
              plan={directorPlan}
              live={useClaudePlan && !!directorPlan}
              onToggleLive={() => setUseClaudePlan(v => !v)}
              onOpenPanel={() => setDirectorHudOpen(v => !v)}
            />
            <div className="flex-1" />
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
            {signalOn && !spectroOn && (
              <div className="absolute bottom-0 left-0 right-0 h-1/4 opacity-20 pointer-events-none">
                <SignalGraph signal={signal} dominant={dominantStem} time={audioState.currentTime} />
              </div>
            )}
            {false && !spectroOn && audioState.duration > 0 && (() => {
              const STEM_LANES = STEMS.map(s => ({ key: 'stem:' + s, label: s.toUpperCase(), color: STEM_COLOR_RGB[s] }));
              const FX_LANES = [
                { key: 'fx:raw',          label: 'RAW',      color: '#67e8f9' }, // cyan-300
                { key: 'fx:beatStrobe',   label: 'STROBE',   color: '#22d3ee' }, // cyan-400
                { key: 'fx:halfBarPulse', label: 'PULSE',    color: '#06b6d4' }, // cyan-500
                { key: 'fx:sineWobble',   label: 'WOBBLE',   color: '#0891b2' }, // cyan-600
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
              className="px-4 py-2 md:py-1.5 min-h-11 md:min-h-0 rounded-full whitespace-nowrap border border-white/30 bg-white/10 hover:bg-white/15 active:bg-white/20 text-white font-semibold transition-colors flex items-center gap-2 shrink-0"
            >
              <span className="text-lg leading-none">{audioState.isPlaying ? '⏸' : '▶'}</span>
              <span className="hidden md:inline text-[10px] uppercase tracking-widest opacity-60">Space</span>
            </button>
            <div className="flex items-center justify-center gap-2 flex-1 order-3 md:order-none w-full md:w-auto flex-wrap md:flex-nowrap">
            {/* Track focus (stems) */}
            {STEMS.map((stem, i) => {
              const level = stemLevels[stem] ?? 0;
              const isActive = soloStem === stem || (dominantStem === stem && !soloStem);
              const colorRgb = STEM_COLOR_RGB[stem];
              const stemKey = keyMap === 'pro' ? ['A','S','D','F','G'][i] : String(i + 1);
              return (
                <button
                  key={stem}
                  onPointerDown={() => setSoloStem(stem)}
                  onPointerUp={() => setSoloStem(null)}
                  onPointerLeave={() => setSoloStem(null)}
                  className={`relative text-xs px-3 py-2.5 md:py-1.5 min-h-11 md:min-h-0 rounded-full select-none overflow-hidden flex-1 min-w-[60px] md:flex-none md:w-[96px] font-medium active:bg-white/10 ${
                    isActive
                      ? 'border-2 bg-white/5 text-white'
                      : 'border border-white/10 bg-black/60 text-white/60'
                  }`}
                  style={isActive ? { borderColor: colorRgb } : undefined}
                >
                  <div
                    className="absolute inset-y-0 left-0 transition-none opacity-20"
                    style={{
                      width: `${Math.min(100, level * 100)}%`,
                      backgroundColor: colorRgb,
                    }}
                  />
                  <div className="relative flex items-center gap-1.5 justify-center">
                    <span className="opacity-70 font-mono">{stemKey}</span>
                    <span className="uppercase tracking-wide">{stem}</span>
                  </div>
                </button>
              );
            })}
            <div className="hidden md:block w-px h-6 bg-white/15 mx-3" />
            {/* Director sub-choices: auto unless user pins one */}
            {(() => {
              const FX_HINT = keyMap === 'pro' ? ['H','J','K','L'] : [null,null,null,null];
              const subs = [
                { key: 'raw',          label: 'RAW',      hint: FX_HINT[0], color: '#d4d4d8' },
                { key: 'beatStrobe',   label: 'STROBE',   hint: FX_HINT[1], color: '#a8a3c4' },
                { key: 'halfBarPulse', label: 'PULSE',    hint: FX_HINT[2], color: '#7c6f9e' },
                { key: 'blackout',     label: 'BLACKOUT', hint: FX_HINT[3], color: '#1e0a3c' },
              ] as const;
              return (
                <div className="flex items-center gap-1 pl-3 pr-3 py-1 rounded-full border bg-black/40 border-white/15">
                  <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-white/70 ml-3">
                    Effects
                  </span>
                  {(() => {
                    const mode = !pinnedMod ? 'auto' : pinnedMod === 'raw' ? 'off' : 'manual';
                    const cycleMode = () => {
                      if (mode === 'auto') setPinnedMod('beatStrobe');
                      else if (mode === 'manual') setPinnedMod('raw');
                      else setPinnedMod(null);
                    };
                    const txt = mode === 'auto'
                      ? 'text-green-400'
                      : mode === 'manual'
                        ? 'text-yellow-300'
                        : 'text-red-400';
                    const label = mode === 'auto' ? 'Auto' : mode === 'manual' ? 'Manual' : 'Off';
                    return (
                      <button
                        onClick={cycleMode}
                        className="flex items-center gap-1.5 ml-1 mr-2 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                        title="Cycle: auto → manual → off"
                      >
                        <span className={`w-2 h-2 rounded-full ${
                          mode === 'auto'
                            ? 'bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.8)]'
                            : mode === 'manual'
                              ? 'bg-yellow-400 shadow-[0_0_6px_rgba(250,204,21,0.8)]'
                              : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)]'
                        }`} />
                        <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${txt}`}>
                          {label}
                        </span>
                      </button>
                    );
                  })()}
                  {subs.map((m) => {
                    const isPinned = pinnedMod === m.key;
                    const isAuto = !pinnedMod && directorChoice === m.key;
                    // v1.2: show the actual rate on the active pulse/strobe
                    // button by parsing it out of directorLabel ("strobe·16",
                    // "pulse·4", etc). Only applied on live auto mode.
                    const rateSuffix =
                      isAuto && (m.key === 'beatStrobe' || m.key === 'halfBarPulse')
                        ? (directorLabel.split('·')[1] ?? null)
                        : null;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setPinnedMod(isPinned ? null : m.key)}
                        className={`text-xs px-3 py-2.5 md:py-1.5 min-h-11 md:min-h-0 flex-1 md:flex-none min-w-[60px] md:min-w-[88px] rounded-full uppercase tracking-wide font-medium transition-colors active:bg-white/10 ${
                          isPinned || isAuto
                            ? 'border-2 bg-white/5 text-white'
                            : 'border border-white/10 bg-black/60 text-white/60'
                        }`}
                        style={(isPinned || isAuto) ? { borderColor: m.color } : undefined}
                      >
                        <span className="flex items-center gap-1.5 justify-center">
                          {m.hint && <span className="opacity-70 font-mono normal-case">{m.hint}</span>}
                          <span>{m.label}</span>
                          {rateSuffix && (
                            <span className="text-[9px] font-mono tabular-nums text-white/60 normal-case">·{rateSuffix}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <div className="hidden md:block w-px h-6 bg-white/15 mx-3" />
            <button
              onClick={() => setSpectroOn(v => !v)}
              className={`text-xs px-4 py-2.5 md:py-2 min-h-11 md:min-h-0 rounded-full whitespace-nowrap border font-mono uppercase tracking-widest transition-colors ${
                spectroOn
                  ? 'bg-transparent text-amber-300 border-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.4)]'
                  : 'bg-transparent text-white/40 border-dashed border-white/20 hover:text-white/70 hover:border-white/40'
              }`}
            >
              Spectro
            </button>
            </div>
            <button
              onClick={() => setUiHidden(true)}
              className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/70 text-white/70 hover:text-white border border-white/10 shrink-0"
              title="Hide controls"
            >
              <EyeOff size={14} />
            </button>
            {/* Settings (far right) */}
            <div className="relative shrink-0" ref={settingsRef}>
              <button
                onClick={() => setSettingsOpen(v => !v)}
                className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/60 active:bg-black/70 text-white/70 hover:text-white border border-white/10"
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

          {/* Bottom: scrubber + play */}
          <div className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0 space-y-2 relative z-10">
            {/* Combined scrubber: waveform OR program focus timeline */}
            <div
              ref={scrubRef}
              className="relative w-full bg-black/20 rounded-md overflow-hidden cursor-pointer select-none"
              style={{ height: scrubberView === 'waveform' ? 100 : 180 }}
              onPointerDown={(e) => {
                (e.target as Element).setPointerCapture(e.pointerId);
                scrubFromEvent(e.clientX);
              }}
              onPointerMove={(e) => {
                if (e.buttons === 1) scrubFromEvent(e.clientX);
              }}
            >
              {scrubberView === 'waveform' && energyBars && (
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
              {scrubberView === 'timeline' && audioState.duration > 0 && (() => {
                const STEM_LANES = STEMS.map(s => ({ key: 'stem:' + s, label: s.toUpperCase(), color: STEM_COLOR_RGB[s] }));
                const FX_LANES = [
                  { key: 'fx:raw',          label: 'RAW',      color: '#d4d4d8' }, // very light desat (zinc-300)
                  { key: 'fx:beatStrobe',   label: 'STROBE',   color: '#a8a3c4' }, // light desat purple
                  { key: 'fx:halfBarPulse', label: 'PULSE',    color: '#7c6f9e' }, // mid purple
                ];
                // Layout: lanes span the full container width so they align
                // perfectly with the playhead. Labels and group headers are
                // floated as an absolute overlay on top of the leftmost edge.
                const dur = audioState.duration;
                const ROW_H = 13;
                const TOP_PAD = 34;
                const STEM_TOP = TOP_PAD + 10; // after "STEMS" header
                const FX_TOP   = STEM_TOP + STEM_LANES.length * ROW_H + 14; // gap + "EFFECTS" header
                const allRows: { top: number; lane: typeof STEM_LANES[number] }[] = [];
                STEM_LANES.forEach((lane, i) => allRows.push({ top: STEM_TOP + i * ROW_H, lane }));
                FX_LANES.forEach((lane, i) => allRows.push({ top: FX_TOP + i * ROW_H, lane }));
                return (
                  <div className="absolute inset-0 pointer-events-none">
                    {/* Lane bars: full container width, perfectly aligned to playhead */}
                    {allRows.map(({ top, lane }) => (
                      <div key={lane.key} className="absolute left-0 right-0" style={{ top, height: ROW_H }}>
                        <div className="relative w-full h-full bg-white/[0.04] overflow-hidden">
                          {programBlocks.filter(b => b.lane === lane.key).map((b, j) => {
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
                    {/* Floating labels overlay (left edge) */}
                    <div className="absolute left-2 top-0 z-10">
                      {STEM_LANES.map((lane, i) => (
                        <div
                          key={lane.key}
                          className="absolute text-[9px] font-mono font-semibold"
                          style={{ top: STEM_TOP + i * ROW_H, lineHeight: `${ROW_H}px`, color: lane.color, textShadow: '0 0 4px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,1)' }}
                        >
                          {lane.label}
                        </div>
                      ))}
                      {FX_LANES.map((lane, i) => (
                        <div
                          key={lane.key}
                          className="absolute text-[9px] font-mono font-semibold"
                          style={{ top: FX_TOP + i * ROW_H, lineHeight: `${ROW_H}px`, color: lane.color, textShadow: '0 0 4px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,1)' }}
                        >
                          {lane.label}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
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
              {/* View toggle (with copy button on the left when in timeline) */}
              <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
                {scrubberView === 'timeline' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const payload = {
                        song: songName,
                        bpm: analysis?.bpm,
                        duration: audioState.duration,
                        blocks: programBlocks.map(b => ({
                          lane: b.lane,
                          start: +b.start.toFixed(3),
                          end: +b.end.toFixed(3),
                        })),
                      };
                      navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      setToast('Timeline data copied to clipboard');
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-medium px-2.5 py-0.5 rounded-full bg-black/30 border border-white/10 text-white/60 hover:text-white transition-colors"
                  >
                    <Copy size={11} />
                    <span>Copy Data</span>
                  </button>
                )}
                <div className="flex gap-1 bg-black/30 rounded-full p-0.5 border border-white/10">
                {([
                  { key: 'waveform' as const, Icon: AudioLines, label: 'Waveform' },
                  { key: 'timeline' as const, Icon: ListMusic,  label: 'Timeline' },
                ]).map(({ key, Icon, label }) => (
                  <button
                    key={key}
                    title={label}
                    onClick={(e) => { e.stopPropagation(); setScrubberView(key); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full transition-colors ${
                      scrubberView === key
                        ? 'bg-white/10 text-white/90'
                        : 'text-white/40 hover:text-white/70'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="text-[10px] uppercase tracking-wider font-medium">{label}</span>
                  </button>
                ))}
                </div>
              </div>
            </div>
          </div>
          </>
          )}
        </>
      )}
      <DirectorHud
        plan={directorPlan}
        status={directorStatus}
        error={directorError}
        currentTime={audioState.currentTime}
        open={directorHudOpen}
        onToggle={() => setDirectorHudOpen((v) => !v)}
        useClaudePlan={useClaudePlan}
        onToggleUseClaudePlan={() => setUseClaudePlan((v) => !v)}
      />
    </div>
  );
}
