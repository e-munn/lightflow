'use client';

import { useRef, useEffect, useState } from 'react';
import { Application, Graphics, Container, BlurFilter } from 'pixi.js';

interface ScreenRendererProps {
  signal: number;
  accent: number;
  accentStem: string;
  time: number;
  preset: string;       // which channel-2 preset is active
}

const STEM_COLORS_HEX: Record<string, number> = {
  kick: 0xff5a3c,
  snare: 0x50a0ff,
  hat: 0xc882ff,
  bass: 0xffb43c,
  other: 0x78c8b4,
};

// --- Burst types ---
type BurstKind = 'ring' | 'particles' | 'streak' | 'flash' | 'bars' | 'starburst';

interface Burst {
  gfx: Graphics;
  kind: BurstKind;
  bornAt: number;
  color: number;
  strength: number;
  cx: number;
  cy: number;
  // Per-kind extras
  particles?: { dx: number; dy: number }[];
  angle?: number;
}

const burstsRef = { current: [] as Burst[] };

export function resetScreenRenderer() {
  burstsRef.current = [];
}

const BURST_LIFETIME = 0.9;
const MAX_BURSTS = 20;

function spawnBurst(
  layer: Container,
  kind: BurstKind,
  time: number,
  color: number,
  strength: number,
  w: number,
  h: number,
): Burst {
  const gfx = new Graphics();
  layer.addChild(gfx);

  let cx: number;
  let cy: number;

  if (kind === 'flash') {
    cx = w / 2;
    cy = h / 2;
  } else if (kind === 'bars') {
    cx = 0;
    cy = 0;
  } else {
    cx = w * (0.18 + Math.random() * 0.64);
    cy = h * (0.18 + Math.random() * 0.64);
  }

  const burst: Burst = { gfx, kind, bornAt: time, color, strength, cx, cy };

  if (kind === 'particles' || kind === 'starburst') {
    const n = kind === 'particles' ? 18 : 14;
    burst.particles = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 0.7 + Math.random() * 0.6;
      burst.particles.push({ dx: Math.cos(a) * speed, dy: Math.sin(a) * speed });
    }
  }

  if (kind === 'streak') {
    burst.angle = Math.random() * Math.PI * 2;
  }

  return burst;
}

function renderBurst(b: Burst, age: number, w: number, h: number) {
  const t = age / BURST_LIFETIME;
  if (t < 0 || t > 1) return;
  const gfx = b.gfx;
  gfx.clear();

  switch (b.kind) {
    case 'ring': {
      const maxR = Math.max(w, h) * 0.6;
      const radius = t * maxR;
      const opacity = Math.pow(1 - t, 1.4) * b.strength;
      const lineWidth = (1 - t) * 18 + 4;

      gfx.circle(b.cx, b.cy, radius)
        .stroke({ color: b.color, width: lineWidth, alpha: opacity });

      // Inner solid
      if (t < 0.35) {
        const o = (1 - t / 0.35) * b.strength * 0.4;
        gfx.circle(b.cx, b.cy, radius * 0.6).fill({ color: b.color, alpha: o });
      }
      break;
    }

    case 'particles': {
      if (!b.particles) break;
      const dist = t * Math.max(w, h) * 0.5;
      const opacity = Math.pow(1 - t, 1.2) * b.strength;
      const r = (1 - t) * 14 + 3;
      for (const p of b.particles) {
        gfx.circle(b.cx + p.dx * dist, b.cy + p.dy * dist, r)
          .fill({ color: b.color, alpha: opacity });
      }
      break;
    }

    case 'starburst': {
      if (!b.particles) break;
      const length = (1 - Math.pow(1 - t, 2)) * Math.max(w, h) * 0.45;
      const opacity = Math.pow(1 - t, 1.5) * b.strength;
      const lineWidth = (1 - t) * 8 + 2;
      for (const p of b.particles) {
        gfx.moveTo(b.cx, b.cy)
          .lineTo(b.cx + p.dx * length, b.cy + p.dy * length)
          .stroke({ color: b.color, width: lineWidth, alpha: opacity });
      }
      break;
    }

    case 'streak': {
      const angle = b.angle ?? 0;
      const length = Math.max(w, h);
      const dx = Math.cos(angle) * length;
      const dy = Math.sin(angle) * length;
      const x1 = b.cx - dx;
      const y1 = b.cy - dy;
      const x2 = b.cx + dx;
      const y2 = b.cy + dy;
      const opacity = Math.pow(1 - t, 1.6) * b.strength;
      const lineWidth = (1 - t) * 18 + 2;
      gfx.moveTo(x1, y1).lineTo(x2, y2)
        .stroke({ color: b.color, width: lineWidth, alpha: opacity });
      break;
    }

    case 'flash': {
      const opacity = Math.pow(1 - t, 2.5) * b.strength * 0.7;
      gfx.rect(0, 0, w, h).fill({ color: b.color, alpha: opacity });
      break;
    }

    case 'bars': {
      const barCount = 12;
      const barW = w / barCount;
      const opacity = Math.pow(1 - t, 1.4) * b.strength;
      for (let i = 0; i < barCount; i++) {
        const phase = (i / barCount + t * 0.5) % 1;
        const barH = (1 - Math.abs(phase * 2 - 1)) * h * 0.8 * (1 - t * 0.5);
        const x = i * barW + barW * 0.1;
        const y = (h - barH) / 2;
        gfx.rect(x, y, barW * 0.8, barH).fill({ color: b.color, alpha: opacity });
      }
      break;
    }
  }
}

