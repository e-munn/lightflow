'use client';

import { useEffect, useCallback, useState, useRef, useMemo, DragEvent } from 'react';
import { LayoutList, Lightbulb, Layers, SlidersHorizontal } from 'lucide-react';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { Carousel } from '@/components/Carousel';
import { BottomBar } from '@/components/BottomBar';
import { TubePreview } from '@/components/TubePreview';
import { TimelineView } from '@/components/TimelineView';
import { EffectList } from '@/components/EffectList';
import { analyzeAudio, generateShow } from '@/lib/api';
import {
  AnalysisResult, ShowPlan, SectionPlan, StemFrame,
  EffectContext, Grid, NUM_TUBES, PIXELS_PER_TUBE,
} from '@/types/v3';
import { renderSectionFrame, applyGlow, resetSmoothing } from '@/lib/effects';

export default function Home() {
  const { frequencyData, audioState, loadAudioFile, play, pause, seek } = useAudioAnalyzer();

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [show, setShow] = useState<ShowPlan | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [grid, setGrid] = useState<Grid | null>(null);

  const lastFrameTimeRef = useRef(0);

  // Find current section from show plan
  const currentSection = useMemo((): SectionPlan | null => {
    if (!show) return null;
    const t = audioState.currentTime;
    return show.sections.find((s) => t >= s.start && t < s.end) || null;
  }, [show, audioState.currentTime]);

  // Find current section label
  const sectionLabel = useMemo(() => {
    if (!analysis) return null;
    const t = audioState.currentTime;
    const sec = analysis.sections.find((s) => t >= s.start && t < s.end);
    return sec?.label || null;
  }, [analysis, audioState.currentTime]);

  // Find nearest analysis frame for current time
  const currentFrame = useMemo((): StemFrame | null => {
    if (!analysis?.frames.length) return null;
    const t = audioState.currentTime;
    // Binary search
    let lo = 0, hi = analysis.frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (analysis.frames[mid].time < t) lo = mid + 1;
      else hi = mid;
    }
    return analysis.frames[lo] || null;
  }, [analysis, audioState.currentTime]);

  // Render effects each frame
  useEffect(() => {
    if (!currentSection || !currentFrame || !analysis || !audioState.isPlaying) return;

    const now = performance.now();
    const dt = (now - lastFrameTimeRef.current) / 1000;
    lastFrameTimeRef.current = now;

    const ctx: EffectContext = {
      frame: currentFrame,
      time: audioState.currentTime,
      bpm: analysis.bpm,
      dt: Math.min(dt, 0.1), // cap to avoid huge jumps
      beatPhase: (audioState.currentTime * analysis.bpm / 60) % 1,
      barPhase: (audioState.currentTime * analysis.bpm / 60 / 4) % 1,
    };

    const rendered = renderSectionFrame(currentSection.effects, ctx);
    const glowed = applyGlow(rendered, 0.3);
    setGrid(glowed);
  }, [currentSection, currentFrame, analysis, audioState.currentTime, audioState.isPlaying]);

  // File handling
  const handleFileSelect = useCallback(async (file: File) => {
    setAnalysis(null);
    setShow(null);
    setGrid(null);
    resetSmoothing();
    setIsAnalyzing(true);

    try {
      const [, analysisResult] = await Promise.all([
        loadAudioFile(file),
        analyzeAudio(file).catch((err) => {
          console.warn('Analysis failed:', err);
          return null;
        }),
      ]);

      if (analysisResult) {
        setAnalysis(analysisResult);
        // Auto-generate show
        try {
          const showResult = await generateShow(JSON.stringify(analysisResult));
          setShow(showResult);
        } catch (err) {
          console.warn('Show generation failed:', err);
        }
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadAudioFile]);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.relatedTarget === null) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file?.type.startsWith('audio/')) handleFileSelect(file);
  }, [handleFileSelect]);

  const carouselItems = [
    {
      id: 'source',
      label: 'Source',
      icon: LayoutList,
      render: () => (
        <div className="h-full p-6">
          <TimelineView
            sections={analysis?.sections || []}
            currentTime={audioState.currentTime}
            duration={audioState.duration}
            onSeek={seek}
            isAnalyzing={isAnalyzing}
          />
        </div>
      ),
    },
    {
      id: 'tubes',
      label: 'Tubes',
      icon: Lightbulb,
      render: () => (
        <div className="h-full p-4">
          <TubePreview grid={grid} />
        </div>
      ),
    },
    {
      id: 'effects',
      label: 'Effects',
      icon: Layers,
      render: () => (
        <div className="h-full">
          <EffectList
            currentSection={currentSection}
            allSections={show?.sections || []}
          />
        </div>
      ),
    },
  ];

  return (
    <div
      className="h-screen flex flex-col bg-black text-white overflow-hidden relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-white/50 rounded-2xl p-12 text-center">
            <div className="text-2xl font-bold mb-2">Drop audio file</div>
            <div className="text-gray-400">MP3, WAV, M4A, FLAC, OGG</div>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-hidden">
        <Carousel items={carouselItems} />
      </main>

      <div className="px-8 pb-6 pt-2 shrink-0">
        <BottomBar
          audioState={audioState}
          beatInfo={{ isBeat: false, bpm: null, confidence: 0, lastBeatTime: 0, timeSinceLastBeat: 9999 }}
          isAnalyzing={isAnalyzing}
          bpm={analysis?.bpm || null}
          sectionLabel={sectionLabel}
          onFileSelect={handleFileSelect}
          onPlay={play}
          onPause={pause}
          onSeek={seek}
          duration={audioState.duration}
        />
      </div>
    </div>
  );
}
