'use client';

import { useCallback, useState, useEffect, useRef } from 'react';
import { FlowEditor } from '@/components/FlowEditor';
import { useAudioAnalyzer } from '@/hooks/useAudioAnalyzer';

const STORAGE_KEY = 'lightflow_recent_audio';

interface StoredAudio {
  name: string;
  data: string; // base64
  type: string;
}

export default function Home() {
  const { audioState, loadAudioFile, play, pause, seek } = useAudioAnalyzer();
  const [isLoading, setIsLoading] = useState(false);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isolatedStem, setIsolatedStem] = useState<{ url: string; type: string } | null>(null);
  const lastPositionRef = useRef<number>(0);

  // Load recent audio from localStorage on mount
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    // Only restore once
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const restoreAudio = async () => {
        setIsLoading(true);
        try {
          const { name, data, type }: StoredAudio = JSON.parse(stored);
          // Convert base64 back to File
          const byteString = atob(data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type });
          const file = new File([blob], name, { type });

          // Auto-load the file
          setAudioFile(file);
          await loadAudioFile(file);
        } catch (err) {
          console.warn('Failed to restore recent audio:', err);
          localStorage.removeItem(STORAGE_KEY);
        } finally {
          setIsLoading(false);
        }
      };
      restoreAudio();
    }
  }, [loadAudioFile]);

  const handleFileSelect = useCallback(async (file: File) => {
    setIsLoading(true);
    setAudioFile(file);
    setIsolatedStem(null); // Clear any active isolate when new file selected

    try {
      await loadAudioFile(file);

      // Store in localStorage (limit to ~5MB files)
      if (file.size < 5 * 1024 * 1024) {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          const stored: StoredAudio = {
            name: file.name,
            data: base64,
            type: file.type,
          };
          localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
        };
        reader.readAsDataURL(file);
      }
    } finally {
      setIsLoading(false);
    }
  }, [loadAudioFile]);

  // Handle isolate toggle - switch between original and stem audio
  const handleIsolateChange = useCallback(async (stemUrl: string | null, stemType: string | null) => {
    const wasPlaying = audioState.isPlaying;
    const currentPos = audioState.currentTime;

    if (stemUrl && stemType) {
      // Switching to isolated stem
      setIsolatedStem({ url: stemUrl, type: stemType });
      lastPositionRef.current = currentPos;
      await loadAudioFile(stemUrl);
      seek(currentPos); // Restore position
      if (wasPlaying) {
        play();
      }
    } else {
      // Switching back to original file
      setIsolatedStem(null);
      if (audioFile) {
        lastPositionRef.current = currentPos;
        await loadAudioFile(audioFile);
        seek(currentPos); // Restore position
        if (wasPlaying) {
          play();
        }
      }
    }
  }, [audioFile, audioState.isPlaying, audioState.currentTime, loadAudioFile, seek, play]);

  return (
    <div className="h-screen bg-black">
      <FlowEditor
        onFileSelect={handleFileSelect}
        audioFile={audioFile}
        audioFileName={isolatedStem ? `${isolatedStem.type.toUpperCase()} (isolated)` : (audioFile?.name ?? null)}
        audioDuration={audioState.duration}
        currentTime={audioState.currentTime}
        isPlaying={audioState.isPlaying}
        isLoading={isLoading}
        onPlay={play}
        onPause={pause}
        onSeek={seek}
        onIsolateChange={handleIsolateChange}
      />
    </div>
  );
}
