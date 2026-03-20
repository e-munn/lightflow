'use client';

import { useMemo } from 'react';
import { Section } from '@/types/v3';

interface TimelineViewProps {
  sections: Section[];
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  isAnalyzing: boolean;
}

const SECTION_COLORS: Record<string, string> = {
  intro: '#4b5563',
  verse: '#3b82f6',
  buildup: '#eab308',
  drop: '#ef4444',
  breakdown: '#8b5cf6',
  outro: '#6b7280',
};

export function TimelineView({
  sections,
  currentTime,
  duration,
  onSeek,
  isAnalyzing,
}: TimelineViewProps) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };

  if (isAnalyzing) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
          Analyzing...
        </div>
      </div>
    );
  }

  if (!sections.length) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-600 text-sm">
        Drop an audio file to analyze
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col gap-4">
      <h3 className="text-xs text-gray-500 uppercase tracking-wide">Song Structure</h3>

      {/* Sections bar */}
      <div
        className="relative h-16 bg-gray-900 rounded-lg overflow-hidden cursor-pointer"
        onClick={handleClick}
      >
        {sections.map((section, i) => {
          const left = (section.start / duration) * 100;
          const width = ((section.end - section.start) / duration) * 100;
          const color = SECTION_COLORS[section.label] || '#555';

          return (
            <div
              key={i}
              className="absolute top-0 h-full flex items-end pb-1 px-1"
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <div
                className="w-full h-full rounded-sm opacity-60"
                style={{ backgroundColor: color }}
              />
              <span className="absolute bottom-1 left-1 text-[9px] text-white/70 uppercase">
                {section.label}
              </span>
            </div>
          );
        })}

        {/* Playhead */}
        {duration > 0 && (
          <div
            className="absolute top-0 w-0.5 h-full bg-white z-10"
            style={{ left: `${(currentTime / duration) * 100}%` }}
          />
        )}
      </div>

      {/* Section details */}
      <div className="grid grid-cols-2 gap-2">
        {sections.map((section, i) => {
          const isCurrent = currentTime >= section.start && currentTime < section.end;
          const color = SECTION_COLORS[section.label] || '#555';
          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                isCurrent ? 'bg-gray-800 text-white' : 'text-gray-500'
              }`}
              onClick={() => onSeek(section.start)}
              style={{ cursor: 'pointer' }}
            >
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="uppercase">{section.label}</span>
              <span className="text-gray-600 ml-auto">
                {Math.floor(section.start / 60)}:{Math.floor(section.start % 60).toString().padStart(2, '0')}
              </span>
            </div>
          );
        })}
      </div>

      {/* Energy / bass meters */}
      <div className="space-y-2">
        <h3 className="text-xs text-gray-500 uppercase tracking-wide">Section Properties</h3>
        {sections
          .filter((s) => currentTime >= s.start && currentTime < s.end)
          .map((section, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16">Energy</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 rounded-full"
                    style={{ width: `${section.energy_level * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16">Bass</span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full"
                    style={{ width: `${section.bass_presence * 100}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-16">Vocals</span>
                <div
                  className={`w-2 h-2 rounded-full ${
                    section.has_vocals ? 'bg-blue-500' : 'bg-gray-700'
                  }`}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
