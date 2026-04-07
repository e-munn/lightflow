'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { AudioAnalysis, TimeSeriesPoint, Segment } from '@/types/analysis';
import { StemSeparationResult } from '@/lib/api';

// Zoom state type
interface ZoomState {
  start: number;
  end: number;
}

interface TimelineViewProps {
  analysis: AudioAnalysis | null;
  stems: StemSeparationResult | null;
  currentTime: number;
  duration: number;
  isAnalyzing?: boolean;
  isSeparating?: boolean;
  onSeek: (time: number) => void;
}

// Stem configuration - slate color palette (priority order: bass, drums, vocals)
const STEM_CONFIG = [
  { key: 'bass', label: 'Bass', color: '#e2e8f0' },      // slate-200 (brightest - most important)
  { key: 'drums', label: 'Drums', color: '#94a3b8' },    // slate-400
  { key: 'vocals', label: 'Vocals', color: '#cbd5e1' },  // slate-300
] as const;

// Compute light output from stems (same logic as VibeVisualizer router)
function computeLightOutput(stems: StemSeparationResult | null, numPoints: number, duration: number): TimeSeriesPoint[] {
  if (!stems?.stems) return [];

  const output: TimeSeriesPoint[] = [];
  const step = duration / numPoints;

  for (let i = 0; i < numPoints; i++) {
    const time = i * step;

    // Get stem values at this time
    const getVal = (data: TimeSeriesPoint[] | undefined): number => {
      if (!data || data.length === 0) return 0;
      for (let j = 0; j < data.length - 1; j++) {
        if (data[j + 1].time > time) {
          const t0 = data[j].time;
          const t1 = data[j + 1].time;
          const v0 = data[j].value;
          const v1 = data[j + 1].value;
          const t = (time - t0) / (t1 - t0);
          return v0 + t * (v1 - v0);
        }
      }
      return data[data.length - 1].value;
    };

    const bass = getVal(stems.stems.bass);
    const drums = getVal(stems.stems.drums);
    const vocals = getVal(stems.stems.vocals);

    // Same blend as router: bass 50%, drums 35%, vocals 15%
    const blended = bass * 0.5 + drums * 0.35 + vocals * 0.15;
    output.push({ time, value: Math.min(1, blended) });
  }

  return output;
}

// Segment colors - Tailwind palette (for song sections 0, 1, 2, 3, ...)
const SEGMENT_COLORS = [
  '#3b82f6', // blue-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#8b5cf6', // violet-500
  '#ec4899', // pink-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
] as const;

// Tailwind color constants
const COLORS = {
  // Backgrounds
  bgDark: '#030712',      // gray-950
  bgMedium: '#111827',    // gray-900
  bgLight: '#1f2937',     // gray-800

  // Waveform
  waveformDark: '#4b5563',   // gray-600
  waveformMid: '#374151',    // gray-700
  waveformLight: '#9ca3af',  // gray-400
  waveformPlayed: '#f3f4f6', // gray-100
  waveformPlayedMid: '#d1d5db', // gray-300

  // UI elements
  textPrimary: '#f3f4f6',  // gray-100
  textSecondary: '#9ca3af', // gray-400
  textMuted: '#6b7280',    // gray-500
  border: '#374151',       // gray-700
  beatTick: '#ef4444',     // red-500
  playhead: '#ffffff',     // white
} as const;

