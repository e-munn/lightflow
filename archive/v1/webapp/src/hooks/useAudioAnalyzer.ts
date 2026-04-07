'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { FrequencyData, FrequencyBands, AudioState } from '@/types/audio';

const FFT_SIZE = 2048;
const SMOOTHING = 0.8;

// Frequency ranges for each band (approximate bin indices for 44.1kHz sample rate)
function calculateBands(dataArray: Uint8Array, sampleRate: number): FrequencyBands {
  const nyquist = sampleRate / 2;
  const binCount = dataArray.length;
  const binWidth = nyquist / binCount;

  const getBandAverage = (lowFreq: number, highFreq: number): number => {
    const lowBin = Math.floor(lowFreq / binWidth);
    const highBin = Math.min(Math.ceil(highFreq / binWidth), binCount - 1);

    let sum = 0;
    let count = 0;
    for (let i = lowBin; i <= highBin; i++) {
      sum += dataArray[i];
      count++;
    }
    return count > 0 ? (sum / count) / 255 : 0;
  };

  return {
    subBass: getBandAverage(20, 60),
    bass: getBandAverage(60, 250),
    lowMid: getBandAverage(250, 500),
    mid: getBandAverage(500, 2000),
    highMid: getBandAverage(2000, 4000),
    high: getBandAverage(4000, 20000),
  };
}

export function useAudioAnalyzer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const UPDATE_INTERVAL = 1000 / 30; // Throttle state updates to 30fps

  const [frequencyData, setFrequencyData] = useState<FrequencyData | null>(null);
  const [audioState, setAudioState] = useState<AudioState>({
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    source: null,
  });

  // Initialize audio context
  const initAudioContext = useCallback(() => {
    // Create new context if none exists or if existing one is closed
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      // Reset analyser when context is recreated
      analyserRef.current = null;
    }

    if (!analyserRef.current) {
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = FFT_SIZE;
      analyserRef.current.smoothingTimeConstant = SMOOTHING;
      dataArrayRef.current = new Uint8Array(analyserRef.current.frequencyBinCount);
    }

    return { audioContext: audioContextRef.current, analyser: analyserRef.current };
  }, []);

  // Animation loop for frequency data
  const startAnalysis = useCallback(() => {
    // Prevent multiple overlapping animation loops
    if (animationFrameRef.current) return;

    const analyze = (timestamp: number) => {
      // Throttle state updates to reduce re-renders
      const shouldUpdate = timestamp - lastUpdateRef.current >= UPDATE_INTERVAL;

      if (analyserRef.current && dataArrayRef.current && audioContextRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);

        if (shouldUpdate) {
          lastUpdateRef.current = timestamp;

          const bands = calculateBands(dataArrayRef.current, audioContextRef.current.sampleRate);
          const energy = Object.values(bands).reduce((a, b) => a + b, 0) / 6;

          setFrequencyData({
            raw: new Uint8Array(dataArrayRef.current),
            bands,
            energy,
          });

          // Update current time for file playback
          if (audioElementRef.current) {
            setAudioState(prev => ({
              ...prev,
              currentTime: audioElementRef.current?.currentTime ?? 0,
            }));
          }
        }
      }
      animationFrameRef.current = requestAnimationFrame(analyze);
    };
    animationFrameRef.current = requestAnimationFrame(analyze);
  }, []);

  const stopAnalysis = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Load and play audio file
  const loadAudioFile = useCallback(async (file: File | string) => {
    const { audioContext, analyser } = initAudioContext();

    // Clean up previous sources - MUST disconnect to prevent audio layering
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {}
      if ('stop' in sourceRef.current) {
        try { sourceRef.current.stop(); } catch {}
      }
      sourceRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.src = '';
      audioElementRef.current = null;
    }

    // Disconnect analyser from destination to prevent multiple connections
    try {
      analyser.disconnect();
    } catch {}

    // Resume context if suspended
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Create audio element for file playback (better for seeking/controls)
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';

    if (typeof file === 'string') {
      audio.src = file;
    } else {
      audio.src = URL.createObjectURL(file);
    }

    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve();
      audio.onerror = () => reject(new Error('Failed to load audio file'));
    });

    const source = audioContext.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    audioElementRef.current = audio;
    sourceRef.current = source;

    setAudioState({
      isPlaying: false,
      currentTime: 0,
      duration: audio.duration,
      source: 'file',
    });

    audio.onended = () => {
      setAudioState(prev => ({ ...prev, isPlaying: false }));
      stopAnalysis();
    };

  }, [initAudioContext, stopAnalysis]);

  // Start microphone input
  const startMicrophone = useCallback(async () => {
    const { audioContext, analyser } = initAudioContext();

    // Clean up previous sources
    if (sourceRef.current && 'stop' in sourceRef.current) {
      try { sourceRef.current.stop(); } catch {}
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    // Don't connect to destination to avoid feedback

    sourceRef.current = source;

    setAudioState({
      isPlaying: true,
      currentTime: 0,
      duration: 0,
      source: 'microphone',
    });

    startAnalysis();
  }, [initAudioContext, startAnalysis]);

  // Stop microphone
  const stopMicrophone = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    stopAnalysis();
    setAudioState(prev => ({ ...prev, isPlaying: false, source: null }));
    setFrequencyData(null);
  }, [stopAnalysis]);

  // Playback controls
  const play = useCallback(async () => {
    if (audioElementRef.current) {
      // Handle closed or suspended audio context
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        // Context was closed, need to reload the audio to reconnect
        const currentSrc = audioElementRef.current.src;
        const currentTime = audioElementRef.current.currentTime;
        await loadAudioFile(currentSrc);
        if (audioElementRef.current) {
          audioElementRef.current.currentTime = currentTime;
        }
      } else if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      await audioElementRef.current.play();
      setAudioState(prev => ({ ...prev, isPlaying: true }));
      startAnalysis();
    }
  }, [startAnalysis, loadAudioFile]);

  const pause = useCallback(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      setAudioState(prev => ({ ...prev, isPlaying: false }));
      stopAnalysis();
    }
  }, [stopAnalysis]);

  const seek = useCallback((time: number) => {
    if (audioElementRef.current) {
      audioElementRef.current.currentTime = time;
      setAudioState(prev => ({ ...prev, currentTime: time }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAnalysis();
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
      }
      // Only close if not already closed
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {
          // Ignore errors if context is already closed
        });
      }
    };
  }, [stopAnalysis]);

  return {
    frequencyData,
    audioState,
    loadAudioFile,
    startMicrophone,
    stopMicrophone,
    play,
    pause,
    seek,
  };
}
