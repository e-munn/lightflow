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
    <div className="flex items-center gap-4">
      {/* Play/Pause */}
      <button
        onClick={audioState.isPlaying ? onPause : onPlay}
        disabled={!audioState.source}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-white text-black disabled:opacity-30 hover:bg-gray-200 transition-colors"
      >
        {audioState.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
      </button>

      {/* Time + Scrubber */}
      <div className="flex-1 flex items-center gap-3">
        <span className="text-xs text-gray-500 w-10 text-right">
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
        <span className="text-xs text-gray-500 w-10">
          {formatTime(duration)}
        </span>
      </div>

      {/* Section label */}
      {sectionLabel && (
        <span className="text-xs text-gray-400 uppercase tracking-wide bg-gray-800 px-2 py-1 rounded">
          {sectionLabel}
        </span>
      )}

      {/* BPM */}
      <div className="flex items-center gap-2">
        {bpm && (
          <span className="text-xs text-green-500 font-mono">
            {bpm.toFixed(0)} BPM
          </span>
        )}
        {/* Beat indicator */}
        <div
          className={`w-2 h-2 rounded-full transition-all duration-75 ${
            beatInfo.isBeat ? 'bg-white scale-150' : 'bg-gray-700'
          }`}
        />
      </div>

      {/* Analyzing indicator */}
      {isAnalyzing && (
        <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      )}

      {/* File picker */}
      <label className="cursor-pointer text-gray-500 hover:text-gray-300 transition-colors">
        <FolderOpen size={18} />
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileSelect(file);
          }}
        />
      </label>
    </div>
  );
}
