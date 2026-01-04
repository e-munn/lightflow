'use client';

import { useEffect, useCallback, useState, DragEvent } from 'react';
import { LayoutList, Activity, Box, SlidersHorizontal, GitBranch } from 'lucide-react';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';
import { useBeatDetector } from '@/hooks/useBeatDetector';
import { useVibeAnalyzer } from '@/hooks/useVibeAnalyzer';
import { StageScene } from '@/components/StageScene';
import { VibeVisualizer } from '@/components/VibeVisualizer';
import { MixerView } from '@/components/MixerView';
import { FlowEditor } from '@/components/FlowEditor';
import { BottomBar } from '@/components/BottomBar';
import { TimelineView } from '@/components/TimelineView';
import { Carousel } from '@/components/Carousel';
import { analyzeAudio, startStemSeparation, waitForStemSeparation, StemSeparationResult } from '@/lib/api';
import { AudioAnalysis } from '@/types/analysis';

const TEST_SONGS = [
  { name: 'Go 1', url: '/test-songs/go-1.m4a' },
];

export default function Home() {
  const {
    frequencyData,
    audioState,
    loadAudioFile,
    startMicrophone,
    stopMicrophone,
    play,
    pause,
    seek,
  } = useAudioAnalyzer();

  const { beatInfo, detectBeat, reset: resetBeatDetector } = useBeatDetector();
  const { vibeState, analyzeVibe, reset: resetVibeAnalyzer } = useVibeAnalyzer();

  // Pre-computed analysis state
  const [analysis, setAnalysis] = useState<AudioAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  // Stem separation state
  const [stems, setStems] = useState<StemSeparationResult | null>(null);
  const [isSeparating, setIsSeparating] = useState(false);
  const [currentFile, setCurrentFile] = useState<File | null>(null);

  // Run beat detection and vibe analysis on each frame
  useEffect(() => {
    if (frequencyData) {
      const beat = detectBeat(frequencyData);
      analyzeVibe(frequencyData, beat);
    }
  }, [frequencyData, detectBeat, analyzeVibe]);

  // Start stem separation for current file
  const handleStemSeparation = useCallback(async (file: File) => {
    setIsSeparating(true);
    setStems(null);

    try {
      const { job_id } = await startStemSeparation(file);
      if (job_id) {
        const result = await waitForStemSeparation(job_id, (status) => {
          console.log('Stem separation status:', status);
        });
        if (result.status === 'complete') {
          setStems(result);
        } else {
          console.warn('Stem separation failed:', result.error);
        }
      }
    } catch (err) {
      console.warn('Stem separation error:', err);
    } finally {
      setIsSeparating(false);
    }
  }, []);

  const handleFileSelect = useCallback(async (file: File) => {
    resetBeatDetector();
    resetVibeAnalyzer();
    setAnalysis(null);
    setStems(null);
    setCurrentFile(file);
    setIsAnalyzing(true);

    try {
      // Start analysis in parallel with loading
      const analysisPromise = analyzeAudio(file).catch((err) => {
        console.warn('Backend analysis failed:', err);
        return null;
      });

      // Load the audio file for playback
      await loadAudioFile(file);

      // Wait for analysis to complete
      const result = await analysisPromise;
      console.log('Analysis result:', result);
      if (result?.success) {
        console.log('Setting analysis - energy points:', result.energy?.length, 'beats:', result.beats?.length);
        setAnalysis(result);

        // Start stem separation in background (optional, can be triggered manually)
        handleStemSeparation(file);
      } else {
        console.log('Analysis failed or no result');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadAudioFile, resetBeatDetector, resetVibeAnalyzer, handleStemSeparation]);

  const handleTestSongSelect = useCallback(async (url: string) => {
    resetBeatDetector();
    resetVibeAnalyzer();
    setAnalysis(null);
    setStems(null);
    setIsAnalyzing(true);

    try {
      // Fetch the file for analysis
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], 'test-song.m4a', { type: blob.type });
      setCurrentFile(file);

      // Start analysis
      const analysisPromise = analyzeAudio(file).catch((err) => {
        console.warn('Backend analysis failed:', err);
        return null;
      });

      // Load for playback
      await loadAudioFile(url);

      // Wait for analysis
      const result = await analysisPromise;
      console.log('Test song analysis result:', result);
      if (result?.success) {
        console.log('Setting analysis - energy points:', result.energy?.length, 'beats:', result.beats?.length);
        setAnalysis(result);

        // Start stem separation in background
        handleStemSeparation(file);
      } else {
        console.log('Analysis failed or no result');
      }
    } finally {
      setIsAnalyzing(false);
    }
  }, [loadAudioFile, resetBeatDetector, resetVibeAnalyzer, handleStemSeparation]);

  const handleMicStart = useCallback(async () => {
    resetBeatDetector();
    resetVibeAnalyzer();
    setAnalysis(null);
    await startMicrophone();
  }, [startMicrophone, resetBeatDetector, resetVibeAnalyzer]);

  // Global drag and drop handlers
  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if we're leaving the window
    if (e.relatedTarget === null) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  // Carousel items with render functions for lazy loading
  const carouselItems = [
    {
      id: 'source',
      label: 'Source',
      icon: LayoutList,
      render: () => (
        <div className="h-full p-6">
          <TimelineView
            analysis={analysis}
            stems={stems}
            currentTime={audioState.currentTime}
            duration={audioState.duration}
            isAnalyzing={isAnalyzing}
            isSeparating={isSeparating}
            onSeek={seek}
          />
        </div>
      ),
    },
    {
      id: 'light',
      label: 'Light',
      icon: Activity,
      render: () => (
        <div className="h-full p-6">
          <VibeVisualizer
            analysis={analysis}
            stems={stems}
            currentTime={audioState.currentTime}
          />
        </div>
      ),
    },
    {
      id: 'mixer',
      label: 'Mixer',
      icon: SlidersHorizontal,
      render: () => (
        <div className="h-full">
          <MixerView
            analysis={analysis}
            stems={stems}
            currentTime={audioState.currentTime}
          />
        </div>
      ),
    },
    {
      id: 'flow',
      label: 'Flow',
      icon: GitBranch,
      render: () => (
        <div className="h-full p-4">
          <FlowEditor
            analysis={analysis}
            stems={stems}
            currentTime={audioState.currentTime}
          />
        </div>
      ),
    },
    {
      id: 'scene',
      label: 'Scene',
      icon: Box,
      render: () => (
        <div className="h-full p-6">
          <StageScene
            frequencyData={frequencyData}
            beatInfo={beatInfo}
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
      {/* Drag overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center pointer-events-none">
          <div className="border-2 border-dashed border-white/50 rounded-2xl p-12 text-center">
            <div className="text-2xl font-bold mb-2">Drop audio file</div>
            <div className="text-gray-400">MP3, WAV, M4A, FLAC, OGG</div>
          </div>
        </div>
      )}

      {/* Main content - Carousel */}
      <main className="flex-1 overflow-hidden">
        <Carousel items={carouselItems} />
      </main>

      {/* Bottom section - Controls */}
      <div className="px-8 pb-6 pt-2 shrink-0">
        {/* Bottom bar - Controls & Stats */}
        <BottomBar
          audioState={audioState}
          beatInfo={beatInfo}
          isAnalyzing={isAnalyzing}
          analyzedBpm={analysis?.bpm ?? null}
          onFileSelect={handleFileSelect}
          onPlay={play}
          onPause={pause}
          isSeparating={isSeparating}
        />
      </div>
    </div>
  );
}
