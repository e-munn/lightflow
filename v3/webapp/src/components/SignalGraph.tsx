'use client';

import { useRef, useEffect } from 'react';
import * as d3 from 'd3';

interface SignalGraphProps {
  signal: number;        // 0-1 current value
  dominant: string;      // current dominant stem
  time: number;          // current playback time (for forcing updates)
  duration?: number;     // total song duration (if provided, render whole song)
  windowSeconds?: number; // fallback rolling-window size
}

const STEM_COLORS: Record<string, string> = {
  bass:  '#166534',
  kick:  '#22c55e',
  snare: '#a3e635',
  hat:   '#facc15',
  other: '#6b7280',
};

const MAX_POINTS = 20000;

interface DataPoint {
  time: number;
  value: number;
  stem: string;
}

// Persistent buffer outside React render cycle
const buffer: DataPoint[] = [];
let frameCount = 0;
let lastPushTime = 0;

export function resetSignalGraph(): void {
  buffer.length = 0;
  frameCount = 0;
  lastPushTime = 0;
}

export function SignalGraph({ signal, dominant, time, duration, windowSeconds = 5 }: SignalGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Push data point — depends on time so it fires every frame even when signal=0.
  // Detect time jumps (scrub) and flush buffer to avoid stale connecting lines.
  useEffect(() => {
    if (Math.abs(time - lastPushTime) > 0.25) {
      buffer.length = 0;
    }
    lastPushTime = time;
    buffer.push({ time, value: signal, stem: dominant });
    if (buffer.length > MAX_POINTS) buffer.shift();
  }, [time, signal, dominant]);

  // Render
  useEffect(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container || buffer.length < 2) return;

    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const sel = d3.select(svg);
    sel.selectAll('*').remove();

    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));

    const data = buffer;
    const tMin = duration && duration > 0 ? 0 : time - windowSeconds;
    const tMax = duration && duration > 0 ? duration : time;

    const visible = duration && duration > 0 ? data : data.filter(d => d.time >= tMin);
    if (visible.length < 2) return;

    const x = d3.scaleLinear()
      .domain([tMin, tMax])
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, 1])
      .range([height - 1, 1]);

    // Build segments by stem for coloring
    const segments: { points: DataPoint[]; stem: string }[] = [];
    let currentSeg: DataPoint[] = [visible[0]];
    let currentStem = visible[0].stem;

    for (let i = 1; i < visible.length; i++) {
      if (visible[i].stem !== currentStem) {
        segments.push({ points: currentSeg, stem: currentStem });
        // Overlap last point for continuity
        currentSeg = [visible[i - 1], visible[i]];
        currentStem = visible[i].stem;
      } else {
        currentSeg.push(visible[i]);
      }
    }
    segments.push({ points: currentSeg, stem: currentStem });

    const line = d3.line<DataPoint>()
      .x(d => x(d.time))
      .y(d => y(d.value))
      .curve(d3.curveBasis);

    // Filled area under curve
    const area = d3.area<DataPoint>()
      .x(d => x(d.time))
      .y0(height)
      .y1(d => y(d.value))
      .curve(d3.curveBasis);

    for (const seg of segments) {
      if (seg.points.length < 2) continue;
      const color = STEM_COLORS[seg.stem] ?? '#666';

      // Fill
      sel.append('path')
        .datum(seg.points)
        .attr('d', area)
        .attr('fill', color)
        .attr('opacity', 0.15);

      // Line
      sel.append('path')
        .datum(seg.points)
        .attr('d', line)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2);
    }

    // Current value dot
    const last = visible[visible.length - 1];
    const dotColor = STEM_COLORS[last.stem] ?? '#666';
    sel.append('circle')
      .attr('cx', x(last.time))
      .attr('cy', y(last.value))
      .attr('r', 4)
      .attr('fill', dotColor);

  }, [time, signal, dominant, windowSeconds]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <svg ref={svgRef} className="w-full h-full" />
    </div>
  );
}