export function TimelineView({
  analysis,
  stems,
  currentTime,
  duration,
  isAnalyzing,
  isSeparating,
  onSeek,
}: TimelineViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Zoom state - visible time range
  const effectiveDuration = analysis?.duration || duration || 1;
  const [zoomState, setZoomState] = useState<ZoomState>({ start: 0, end: effectiveDuration });
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Reset zoom when duration changes
  useEffect(() => {
    setZoomState({ start: 0, end: effectiveDuration });
  }, [effectiveDuration]);

  // Track container dimensions
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setDimensions({ width: rect.width, height: rect.height });
        }
      }
    };

    const timer = setTimeout(updateDimensions, 50);
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !dimensions.width || !dimensions.height) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = dimensions;

    const margin = { top: 20, right: 20, bottom: 30, left: 70 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Fixed track height of 40px for all timelines
    const trackHeight = 40;
    const sectionGap = 16;
    const segmentBarHeight = 24;

    // Calculate section heights based on track count (no section headers)
    // Audio: 1 track
    // Sections: 1 track
    // Stems: 3 tracks (bass, drums, vocals)
    // Light: 1 track (router output)
    const waveformHeight = trackHeight;
    const sectionsHeight = trackHeight;
    const stemsHeight = trackHeight * 3;
    const lightOutputHeight = trackHeight;

    // Clear previous content
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const defs = svg.append('defs');

    // Time scale (shared) - uses zoom state for visible range
    const xScale = d3.scaleLinear()
      .domain([zoomState.start, zoomState.end])
      .range([0, innerWidth]);

    // Full scale for zoom calculations
    const fullXScale = d3.scaleLinear()
      .domain([0, effectiveDuration])
      .range([0, innerWidth]);

    // Click handler for seeking
    const handleClick = (event: MouseEvent) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left - margin.left;
      const time = xScale.invert(x);
      onSeek(Math.max(0, Math.min(effectiveDuration, time)));
    };

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // === SECTION 1: WAVEFORM ===
    const waveformY = 0;
    const waveformG = g.append('g').attr('transform', `translate(0, ${waveformY})`);

    // Label on left side
    waveformG.append('text')
      .attr('x', -8)
      .attr('y', trackHeight / 2 + 3)
      .attr('fill', COLORS.textSecondary)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', 'end')
      .text('AUDIO');

    // Click handler area (invisible)
    waveformG.append('rect')
      .attr('width', innerWidth)
      .attr('height', waveformHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('click', handleClick as unknown as (event: unknown) => void);

    const waveformContent = waveformG;
    const waveformAreaTop = 0;
    const waveformAreaHeight = trackHeight;

    if (analysis?.energy && analysis.energy.length > 0) {
      const energyData = analysis.energy;

      // Single area from bottom, scaled to fit below segment bar
      const area = d3.area<TimeSeriesPoint>()
        .x(d => xScale(d.time))
        .y0(waveformAreaHeight)
        .y1(d => waveformAreaTop + waveformAreaHeight * (1 - d.value * 0.95))
        .curve(d3.curveMonotoneX);

      // Gradients
      const gradient = defs.append('linearGradient')
        .attr('id', 'waveformGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      gradient.append('stop').attr('offset', '0%').attr('stop-color', COLORS.waveformLight);
      gradient.append('stop').attr('offset', '100%').attr('stop-color', COLORS.waveformMid);

      const playedGradient = defs.append('linearGradient')
        .attr('id', 'playedGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      playedGradient.append('stop').attr('offset', '0%').attr('stop-color', COLORS.waveformPlayed);
      playedGradient.append('stop').attr('offset', '100%').attr('stop-color', COLORS.waveformPlayedMid);

      // Unplayed waveform
      waveformContent.append('path').datum(energyData).attr('d', area)
        .attr('fill', 'url(#waveformGradient)').attr('opacity', 0.6);

      // Played clip
      defs.append('clipPath').attr('id', 'playedClip')
        .append('rect').attr('x', 0).attr('y', 0)
        .attr('width', xScale(currentTime)).attr('height', waveformHeight);

      const playedGroup = waveformContent.append('g').attr('clip-path', 'url(#playedClip)');
      playedGroup.append('path').datum(energyData).attr('d', area)
        .attr('fill', 'url(#playedGradient)').attr('opacity', 0.9);

      // Beat ticks at bottom of waveform area
      if (analysis?.beats && analysis.beats.length > 0) {
        waveformContent.selectAll('.beat-tick')
          .data(analysis.beats)
          .enter()
          .append('line')
          .attr('x1', d => xScale(d))
          .attr('x2', d => xScale(d))
          .attr('y1', waveformHeight - 6)
          .attr('y2', waveformHeight)
          .attr('stroke', COLORS.beatTick)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.7);
      }

      // BPM badge
      if (analysis?.bpm) {
        const bpmGroup = waveformContent.append('g')
          .attr('transform', `translate(${innerWidth - 55}, 4)`);
        bpmGroup.append('rect')
          .attr('width', 50).attr('height', 18).attr('rx', 3).attr('fill', COLORS.bgMedium);
        bpmGroup.append('text')
          .attr('x', 25).attr('y', 13)
          .attr('fill', COLORS.textSecondary)
          .attr('font-size', '11px')
          .attr('font-family', 'monospace')
          .attr('text-anchor', 'middle')
          .text(`${analysis.bpm} BPM`);
      }
    }

    // Playhead for waveform
    waveformContent.append('line')
      .attr('x1', xScale(currentTime))
      .attr('x2', xScale(currentTime))
      .attr('y1', 0)
      .attr('y2', waveformHeight)
      .attr('stroke', COLORS.playhead)
      .attr('stroke-width', 2);

    // === SECTION 2: SECTIONS ===
    const sectionsY = waveformHeight + sectionGap;
    const sectionsG = g.append('g').attr('transform', `translate(0, ${sectionsY})`);

    // Label on left side
    sectionsG.append('text')
      .attr('x', -8)
      .attr('y', trackHeight / 2 + 3)
      .attr('fill', COLORS.textMuted)
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', 'end')
      .text('SECTIONS');

    // Click handler area (invisible)
    sectionsG.append('rect')
      .attr('width', innerWidth)
      .attr('height', sectionsHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('click', handleClick as unknown as (event: unknown) => void);

    // Draw section blocks
    if (analysis?.segments && analysis.segments.length > 0) {
      analysis.segments.forEach((segment) => {
        const x = xScale(segment.start);
        const segWidth = xScale(segment.end) - xScale(segment.start);
        const color = SEGMENT_COLORS[segment.label % SEGMENT_COLORS.length];

        // Section block
        sectionsG.append('rect')
          .attr('x', x)
          .attr('y', 2)
          .attr('width', Math.max(segWidth - 1, 1))
          .attr('height', trackHeight - 4)
          .attr('fill', color)
          .attr('opacity', 0.5)
          .attr('rx', 3);

        // Section label
        if (segWidth > 30) {
          sectionsG.append('text')
            .attr('x', x + segWidth / 2)
            .attr('y', trackHeight / 2 + 4)
            .attr('fill', COLORS.textPrimary)
            .attr('font-size', '12px')
            .attr('font-weight', 'bold')
            .attr('text-anchor', 'middle')
            .text(segment.label);
        }

        // Section boundary line
        if (segment.start > 0) {
          sectionsG.append('line')
            .attr('x1', x)
            .attr('x2', x)
            .attr('y1', 0)
            .attr('y2', trackHeight)
            .attr('stroke', color)
            .attr('stroke-width', 2)
            .attr('opacity', 0.8);
        }
      });
    }

    // Playhead for sections
    sectionsG.append('line')
      .attr('x1', xScale(currentTime))
      .attr('x2', xScale(currentTime))
      .attr('y1', 0)
      .attr('y2', sectionsHeight)
      .attr('stroke', COLORS.playhead)
      .attr('stroke-width', 2);

    // === SECTION 3: STEMS ===
    const stemsY = waveformHeight + sectionsHeight + sectionGap * 2;
    const stemsG = g.append('g').attr('transform', `translate(0, ${stemsY})`);

    // Click handler area (invisible)
    stemsG.append('rect')
      .attr('width', innerWidth)
      .attr('height', stemsHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('click', handleClick as unknown as (event: unknown) => void);

    STEM_CONFIG.forEach((stem, i) => {
      const rowY = i * trackHeight;
      const data = stems?.stems?.[stem.key as keyof typeof stems.stems] as TimeSeriesPoint[] | undefined;

      const rowG = stemsG.append('g').attr('transform', `translate(0, ${rowY})`);

      // Row separator
      if (i > 0) {
        rowG.append('line')
          .attr('x1', 0).attr('x2', innerWidth)
          .attr('y1', 0).attr('y2', 0)
          .attr('stroke', COLORS.bgLight)
          .attr('stroke-width', 1);
      }

      // Label on left side (in margin)
      rowG.append('text')
        .attr('x', -8)
        .attr('y', trackHeight / 2 + 3)
        .attr('fill', stem.color)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('text-anchor', 'end')
        .text(stem.label.toUpperCase());

      if (data && data.length > 0) {
        const yScale = d3.scaleLinear()
          .domain([0, 1])
          .range([trackHeight - 2, 2]);

        const area = d3.area<TimeSeriesPoint>()
          .x(d => xScale(d.time))
          .y0(trackHeight)
          .y1(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        rowG.append('path')
          .datum(data)
          .attr('d', area)
          .attr('fill', stem.color)
          .attr('opacity', 0.3);

        const line = d3.line<TimeSeriesPoint>()
          .x(d => xScale(d.time))
          .y(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        rowG.append('path')
          .datum(data)
          .attr('d', line)
          .attr('fill', 'none')
          .attr('stroke', stem.color)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.8);
      } else if (isSeparating) {
        rowG.append('text')
          .attr('x', innerWidth / 2)
          .attr('y', trackHeight / 2 + 3)
          .attr('fill', COLORS.textMuted)
          .attr('font-size', '10px')
          .attr('text-anchor', 'middle')
          .text('Separating...');
      } else if (!stems) {
        rowG.append('text')
          .attr('x', innerWidth / 2)
          .attr('y', trackHeight / 2 + 3)
          .attr('fill', COLORS.border)
          .attr('font-size', '10px')
          .attr('text-anchor', 'middle')
          .text('No stem data');
      }

      // Playhead
      rowG.append('line')
        .attr('x1', xScale(currentTime))
        .attr('x2', xScale(currentTime))
        .attr('y1', 0)
        .attr('y2', trackHeight)
        .attr('stroke', COLORS.playhead)
        .attr('stroke-width', 1)
        .attr('opacity', 0.5);
    });

    // === SECTION 4: LIGHT OUTPUT ===
    const lightY = waveformHeight + sectionsHeight + stemsHeight + sectionGap * 3;
    const lightHeight = trackHeight;
    const lightG = g.append('g').attr('transform', `translate(0, ${lightY})`);

    // Click handler area (invisible)
    lightG.append('rect')
      .attr('width', innerWidth)
      .attr('height', lightHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('click', handleClick as unknown as (event: unknown) => void);

    // Label on left side
    lightG.append('text')
      .attr('x', -8)
      .attr('y', trackHeight / 2 + 3)
      .attr('fill', '#fbbf24')  // amber-400
      .attr('font-size', '9px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', 'end')
      .text('LIGHT');

    // Compute light output from stems
    const lightData = computeLightOutput(stems, 500, effectiveDuration);

    if (lightData.length > 0) {
      const yScale = d3.scaleLinear()
        .domain([0, 1])
        .range([trackHeight - 2, 2]);

      const area = d3.area<TimeSeriesPoint>()
        .x(d => xScale(d.time))
        .y0(trackHeight)
        .y1(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

      // Gradient for light output
      const lightGradient = defs.append('linearGradient')
        .attr('id', 'lightOutputGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      lightGradient.append('stop').attr('offset', '0%').attr('stop-color', '#fbbf24');
      lightGradient.append('stop').attr('offset', '100%').attr('stop-color', '#78350f');

      lightG.append('path')
        .datum(lightData)
        .attr('d', area)
        .attr('fill', 'url(#lightOutputGradient)')
        .attr('opacity', 0.4);

      const line = d3.line<TimeSeriesPoint>()
        .x(d => xScale(d.time))
        .y(d => yScale(d.value))
        .curve(d3.curveMonotoneX);

      lightG.append('path')
        .datum(lightData)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', '#fbbf24')
        .attr('stroke-width', 2)
        .attr('opacity', 0.9);

      // Current value dot
      const getVal = (time: number): number => {
        for (let i = 0; i < lightData.length - 1; i++) {
          if (lightData[i + 1].time > time) return lightData[i].value;
        }
        return lightData[lightData.length - 1]?.value ?? 0;
      };
      const currentValue = getVal(currentTime);

      lightG.append('circle')
        .attr('cx', xScale(currentTime))
        .attr('cy', yScale(currentValue))
        .attr('r', 5)
        .attr('fill', '#fbbf24')
        .attr('stroke', COLORS.playhead)
        .attr('stroke-width', 2);
    } else if (!stems) {
      lightG.append('text')
        .attr('x', innerWidth / 2)
        .attr('y', trackHeight / 2 + 3)
        .attr('fill', COLORS.border)
        .attr('font-size', '10px')
        .attr('text-anchor', 'middle')
        .text('Waiting for stems...');
    }

    // Playhead
    lightG.append('line')
      .attr('x1', xScale(currentTime))
      .attr('x2', xScale(currentTime))
      .attr('y1', 0)
      .attr('y2', lightHeight)
      .attr('stroke', COLORS.playhead)
      .attr('stroke-width', 2);

    // Time format helper (used by zoom indicator)
    const timeFormat = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // === ZOOM BEHAVIOR ===
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 50])  // 1x to 50x zoom
      .translateExtent([[0, 0], [width, height]])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        const transform = event.transform;
        // Calculate new visible range based on zoom transform
        const newStart = fullXScale.invert(-transform.x / transform.k);
        const newEnd = fullXScale.invert((innerWidth - transform.x) / transform.k);

        // Clamp to valid range
        const clampedStart = Math.max(0, newStart);
        const clampedEnd = Math.min(effectiveDuration, newEnd);

        setZoomState({ start: clampedStart, end: clampedEnd });
      });

    svg.call(zoom);
    zoomRef.current = zoom;

    // Double-click to reset zoom
    svg.on('dblclick.zoom', () => {
      svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity);
      setZoomState({ start: 0, end: effectiveDuration });
    });

    // Zoom hint text
    if (zoomState.start === 0 && zoomState.end === effectiveDuration) {
      g.append('text')
        .attr('x', innerWidth - 5)
        .attr('y', 12)
        .attr('fill', COLORS.textMuted)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('text-anchor', 'end')
        .attr('opacity', 0.5)
        .text('Scroll to zoom');
    } else {
      // Show zoom level indicator
      const zoomLevel = effectiveDuration / (zoomState.end - zoomState.start);
      g.append('text')
        .attr('x', innerWidth - 5)
        .attr('y', 12)
        .attr('fill', COLORS.textSecondary)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('text-anchor', 'end')
        .text(`${zoomLevel.toFixed(1)}x`);
    }

  }, [analysis, stems, currentTime, duration, dimensions, onSeek, isSeparating, zoomState, effectiveDuration]);

  const showContent = !isAnalyzing && (duration > 0 || analysis);

  return (
    <div ref={containerRef} className="w-full h-full bg-black rounded-lg overflow-hidden relative">
      {/* Loading state */}
      {isAnalyzing && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="flex gap-1 justify-center mb-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="w-1 bg-gray-500 rounded-full animate-pulse"
                  style={{
                    height: `${16 + Math.sin(i * 0.8) * 8}px`,
                    animationDelay: `${i * 0.1}s`,
                  }}
                />
              ))}
            </div>
            <span className="text-gray-400 text-sm">Analyzing audio...</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isAnalyzing && !duration && !analysis && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-gray-600 text-sm">Drop audio file or click Open</span>
        </div>
      )}

      {/* Main SVG */}
      {showContent && <svg ref={svgRef} className="w-full h-full" />}
    </div>
  );
}
