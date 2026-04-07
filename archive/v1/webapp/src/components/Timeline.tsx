'use client';

import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { AudioAnalysis, TimeSeriesPoint } from '@/types/analysis';
import { VIBE_COLORS, VIBE_LABELS } from '@/types/vibe';

interface TimelineProps {
  analysis: AudioAnalysis | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  isAnalyzing?: boolean;
  onSeek: (time: number) => void;
}

// Vibe curve configuration - uses colors from vibe types for consistency
const VIBE_CURVES = [
  { key: 'intensity', label: VIBE_LABELS.intensity, color: VIBE_COLORS.intensity },
  { key: 'buildup', label: VIBE_LABELS.buildup, color: VIBE_COLORS.buildup },
  { key: 'complexity', label: VIBE_LABELS.complexity, color: VIBE_COLORS.complexity },
] as const;

export function Timeline({
  analysis,
  currentTime,
  duration,
  isPlaying,
  isAnalyzing,
  onSeek,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width
  useEffect(() => {
    if (!containerRef.current) return;

    const updateWidth = () => {
      if (containerRef.current) {
        const width = containerRef.current.getBoundingClientRect().width;
        if (width > 0) {
          setContainerWidth(width);
        }
      }
    };

    const timer = setTimeout(updateWidth, 50);
    const observer = new ResizeObserver(updateWidth);
    observer.observe(containerRef.current);

    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current || !containerWidth) return;

    const svg = d3.select(svgRef.current);
    const width = containerWidth;

    // Layout: waveform + 3 vibe curves
    const waveformHeight = 140;
    const vibeRowHeight = 32;
    const vibeGap = 4;
    const totalVibeHeight = VIBE_CURVES.length * (vibeRowHeight + vibeGap);
    const height = waveformHeight + totalVibeHeight + 24; // +24 for labels/margins

    const margin = { top: 8, right: 16, bottom: 20, left: 50 };
    const innerWidth = width - margin.left - margin.right;

    // Clear previous content
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Time scale (shared)
    const effectiveDuration = analysis?.duration || duration || 1;
    const xScale = d3.scaleLinear()
      .domain([0, effectiveDuration])
      .range([0, innerWidth]);

    // Click handler for seeking
    const handleClick = (event: MouseEvent) => {
      const [x] = d3.pointer(event);
      const time = xScale.invert(x);
      onSeek(Math.max(0, Math.min(effectiveDuration, time)));
    };

    // === WAVEFORM SECTION ===
    const waveformG = g.append('g');
    const waveformInnerHeight = waveformHeight - 8;
    const centerY = waveformInnerHeight / 2;

    // Background
    waveformG.append('rect')
      .attr('width', innerWidth)
      .attr('height', waveformInnerHeight)
      .attr('fill', '#0a0a0a')
      .attr('rx', 4)
      .style('cursor', 'pointer')
      .on('click', handleClick as unknown as (event: unknown) => void);

    // Draw waveform
    if (analysis?.energy && analysis.energy.length > 0) {
      const energyData = analysis.energy;

      const areaTop = d3.area<TimeSeriesPoint>()
        .x(d => xScale(d.time))
        .y0(centerY)
        .y1(d => centerY - (d.value * centerY * 0.9))
        .curve(d3.curveMonotoneX);

      const areaBottom = d3.area<TimeSeriesPoint>()
        .x(d => xScale(d.time))
        .y0(centerY)
        .y1(d => centerY + (d.value * centerY * 0.9))
        .curve(d3.curveMonotoneX);

      // Gradients
      const defs = svg.append('defs');

      const gradient = defs.append('linearGradient')
        .attr('id', 'waveformGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      gradient.append('stop').attr('offset', '0%').attr('stop-color', '#666');
      gradient.append('stop').attr('offset', '50%').attr('stop-color', '#444');
      gradient.append('stop').attr('offset', '100%').attr('stop-color', '#666');

      const playedGradient = defs.append('linearGradient')
        .attr('id', 'playedGradient')
        .attr('x1', '0%').attr('y1', '0%')
        .attr('x2', '0%').attr('y2', '100%');
      playedGradient.append('stop').attr('offset', '0%').attr('stop-color', '#fff');
      playedGradient.append('stop').attr('offset', '50%').attr('stop-color', '#aaa');
      playedGradient.append('stop').attr('offset', '100%').attr('stop-color', '#fff');

      // Unplayed waveform
      waveformG.append('path').datum(energyData).attr('d', areaTop)
        .attr('fill', 'url(#waveformGradient)').attr('opacity', 0.8);
      waveformG.append('path').datum(energyData).attr('d', areaBottom)
        .attr('fill', 'url(#waveformGradient)').attr('opacity', 0.8);

      // Played clip
      defs.append('clipPath').attr('id', 'playedClip')
        .append('rect').attr('x', 0).attr('y', 0)
        .attr('width', xScale(currentTime)).attr('height', waveformInnerHeight);

      const playedGroup = waveformG.append('g').attr('clip-path', 'url(#playedClip)');
      playedGroup.append('path').datum(energyData).attr('d', areaTop)
        .attr('fill', 'url(#playedGradient)').attr('opacity', 0.9);
      playedGroup.append('path').datum(energyData).attr('d', areaBottom)
        .attr('fill', 'url(#playedGradient)').attr('opacity', 0.9);
    }

    // Beat ticks
    if (analysis?.beats && analysis.beats.length > 0) {
      waveformG.selectAll('.beat-tick')
        .data(analysis.beats)
        .enter()
        .append('line')
        .attr('x1', d => xScale(d))
        .attr('x2', d => xScale(d))
        .attr('y1', waveformInnerHeight)
        .attr('y2', waveformInnerHeight + 4)
        .attr('stroke', '#ff4444')
        .attr('stroke-width', 1)
        .attr('opacity', 0.6);
    }

    // Playhead on waveform
    waveformG.append('line')
      .attr('x1', xScale(currentTime))
      .attr('x2', xScale(currentTime))
      .attr('y1', 0)
      .attr('y2', waveformInnerHeight)
      .attr('stroke', '#fff')
      .attr('stroke-width', 2)
      .attr('filter', 'drop-shadow(0 0 2px rgba(255,255,255,0.5))');

    // BPM badge
    if (analysis?.bpm) {
      const bpmGroup = waveformG.append('g')
        .attr('transform', `translate(${innerWidth - 50}, 4)`);
      bpmGroup.append('rect')
        .attr('width', 46).attr('height', 16).attr('rx', 3).attr('fill', '#222');
      bpmGroup.append('text')
        .attr('x', 23).attr('y', 12)
        .attr('fill', '#888')
        .attr('font-size', '10px')
        .attr('font-family', 'monospace')
        .attr('text-anchor', 'middle')
        .text(`${analysis.bpm} BPM`);
    }

    // === VIBE CURVES SECTION ===
    const vibeStartY = waveformHeight + 8;

    VIBE_CURVES.forEach((curve, i) => {
      const rowY = vibeStartY + i * (vibeRowHeight + vibeGap);
      const data = analysis?.[curve.key] as TimeSeriesPoint[] | undefined;

      const curveG = g.append('g')
        .attr('transform', `translate(0, ${rowY})`);

      // Background
      curveG.append('rect')
        .attr('width', innerWidth)
        .attr('height', vibeRowHeight)
        .attr('fill', '#0a0a0a')
        .attr('rx', 2)
        .style('cursor', 'pointer')
        .on('click', handleClick as unknown as (event: unknown) => void);

      // Label
      curveG.append('text')
        .attr('x', -8)
        .attr('y', vibeRowHeight / 2 + 4)
        .attr('fill', curve.color)
        .attr('font-size', '9px')
        .attr('font-family', 'monospace')
        .attr('text-anchor', 'end')
        .text(curve.label.slice(0, 4).toUpperCase());

      if (data && data.length > 0) {
        // Y scale for this curve
        const yScale = d3.scaleLinear()
          .domain([0, 1])
          .range([vibeRowHeight - 2, 2]);

        // Area under curve
        const area = d3.area<TimeSeriesPoint>()
          .x(d => xScale(d.time))
          .y0(vibeRowHeight)
          .y1(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        // Line on top
        const line = d3.line<TimeSeriesPoint>()
          .x(d => xScale(d.time))
          .y(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        // Filled area
        curveG.append('path')
          .datum(data)
          .attr('d', area)
          .attr('fill', curve.color)
          .attr('opacity', 0.2);

        // Line
        curveG.append('path')
          .datum(data)
          .attr('d', line)
          .attr('fill', 'none')
          .attr('stroke', curve.color)
          .attr('stroke-width', 1.5)
          .attr('opacity', 0.8);

        // Playhead indicator
        const currentValue = data.find(d => d.time >= currentTime)?.value ?? 0;
        curveG.append('circle')
          .attr('cx', xScale(currentTime))
          .attr('cy', yScale(currentValue))
          .attr('r', 4)
          .attr('fill', curve.color)
          .attr('stroke', '#fff')
          .attr('stroke-width', 1);
      }

      // Vertical playhead line
      curveG.append('line')
        .attr('x1', xScale(currentTime))
        .attr('x2', xScale(currentTime))
        .attr('y1', 0)
        .attr('y2', vibeRowHeight)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1)
        .attr('opacity', 0.5);
    });

    // Time labels at bottom
    const timeFormat = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const bottomY = vibeStartY + VIBE_CURVES.length * (vibeRowHeight + vibeGap) + 4;
    const labelX = xScale(currentTime);
    const labelAnchor = labelX < 40 ? 'start' : labelX > innerWidth - 40 ? 'end' : 'middle';

    g.append('text')
      .attr('x', labelX)
      .attr('y', bottomY)
      .attr('fill', '#fff')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', labelAnchor)
      .text(timeFormat(currentTime));

    g.append('text')
      .attr('x', innerWidth)
      .attr('y', bottomY)
      .attr('fill', '#666')
      .attr('font-size', '10px')
      .attr('font-family', 'monospace')
      .attr('text-anchor', 'end')
      .text(timeFormat(effectiveDuration));

  }, [analysis, currentTime, duration, onSeek, containerWidth]);

  // Always render the same container for consistent width measurement
  const showWaveform = !isAnalyzing && (duration > 0 || analysis);

  return (
    <div ref={containerRef} className="w-full bg-gray-950 border border-gray-800 rounded-lg overflow-hidden relative" style={{ height: 280 }}>
      {/* Loading state */}
      {isAnalyzing && (
        <div className="absolute inset-0 flex items-center justify-center gap-3">
          <div className="flex gap-1">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-1 bg-gray-500 rounded-full animate-pulse"
                style={{
                  height: `${12 + Math.sin(i * 0.8) * 8}px`,
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
          <span className="text-gray-400 text-sm">Analyzing audio...</span>
        </div>
      )}

      {/* Empty state */}
      {!isAnalyzing && !duration && !analysis && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-gray-600 text-sm">Drop audio file or click Open</span>
        </div>
      )}

      {/* Waveform SVG */}
      {showWaveform && <svg ref={svgRef} className="w-full h-full" />}
    </div>
  );
}
