'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { FrequencyData, FrequencyBands, AudioState } from '@/types/audio';

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;
const UPDATE_INTERVAL = 1000 / 30; // 30fps

function calculateBands(dataArray: Uint8Array, sampleRate: number): FrequencyBands {
  const nyquist = sampleRate / 2;
  const binSize = nyquist / (dataArray.length);

  function bandAvg(low: number, high: number): number {
    const startBin = Math.floor(low / binSize);
    const endBin = Math.min(Math.ceil(high / binSize), dataArray.length - 1);
    if (startBin >= endBin) return 0;
    let sum = 0;
    for (let i = startBin; i <= endBin; i++) sum += dataArray[i] / 255;
    return sum / (endBin - startBin + 1);
  }

  return {
    subBass: bandAvg(20, 60),
    bass: bandAvg(60, 250),
    lowMid: bandAvg(250, 500),
    mid: bandAvg(500, 2000),
    highMid: bandAvg(2000, 4000),
    high: bandAvg(4000, 20000),
  };
}

export function useAudioAnalyzer() {
  const [frequencyData, setFrequencyData] = useState<FrequencyData | null>(null);
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    source: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number>(0);
  const lastUpdateRef = useRef<number>(0);

  const updateAnalysis = useCallback(() => {
    const analyser = analyserRef.current;
    const audioEl = audioElementRef.current;

    if (analyser && audioEl && !audioEl.paused) {
      const now = performance.now();
      if (now - lastUpdateRef.current >= UPDATE_INTERVAL) {
        lastUpdateRef.current = now;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);

        const ctx = audioContextRef.current;
        const sampleRate = ctx?.sampleRate || 44100;
        const bands = calculateBands(dataArray, sampleRate);
        const energy = (bands.subBass + bands.bass + bands.lowMid + bands.mid + bands.highMid + bands.high) / 6;

        setFrequencyData({ raw: dataArray, bands, energy });
        setAudioState((prev) => ({
          ...prev,
          currentTime: audioEl.currentTime,
          isPlaying: !audioEl.paused,
        }));
      }
    }

    animFrameRef.current = requestAnimationFrame(updateAnalysis);
  }, []);

  const loadAudioFile = useCallback(async (fileOrUrl: File | string) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    const ctx = audioContextRef.current;

    if (!analyserRef.current) {
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = FFT_SIZE;
      analyserRef.current.smoothingTimeConstant = SMOOTHING;
      analyserRef.current.connect(ctx.destination);
    }

    // Clean up old source
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      URL.revokeObjectURL(audioElementRef.current.src);
    }

    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    if (typeof fileOrUrl === 'string') {
      audio.src = fileOrUrl;
    } else {
      audio.src = URL.createObjectURL(fileOrUrl);
    }

    await new Promise<void>((resolve) => {
      audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
    });

    audioElementRef.current = audio;
    const source = ctx.createMediaElementSource(audio);
    source.connect(analyserRef.current!);
    sourceNodeRef.current = source;

    setAudioState({
      isPlaying: false,
      currentTime: 0,
      duration: audio.duration,
      source: 'file',
    });

    // Start analysis loop
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(updateAnalysis);
  }, [updateAnalysis]);

  const play = useCallback(() => {
    audioContextRef.current?.resume();
    audioElementRef.current?.play();
    setAudioState((prev) => ({ ...prev, isPlaying: true }));
  }, []);

  const pause = useCallback(() => {
    audioElementRef.current?.pause();
    setAudioState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const seek = useCallback((time: number) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = time;
      setAudioState((prev) => ({ ...prev, currentTime: time }));
    }
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      audioElementRef.current?.pause();
    };
  }, []);

  return { frequencyData, audioState, loadAudioFile, play, pause, seek };
}
