'use client';

import { useRef } from 'react';
import { Play, Pause, FolderOpen } from 'lucide-react';
import { AudioState, BeatInfo } from '@/types/audio';

interface BottomBarProps {
  audioState: AudioState;
  beatInfo: BeatInfo;
  isAnalyzing?: boolean;
  isSeparating?: boolean;
  analyzedBpm?: number | null;
  onFileSelect: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
}

export function BottomBar({
  audioState,
  beatInfo,
  isAnalyzing,
  isSeparating,
  analyzedBpm,
  onFileSelect,
  onPlay,
  onPause,
}: BottomBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Use analyzed BPM if available, otherwise fall back to real-time detection
  const displayBpm = analyzedBpm ?? beatInfo.bpm;

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileSelect(file);
        }}
      />
      <div className="max-w-7xl mx-auto flex items-center gap-6">
        {/* Playback controls */}
        {audioState.source === 'file' && (
          <div className="flex items-center gap-3">
            <button
              onClick={audioState.isPlaying ? onPause : onPlay}
              className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform"
            >
              {audioState.isPlaying ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4 ml-0.5" />
              )}
            </button>

            <span className="text-sm text-gray-400 font-mono">
              {formatTime(audioState.currentTime)} / {formatTime(audioState.duration)}
            </span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right side stats */}
        <div className="flex items-center gap-4 text-sm">
          {/* Stem separation status */}
          {isSeparating && (
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-cyan-500">Separating stems...</span>
            </div>
          )}

          {/* BPM */}
          <div className="flex items-center gap-2">
            <span className="text-gray-500">BPM</span>
            <span className={`font-mono text-lg font-bold w-12 ${analyzedBpm ? 'text-green-400' : 'text-gray-300'}`}>
              {displayBpm ?? '--'}
            </span>
          </div>

          {/* Beat indicator */}
          <div
            className={`w-4 h-4 rounded-full transition-all duration-75 ${
              beatInfo.isBeat ? 'bg-red-500 scale-125' : 'bg-gray-700'
            }`}
          />

          {/* Open file button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isAnalyzing}
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
              isAnalyzing
                ? 'bg-gray-800 text-gray-500 cursor-not-allowed'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
            }`}
          >
            <FolderOpen className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
