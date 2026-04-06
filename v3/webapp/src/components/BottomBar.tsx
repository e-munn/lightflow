'use client';

import { Play, Pause, FolderOpen } from 'lucide-react';
import { AudioState, BeatInfo } from '@/types/audio';

interface BottomBarProps {
  audioState: AudioState;
  beatInfo: BeatInfo;
  isAnalyzing: boolean;
  bpm: number | null;
  sectionLabel: string | null;
  onFileSelect: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (time: number) => void;
  duration: number;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export function BottomBar({
  audioState,
  beatInfo,
  isAnalyzing,
  bpm,
  sectionLabel,
  onFileSelect,
  onPlay,
  onPause,
  onSeek,
  duration,
}: BottomBarProps) {
  return (
    <div className="space-y-2">
      {/* Scrubber */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-gray-500 w-8 text-right font-mono">
          {formatTime(audioState.currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={audioState.currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-white"
        />
        <span className="text-[10px] text-gray-500 w-8 font-mono">
          {formatTime(duration)}
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          onClick={audioState.isPlaying ? onPause : onPlay}
          disabled={!audioState.source}
          className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black disabled:opacity-30 hover:bg-gray-200 transition-colors active:scale-95"
        >
          {audioState.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        {/* Section label */}
        <div className="flex-1 min-w-0">
          {sectionLabel && (
            <span className="text-xs text-gray-400 uppercase tracking-wide bg-gray-900 px-2 py-1 rounded">
              {sectionLabel}
            </span>
          )}
        </div>

        {/* BPM */}
        {bpm && (
          <span className="text-xs text-green-500 font-mono">
            {bpm.toFixed(0)}
          </span>
        )}

        {/* File picker */}
        <label className="cursor-pointer text-gray-500 hover:text-gray-300 transition-colors active:scale-95">
          <FolderOpen size={18} />
          <input
            type="file"
            accept="audio/*,.json"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files) {
                Array.from(files).forEach((f) => onFileSelect(f));
              }
            }}
          />
        </label>
      </div>
    </div>
  );
}
