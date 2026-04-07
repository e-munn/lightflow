'use client';

import { useEffect, useRef, useState, useMemo } from 'react';

interface Screen2DProps {
  signal: number;
  accent: number;
  accentStem: string;
  time: number;
}

// Refined palettes per dominant stem (foreground / background / accent)
const STEM_PALETTES: Record<string, { fg: string; bg: string; accent: string }> = {
  kick:  { fg: '#ff6b35', bg: '#0a0a0a', accent: '#ffd23f' },
  snare: { fg: '#3a86ff', bg: '#0a0a14', accent: '#8338ec' },
  hat:   { fg: '#c77dff', bg: '#0d0a14', accent: '#ff70a6' },
  bass:  { fg: '#ffbe0b', bg: '#0c0a06', accent: '#fb5607' },
  other: { fg: '#06ffa5', bg: '#06120e', accent: '#00b4d8' },
};

// --- Blob path generator ---
// Generates a smooth closed SVG path with N points around a circle.
// Each point is offset by a noise function to create an organic shape.
// Phase shifts the noise pattern over time for continuous morphing.
function generateBlobPath(
  cx: number,
  cy: number,
  radius: number,
  points: number,
  time: number,
  morphAmount: number,
  seed: number
): string {
  const angles: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    // Multi-frequency offset for organic feel
    const offset =
      Math.sin(a * 3 + time * 0.7 + seed) * 0.4 +
      Math.sin(a * 5 + time * 0.4 + seed * 2) * 0.25 +
      Math.cos(a * 2 + time * 1.1 + seed * 0.5) * 0.35;
    const r = radius * (1 + offset * morphAmount);
    angles.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }

  // Build smooth Catmull-Rom-style path with cubic bezier interpolation
  const n = angles.length;
  let d = `M ${angles[0].x.toFixed(2)} ${angles[0].y.toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = angles[(i - 1 + n) % n];
    const p1 = angles[i];
    const p2 = angles[(i + 1) % n];
    const p3 = angles[(i + 2) % n];
    // Catmull-Rom to bezier conversion
    const tension = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * tension;
    const c1y = p1.y + (p2.y - p0.y) * tension;
    const c2x = p2.x - (p3.x - p1.x) * tension;
    const c2y = p2.y - (p3.y - p1.y) * tension;
    d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

interface AccentRipple {
  id: number;
  bornAt: number;
  color: string;
  cx: number;
  cy: number;
  strength: number;
}

const RIPPLE_LIFETIME = 1.4;
let _rippleId = 0;
const ripplesRef = { current: [] as AccentRipple[] };

export function resetScreen2D() {
  ripplesRef.current = [];
  _rippleId = 0;
}

export function Screen2D({ signal, accent, accentStem, time }: Screen2DProps) {
  const lastAccentRef = useRef(0);
  const [, force] = useState(0);

  // Spawn ripple on accent edge
  useEffect(() => {
    if (accent > 0.3 && lastAccentRef.current < 0.3) {
      const palette = STEM_PALETTES[accentStem] ?? STEM_PALETTES.kick;
      ripplesRef.current.push({
        id: _rippleId++,
        bornAt: time,
        color: palette.accent,
        cx: 30 + Math.random() * 40,
        cy: 30 + Math.random() * 40,
        strength: accent,
      });
      if (ripplesRef.current.length > 4) ripplesRef.current.shift();
    }
    lastAccentRef.current = accent;
    force((n) => n + 1);
  }, [accent, accentStem, time]);

  // Use accent stem for palette (or default to bass)
  const palette = STEM_PALETTES[accentStem] ?? STEM_PALETTES.bass;

  // Central blob — smaller, simpler
  const blobRadius = 10 + signal * 6;
  const morphAmount = 0.12 + signal * 0.35 + accent * 0.25;
  const mainBlob = useMemo(
    () => generateBlobPath(50, 50, blobRadius, 10, time, morphAmount, 0),
    [blobRadius, morphAmount, time]
  );

  // Secondary larger blob — slower morph, lower opacity
  const bgBlob = useMemo(
    () => generateBlobPath(50, 50, 18 + signal * 4, 8, time * 0.5, 0.25, 7),
    [signal, time]
  );

  // Slow rotation for the whole composition
  const rotation = (time * 4) % 360;

  return (
    <div className="absolute inset-0">
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Soft gradient for the main blob */}
          <radialGradient id="blobGrad" cx="40%" cy="40%" r="60%">
            <stop offset="0%" stopColor={palette.accent} stopOpacity="0.95" />
            <stop offset="100%" stopColor={palette.fg} stopOpacity="0.6" />
          </radialGradient>
          {/* Soft glow filter */}
          <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Concentric rectangular grid — subtle background that breathes */}
        <g opacity={0.08 + signal * 0.18 + accent * 0.25}>
          {Array.from({ length: 10 }).map((_, i) => {
            // Each rect is centered, growing outward
            // Phase shifts with signal so the grid "breathes"
            const phase = (i + signal * 1.5 + accent * 2) * 0.5;
            const inset = i * 4 + Math.sin(time * 0.6 + phase) * 0.6;
            return (
              <rect
                key={i}
                x={inset}
                y={inset}
                width={100 - inset * 2}
                height={100 - inset * 2}
                fill="none"
                stroke={palette.fg}
                strokeWidth={0.15}
                strokeOpacity={1 - i * 0.07}
              />
            );
          })}
        </g>

        {/* Slowly drifting background blob */}
        <g
          transform={`rotate(${-rotation * 0.3} 50 50)`}
          opacity={0.15 + signal * 0.15}
        >
          <path d={bgBlob} fill={palette.fg} />
        </g>

        {/* Main morphing blob */}
        <g transform={`rotate(${rotation} 50 50)`}>
          <path
            d={mainBlob}
            fill="url(#blobGrad)"
            filter="url(#softGlow)"
            opacity={0.75 + signal * 0.25}
          />
        </g>

        {/* Stroke outline of the same shape, slightly offset for depth */}
        <g transform={`rotate(${rotation} 50 50)`}>
          <path
            d={mainBlob}
            fill="none"
            stroke={palette.fg}
            strokeWidth={0.4}
            strokeOpacity={0.4 + accent * 0.6}
          />
        </g>

        {/* Accent ripples — expanding rings on big hits */}
        {ripplesRef.current.map((r) => {
          const age = time - r.bornAt;
          const t = age / RIPPLE_LIFETIME;
          if (t < 0 || t > 1) return null;
          // Smooth ease-out
          const eased = 1 - Math.pow(1 - t, 3);
          const radius = eased * 60 * r.strength;
          const opacity = Math.pow(1 - t, 1.5) * 0.7;
          const strokeWidth = (1 - t) * 1.2 + 0.2;

          return (
            <circle
              key={r.id}
              cx={r.cx}
              cy={r.cy}
              r={radius}
              fill="none"
              stroke={r.color}
              strokeWidth={strokeWidth}
              opacity={opacity}
            />
          );
        })}
      </svg>
    </div>
  );
}
