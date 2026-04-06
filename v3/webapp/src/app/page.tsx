'use client';

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { Volume2, ArrowLeft } from 'lucide-react';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { AnalysisResult, StemFrame } from '@/types/v3';
import { computeAttention, resetAttention } from '@/lib/attention';
import { MODULATORS, resetDecayingStrobe, resetBeatStrobe, resetDirector } from '@/lib/modulators';
import { SPATIAL_MODULATORS, resetPhaseChase, resetSpatialDirector, GRID_SIZE } from '@/lib/spatial';
import { SignalGraph, resetSignalGraph } from '@/components/SignalGraph';
import { TubePreview } from '@/components/TubePreview';
import { Screen2D, resetScreen2D } from '@/components/Screen2D';
import { Screen3D, resetScreen3D, SCENES_3D } from '@/components/Screen3D';

const PRESET_SONGS = [
  { name: "Actin' Tough (Dean Turnley)", slug: 'actin_tough' },
  { name: "I Don't Sell (Makonnen)", slug: 'i_dont_sell_makonnen' },
  { name: 'Life During Wartime [jazz version]', slug: 'life_during_wartime' },
  { name: 'Hide and Seek (VIP)', slug: 'hide_and_seek' },
  { name: 'Tell Me', slug: 'tell_me_KLICKAUD' },
  { name: 'Gorilla (Little Simz)', slug: 'Little_Simz_-_Gorilla_Know_Good_Flip_KLICKAUD' },
  { name: 'Смерти Больше Нет', slug: 'Смерти_Больше_Нет_KLICKAUD' },
];

const STEMS = ['bass', 'kick', 'snare', 'hat', 'other'] as const;

