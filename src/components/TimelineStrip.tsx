'use client';

// Live timeline. A faint horizontal strip with a fixed "now" cursor in the
// centre. LEFT of the cursor = the past, drawn as a smooth d3 curve of the
// energy we actually heard. RIGHT = the future: the deterministic beat grid
// (we know the tempo) plus a dashed "tension" ramp from the build heuristic.
// Solid = real, dashed = predicted — so the certainty is legible at a glance.

import { useEffect, useRef, RefObject } from 'react';
import { line, curveBasis } from 'd3';

export interface LiveTimeline {
  samples: { t: number; e: number }[]; // recent energy history (ms timestamps)
  bpm: number | null;
  beatLen: number; // seconds per beat
  beats: number; // continuous beat count (now)
  build: number; // 0..1 tension
  energy: number; // current energy
}

const PAST_MS = 3500;
const FUT_MS = 3500;
const SPAN = PAST_MS + FUT_MS;

export function TimelineStrip({ liveRef }: { liveRef: RefObject<LiveTimeline> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const r = canvas.getBoundingClientRect();
      const W = r.width;
      const H = r.height;
      ctx.clearRect(0, 0, W, H);

      const L = liveRef.current;
      const now = L.samples.length ? L.samples[L.samples.length - 1].t : performance.now();
      const base = H - 6; // baseline (energy 0)
      const top = 8; // energy 1
      const xOf = (t: number) => ((t - (now - PAST_MS)) / SPAN) * W;
      const yOf = (e: number) => base + (top - base) * Math.min(1, Math.max(0, e));
      const cx = xOf(now); // the "now" cursor x

      // future beat grid
      if (L.bpm && L.beatLen > 0) {
        let n = Math.ceil(L.beats);
        for (let i = 0; i < 64; i++, n++) {
          const tb = now + (n - L.beats) * L.beatLen * 1000;
          if (tb > now + FUT_MS) break;
          const x = xOf(tb);
          const down = n % 4 === 0;
          ctx.strokeStyle = `rgba(255,255,255,${down ? 0.22 : 0.09})`;
          ctx.setLineDash([2, 5]);
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, base);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }

      // future tension ramp (dashed) — rises with build, signalling a possible drop
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = `rgba(255,255,255,${0.12 + 0.45 * L.build})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yOf(L.energy));
      ctx.lineTo(W, yOf(Math.min(1, L.energy + L.build)));
      ctx.stroke();
      ctx.setLineDash([]);

      // past energy curve (solid) — only samples up to now (left of cursor)
      if (L.samples.length > 1) {
        const gen = line<{ t: number; e: number }>()
          .x((d) => xOf(d.t))
          .y((d) => yOf(d.e))
          .curve(curveBasis)
          .context(ctx);
        ctx.beginPath();
        gen(L.samples);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // now cursor
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, H);
      ctx.stroke();

      // build label
      if (L.build > 0.45) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + 0.5 * L.build})`;
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText('build', cx + 8, top + 8);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [liveRef]);

  return <canvas ref={canvasRef} className="block h-full w-full opacity-80" />;
}