export function ScreenRenderer({ signal, accent, accentStem, time, preset }: ScreenRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const burstLayerRef = useRef<Container | null>(null);
  const bgGfxRef = useRef<Graphics | null>(null);
  const lastAccentRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const presetRef = useRef(preset);
  presetRef.current = preset;
  const [ready, setReady] = useState(false);

  // Init Pixi
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const app = new Application();
    const dpr = window.devicePixelRatio || 1;

    app.init({
      resizeTo: container,
      background: 0x000000,
      antialias: true,
      resolution: dpr,
      autoDensity: true,
      preference: 'webgl',
    }).then(() => {
      if (cancelled) {
        app.destroy(true);
        return;
      }
      container.appendChild(app.canvas);

      const bg = new Graphics();
      app.stage.addChild(bg);
      bgGfxRef.current = bg;

      const layer = new Container();
      // Higher quality blur for crisp glow
      const blur = new BlurFilter({ strength: 6, quality: 4 });
      blur.resolution = dpr;
      layer.filters = [blur];
      app.stage.addChild(layer);
      burstLayerRef.current = layer;

      appRef.current = app;
      setReady(true);
    });

    return () => {
      cancelled = true;
      const a = appRef.current;
      if (a) {
        a.destroy(true, { children: true, texture: true });
        appRef.current = null;
      }
      burstsRef.current = [];
    };
  }, []);

  // Track size
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const obs = new ResizeObserver(([e]) => {
      sizeRef.current = { w: e.contentRect.width, h: e.contentRect.height };
    });
    obs.observe(c);
    return () => obs.disconnect();
  }, []);

  // Spawn burst on accent rising edge
  useEffect(() => {
    if (!ready) return;
    const layer = burstLayerRef.current;
    if (!layer) return;

    if (accent > 0.3 && lastAccentRef.current < 0.3) {
      const { w, h } = sizeRef.current;
      const color = STEM_COLORS_HEX[accentStem] ?? STEM_COLORS_HEX.kick;
      // Determine which kind to spawn — preset=director picks dynamically
      let kind: BurstKind;
      if (presetRef.current === 'director') {
        kind = pickDirectorKind(accentStem, accent);
      } else {
        kind = presetRef.current as BurstKind;
      }
      const burst = spawnBurst(layer, kind, time, color, accent, w, h);
      burstsRef.current.push(burst);
      if (burstsRef.current.length > MAX_BURSTS) {
        const old = burstsRef.current.shift();
        if (old) old.gfx.destroy();
      }
    }
    lastAccentRef.current = accent;
  }, [accent, accentStem, time, ready]);

  // Per-frame render
  useEffect(() => {
    if (!ready) return;
    const bg = bgGfxRef.current;
    if (!bg) return;
    const { w, h } = sizeRef.current;
    if (w === 0 || h === 0) return;

    const v = Math.round(signal * 255);
    bg.clear();
    bg.rect(0, 0, w, h).fill({ color: (v << 16) | (v << 8) | v });

    const bursts = burstsRef.current;
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      const age = time - b.bornAt;
      if (age > BURST_LIFETIME) {
        b.gfx.destroy();
        bursts.splice(i, 1);
        continue;
      }
      renderBurst(b, age, w, h);
    }
  }, [signal, accent, time, ready]);

  return <div ref={containerRef} className="w-full h-full" />;
}

// --- Director: pick burst kind based on stem + strength ---
const directorRecent: BurstKind[] = [];

function pickDirectorKind(stem: string, strength: number): BurstKind {
  const scores: Record<BurstKind, number> = {
    ring: 1.0,
    particles: 0.7,
    starburst: 0.5,
    streak: 0.4,
    flash: 0.2,
    bars: 0.3,
  };

  // Stem-based bias
  if (stem === 'kick') {
    scores.flash += 0.8;
    scores.ring += 0.5;
    scores.bars += 0.3;
  } else if (stem === 'snare') {
    scores.starburst += 1.0;
    scores.streak += 0.6;
  } else if (stem === 'hat') {
    scores.particles += 1.2;
    scores.starburst += 0.4;
  }

  // High strength favors flash + bars
  if (strength > 0.7) {
    scores.flash += 0.6;
    scores.bars += 0.4;
  }

  // Anti-repetition
  for (const r of directorRecent) {
    scores[r] *= 0.5;
  }

  // Weighted pick
  const keys = Object.keys(scores) as BurstKind[];
  let total = 0;
  for (const k of keys) total += scores[k];
  let r = Math.random() * total;
  let pick: BurstKind = 'ring';
  for (const k of keys) {
    r -= scores[k];
    if (r <= 0) { pick = k; break; }
  }

  directorRecent.push(pick);
  if (directorRecent.length > 4) directorRecent.shift();
  return pick;
}

export const SCREEN_PRESETS: { key: string; label: string }[] = [
  { key: 'director', label: 'Director' },
  { key: 'ring', label: 'Rings' },
  { key: 'particles', label: 'Particles' },
  { key: 'starburst', label: 'Starburst' },
  { key: 'streak', label: 'Streaks' },
  { key: 'flash', label: 'Flash' },
  { key: 'bars', label: 'Bars' },
];
