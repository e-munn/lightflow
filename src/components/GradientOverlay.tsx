'use client';

import { useMemo } from 'react';

interface GradientOverlayProps {
  signal: number;       // 0-1 — drives intensity/movement
  time: number;         // playback time in seconds
  dominantStem: string; // current focal stem — drives color palette
  enabled: boolean;
}

// Rich, saturated palettes per dominant stem
const PALETTES: Record<string, string[]> = {
  bass:  ['#ff006e', '#fb5607', '#ffbe0b', '#8338ec'], // hot pink → orange → yellow → violet
  kick:  ['#ff4500', '#ff8c00', '#ffd700', '#dc143c'], // crimson/orange/gold
  snare: ['#00f5ff', '#0066ff', '#7b2cbf', '#00d4aa'], // cyan/blue/violet/teal
  hat:   ['#e0aaff', '#c77dff', '#9d4edd', '#ff70a6'], // lilacs/pink
  other: ['#06ffa5', '#00b4d8', '#0077b6', '#caf0f8'], // mint/teal/azure
};

export function GradientOverlay({ signal, time, dominantStem, enabled }: GradientOverlayProps) {
  const style = useMemo(() => {
    if (!enabled) return { display: 'none' };

    const palette = PALETTES[dominantStem] ?? PALETTES.bass;
    const t = time * 0.35; // slower overall movement

    // Two radial gradients drifting independently
    // Each has its own center position that wobbles slowly
    const cx1 = 50 + Math.sin(t * 0.8) * 30;       // 20-80%
    const cy1 = 50 + Math.cos(t * 0.6) * 30;
    const cx2 = 50 + Math.sin(t * 0.5 + 2) * 35;
    const cy2 = 50 + Math.cos(t * 0.9 + 1) * 35;
    const cx3 = 50 + Math.sin(t * 0.7 + 4) * 25;
    const cy3 = 50 + Math.cos(t * 0.4 + 3) * 25;

    // Radii also breathe slowly
    const r1 = 40 + Math.sin(t * 0.3) * 15;
    const r2 = 45 + Math.cos(t * 0.4 + 1) * 15;
    const r3 = 50 + Math.sin(t * 0.5 + 2) * 10;

    const g1 = `radial-gradient(circle at ${cx1.toFixed(1)}% ${cy1.toFixed(1)}%, ${palette[0]} 0%, transparent ${r1.toFixed(0)}%)`;
    const g2 = `radial-gradient(circle at ${cx2.toFixed(1)}% ${cy2.toFixed(1)}%, ${palette[1]} 0%, transparent ${r2.toFixed(0)}%)`;
    const g3 = `radial-gradient(circle at ${cx3.toFixed(1)}% ${cy3.toFixed(1)}%, ${palette[2]} 0%, transparent ${r3.toFixed(0)}%)`;

    // Signal-driven opacity, but kept lighter overall
    const opacity = Math.min(0.45, 0.15 + signal * 0.4);

    return {
      background: `${g1}, ${g2}, ${g3}`,
      opacity,
      mixBlendMode: 'screen' as const,
    };
  }, [signal, time, dominantStem, enabled]);

  return (
    <div
      className="absolute inset-0 pointer-events-none transition-none"
      style={style}
    />
  );
}
