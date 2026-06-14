'use client';

// Composites the playground: a 2D canvas for the wash fixtures (Halo radial +
// Shocker corner flashes) with the transparent 3D Spots layer on top. Both read
// the same frameRef (per-fixture Visual map) the live loop updates each frame.

import { RefObject, useEffect, useRef } from 'react';
import { Visual } from '@/lib/fixtures';
import { drawWashes } from '@/lib/stageRender';
import { Spots3D } from './Spots3D';

export function Stage({ frameRef }: { frameRef: RefObject<Record<string, Visual>> }) {
  const c2d = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = c2d.current!;
    const ctx = canvas.getContext('2d')!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    let raf = 0;
    const loop = () => {
      const r = canvas.getBoundingClientRect();
      drawWashes(ctx, r.width, r.height, frameRef.current ?? {});
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [frameRef]);

  return (
    <div className="absolute inset-0">
      <canvas ref={c2d} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0">
        <Spots3D frameRef={frameRef} />
      </div>
    </div>
  );
}