const STEM_COLOR_RGB: Record<string, string> = {
  bass: '#f59e0b',
  kick: '#ef4444',
  snare: '#3b82f6',
  hat: '#a855f7',
  other: '#6b7280',
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

  // The single output signal: 0-1 brightness
  const [signal, setSignal] = useState(0);
  const [dominantStem, setDominantStem] = useState<string>('bass');
  const [soloStem, setSoloStem] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState({ hold: 0, held: 0, energy: 0 });
  const [modulator, setModulator] = useState<string>('director');
  // Top-level mode: '1ch', '2ch', or 'tubes'
  const [topMode, setTopMode] = useState<'1ch' | '2ch' | 'tubes'>('2ch');
  const [spatialMod, setSpatialMod] = useState<string>('director');
  const [grid, setGrid] = useState<Float32Array | null>(null);
  const [accent, setAccent] = useState(0);
  const [accentStem, setAccentStem] = useState('kick');
  const [stemSignals, setStemSignals] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [stemPans, setStemPans] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [screen2chSub, setScreen2chSub] = useState<'2d' | '3d'>('3d');
  const [scene3D, setScene3D] = useState<string>('plane');
  const [lookAhead, setLookAhead] = useState(0.06); // seconds of visual look-ahead
  const panHistoryRef = useRef<Record<string, number[]>>({});
  const [stemLevels, setStemLevels] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });
  const [stemScores, setStemScores] = useState<Record<string, number>>({
    bass: 0, kick: 0, snare: 0, hat: 0, other: 0,
  });

  const lastFrameTimeRef = useRef(0);

  // Back to song list
  const goBack = useCallback(() => {
    pause();
    setAnalysis(null);
    setSongName(null);
    setSignal(0);
    setDominantStem('bass');
    resetAttention();
  }, [pause]);

  // Keyboard: space = play/pause, 1-5 = solo stem, cmd+left = back
  useEffect(() => {
    const STEM_KEYS: Record<string, string> = {
      'Digit1': 'bass', 'Digit2': 'kick', 'Digit3': 'snare',
      'Digit4': 'hat', 'Digit5': 'other',
    };
    const handleDown = (e: KeyboardEvent) => {
      if (e.target !== document.body) return;
      if (e.code === 'Space') { e.preventDefault(); audioState.isPlaying ? pause() : play(); }
      else if ((e.metaKey || e.ctrlKey) && e.code === 'ArrowLeft') {
        e.preventDefault();
        goBack();
      }
      else if (STEM_KEYS[e.code]) { e.preventDefault(); setSoloStem(STEM_KEYS[e.code]); }
    };
    const handleUp = (e: KeyboardEvent) => { if (STEM_KEYS[e.code]) setSoloStem(null); };
    window.addEventListener('keydown', handleDown);
    window.addEventListener('keyup', handleUp);
    return () => { window.removeEventListener('keydown', handleDown); window.removeEventListener('keyup', handleUp); };
  }, [audioState.isPlaying, play, pause, goBack]);

  // Load preset
  const loadPreset = useCallback(async (slug: string, name: string) => {
    setIsLoading(true);
    setAnalysis(null);
    resetAttention();
    resetSignalGraph();
    resetDecayingStrobe();
    resetBeatStrobe();
    resetDirector();
    resetPhaseChase();
    resetSpatialDirector();
    resetScreen2D();
    resetScreen3D();
    panHistoryRef.current = {};
    try {
      const analysisRes = await fetch(`/songs/${slug}_analysis.json`).then(r => r.json());
      setAnalysis(analysisRes as AnalysisResult);
      setSongName(name);
      await loadAudioFile(`/songs/${slug}.mp3`);
    } catch (err) {
      console.error('Failed to load:', err);
    } finally {
      setIsLoading(false);
    }
  }, [loadAudioFile]);

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

    // Apply selected modulator on top of the attention signal
    const modCtx = {
      signal: attention.signal,
      time: audioState.currentTime,
      beatPhase: (audioState.currentTime * analysis.bpm / 60) % 1,
      barPhase: (audioState.currentTime * analysis.bpm / 60 / 4) % 1,
      bpm: analysis.bpm,
      dt,
    };
    const modFn = MODULATORS[modulator]?.fn ?? MODULATORS.raw.fn;
    const modulated = Math.max(0, Math.min(1, modFn(modCtx)));
    setSignal(modulated);

    // Spatial layer (Tube Test mode)
    setAccent(attention.accent);
    setAccentStem(attention.accentStem);
    setStemSignals(attention.stemSignals);
    // Pass through pan data — we have bass, vocals, other; default 0 for others
    const pans = currentFrame.pans as unknown as Record<string, number>;
    setStemPans({
      bass: pans.bass ?? 0,
      kick: 0,
      snare: 0,
      hat: 0,
      other: pans.other ?? 0,
    });

    if (topMode === 'tubes') {
      // Compute pan motion for the dominant stem (recent stddev of pan values)
      const dom = attention.dominant;
      const pans = currentFrame.pans as unknown as Record<string, number>;
      const panNow = pans[dom] ?? 0;

      const history = panHistoryRef.current[dom] ?? [];
      history.push(panNow);
      if (history.length > 60) history.shift(); // ~2 sec at 30fps
      panHistoryRef.current[dom] = history;

      let panMotion = 0;
      if (history.length > 4) {
        const mean = history.reduce((a, b) => a + b, 0) / history.length;
        const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
        panMotion = Math.min(1, Math.sqrt(variance) * 2.5);
      }

      // Centroid normalized 0-1 (centroids are 0-8000Hz typically, 4000 is mid)
      const centroidNorm = Math.min(1, currentFrame.centroid / 6000);

      const spatialFn = SPATIAL_MODULATORS[spatialMod]?.fn ?? SPATIAL_MODULATORS.solid.fn;
      const spatialGrid = spatialFn({
        ...modCtx,
        signal: modulated,
        dominantStem: dom,
        panPosition: panNow,
        panMotion,
        centroid: centroidNorm,
        energy: attention.overallEnergy,
      });
      // Convert flat brightness grid to RGB grid (16x8x3) for TubePreview
      const rgbGrid = new Float32Array(GRID_SIZE * 3);
      for (let i = 0; i < spatialGrid.length; i++) {
        const v = spatialGrid[i];
        rgbGrid[i * 3] = v;
        rgbGrid[i * 3 + 1] = v;
        rgbGrid[i * 3 + 2] = v;
      }
      setGrid(rgbGrid);
    } else {
      setGrid(null);
    }
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
  }, [currentFrame, analysis, audioState.currentTime, audioState.isPlaying, soloStem, modulator, topMode, spatialMod]);

  const isReady = audioState.source && analysis;

  // Format time
  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div
      className="h-[100dvh] flex flex-col text-white overflow-hidden"
      style={{
        backgroundColor: isReady && topMode !== 'tubes'
          ? `rgb(${Math.round(signal * 255)}, ${Math.round(signal * 255)}, ${Math.round(signal * 255)})`
          : '#000',
      }}
    >
      {!isReady ? (
        /* Song picker */
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4">
            <div className="text-center mb-6">
              <h1 className="text-lg font-medium">LightFlow</h1>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-green-800 bg-green-950 text-green-400">v3.2 · signal test</span>
            </div>
            <div className="text-[10px] text-gray-500 text-center mb-2 flex items-center justify-center gap-1">
              <Volume2 size={11} />
              audio will play
            </div>
            {PRESET_SONGS.map((song) => (
              <button
                key={song.slug}
                onClick={() => loadPreset(song.slug, song.name)}
                disabled={isLoading}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-900 rounded-xl hover:bg-gray-800 active:bg-gray-700 transition-colors disabled:opacity-50"
              >
                <div className="text-sm font-medium text-left">{song.name}</div>
                <Volume2 size={14} className="text-gray-500 shrink-0" />
              </button>
            ))}
            {isLoading && (
              <div className="flex items-center justify-center gap-2 text-gray-500 text-sm">
                <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
                Loading...
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* 2-channel renderers — full screen, behind UI */}
          {topMode === '2ch' && screen2chSub === '2d' && (
            <div className="fixed inset-0 z-0">
              <Screen2D
                signal={signal}
                accent={accent}
                accentStem={accentStem}
                time={audioState.currentTime}
              />
            </div>
          )}
          {topMode === '2ch' && screen2chSub === '3d' && (
            <div className="fixed inset-0 z-0">
              <Screen3D
                signal={signal}
                accent={accent}
                accentStem={accentStem}
                time={audioState.currentTime}
                scene={scene3D}
                stemSignals={stemSignals}
                stemPans={stemPans}
              />
            </div>
          )}

          {/* Top bar */}
          <div className="px-3 pt-2 pb-1 shrink-0 flex items-center gap-3 z-10 relative">
            <button
              onClick={goBack}
              className="flex items-center justify-center w-7 h-7 rounded-full bg-black/40 hover:bg-black/60 text-white shrink-0"
              title="Back to song list (⌘←)"
            >
              <ArrowLeft size={14} />
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <h1 className="text-sm font-medium">{songName}</h1>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-green-800 bg-green-950 text-green-400">v3.2</span>
            </div>
            <div className="flex items-center justify-center gap-1 flex-1">
              {STEMS.map((stem, i) => {
                const level = stemLevels[stem] ?? 0;
                const score = stemScores[stem] ?? 0;
                const isActive = soloStem === stem || (dominantStem === stem && !soloStem);
                const colorRgb = STEM_COLOR_RGB[stem];
                return (
                  <button
                    key={stem}
                    onPointerDown={() => setSoloStem(stem)}
                    onPointerUp={() => setSoloStem(null)}
                    onPointerLeave={() => setSoloStem(null)}
                    className={`relative text-xs px-3 py-1.5 rounded-full select-none overflow-hidden min-w-[88px] font-medium border ${
                      isActive
                        ? `${STEM_COLORS[stem].active} border-white/30`
                        : 'bg-black/60 border-white/10 text-white/90'
                    }`}
                  >
                    {/* Live meter as background fill */}
                    <div
                      className="absolute inset-y-0 left-0 transition-none opacity-50"
                      style={{
                        width: `${Math.min(100, level * 100)}%`,
                        backgroundColor: colorRgb,
                      }}
                    />
                    <div className="relative flex items-center gap-1.5 justify-center">
                      <span className="opacity-70">{i + 1}</span>
                      <span className="uppercase tracking-wide">{stem}</span>
                      <span className="font-mono opacity-80 text-[10px]">{(score * 100).toFixed(0)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className="flex items-center gap-1 text-[9px] text-gray-500 font-mono">
                <span>lead</span>
                <input
                  type="range"
                  min={0}
                  max={0.3}
                  step={0.005}
                  value={lookAhead}
                  onChange={(e) => setLookAhead(parseFloat(e.target.value))}
                  className="w-16 h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
                />
                <span className="w-8 text-right">{(lookAhead * 1000).toFixed(0)}ms</span>
              </label>
              <p className="text-[10px] text-gray-500">
                {analysis.bpm?.toFixed(0)} BPM
              </p>
            </div>
          </div>

          <div className="flex-1 relative">
            {topMode === 'tubes' && grid && (
              <div className="absolute inset-0 bg-black">
                <TubePreview grid={grid} />
              </div>
            )}
            {topMode === '1ch' && (
              <div className="absolute bottom-0 left-0 right-0 h-1/4 opacity-20 pointer-events-none">
                <SignalGraph signal={signal} dominant={dominantStem} time={audioState.currentTime} />
              </div>
            )}
          </div>

          {/* Mode group with sub-buttons */}
          <div className="px-3 pt-2 pb-2 shrink-0 relative z-10 flex items-stretch justify-center gap-2">
            {([
              {
                key: '1ch' as const,
                label: '1-Channel',
                subs: [
                  { key: 'raw', label: 'Raw' },
                  { key: 'director', label: 'Director' },
                ],
                getCurrent: () => modulator,
                setCurrent: (k: string) => setModulator(k),
              },
              {
                key: '2ch' as const,
                label: '2-Channel',
                subs: [
                  { key: '2d', label: '2D' },
                  { key: '3d', label: '3D' },
                ],
                getCurrent: () => screen2chSub,
                setCurrent: (k: string) => setScreen2chSub(k as '2d' | '3d'),
              },
              {
                key: 'tubes' as const,
                label: 'Tube Test',
                subs: [],
                getCurrent: () => '',
                setCurrent: () => {},
              },
            ]).map((m) => {
              const isActive = topMode === m.key;
              return (
                <div
                  key={m.key}
                  className={`flex flex-col items-center rounded-2xl border transition-colors overflow-hidden ${
                    isActive
                      ? 'border-white bg-cyan-500/15'
                      : 'border-white/15 bg-black/30'
                  }`}
                >
                  <button
                    onClick={() => setTopMode(m.key)}
                    className={`text-xs font-semibold px-4 pt-2.5 pb-1.5 ${
                      isActive ? 'text-white' : 'text-white/70'
                    }`}
                  >
                    {m.label}
                  </button>
                  {m.subs.length > 0 && (
                    <div className="flex gap-1 px-2 pb-2">
                      {m.subs.map((s) => {
                        const subActive = m.getCurrent() === s.key;
                        return (
                          <button
                            key={s.key}
                            onClick={() => {
                              setTopMode(m.key);
                              m.setCurrent(s.key);
                            }}
                            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                              subActive
                                ? 'bg-white text-black'
                                : 'bg-black/40 text-white/60 hover:bg-black/60'
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 3D scene picker — only when in 2-channel 3D */}
          {topMode === '2ch' && screen2chSub === '3d' && (
            <div className="px-3 pb-1 shrink-0 relative z-10 flex items-center justify-center gap-1 flex-wrap">
              {SCENES_3D.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScene3D(s.key)}
                  className={`text-[10px] px-2.5 py-1 rounded-full whitespace-nowrap border transition-colors ${
                    scene3D === s.key
                      ? 'bg-white text-black border-white'
                      : 'bg-black/40 text-white/70 border-white/10 hover:bg-black/60'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Bottom: scrubber + play */}
          <div className="px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 shrink-0 space-y-2 relative z-10">
            <input
              type="range"
              min={0}
              max={audioState.duration || 1}
              step={0.1}
              value={audioState.currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              className="w-full h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={audioState.isPlaying ? pause : play}
                className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black active:scale-95"
              >
                {audioState.isPlaying ? '⏸' : '▶'}
              </button>
              <span className="text-[10px] text-gray-500 font-mono">
                {fmt(audioState.currentTime)} / {fmt(audioState.duration)}
              </span>
              <span className="text-[10px] text-gray-600 ml-auto font-mono">
                {dominantStem} · {(signal * 100).toFixed(0)}% · hold {debugInfo.held.toFixed(1)}/{debugInfo.hold}b · e{(debugInfo.energy * 100).toFixed(0)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
