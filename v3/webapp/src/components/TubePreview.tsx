'use client';

import { useRef, useEffect, useState } from 'react';
import { NUM_TUBES, PIXELS_PER_TUBE, Grid } from '@/types/v3';

interface TubePreviewProps {
  grid: Grid | null;
}

export function TubePreview({ grid }: TubePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: Math.floor(width), h: Math.floor(height) });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pxWidth = Math.floor(size.w / NUM_TUBES);
    const pxHeight = Math.floor(size.h / PIXELS_PER_TUBE);
    const totalW = pxWidth * NUM_TUBES;
    const totalH = pxHeight * PIXELS_PER_TUBE;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = totalW * dpr;
    canvas.height = totalH * dpr;
    canvas.style.width = `${totalW}px`;
    canvas.style.height = `${totalH}px`;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, totalW, totalH);

    for (let t = 0; t < NUM_TUBES; t++) {
      const x = t * pxWidth;
      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        const y = px * pxHeight;

        let r = 0, g = 0, b = 0;
        if (grid) {
          const i = (px * NUM_TUBES + t) * 3;
          r = Math.round(Math.min(1, grid[i]) * 255);
          g = Math.round(Math.min(1, grid[i + 1]) * 255);
          b = Math.round(Math.min(1, grid[i + 2]) * 255);
        }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, y, pxWidth, pxHeight);
      }
    }
  }, [grid, size]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas ref={canvasRef} />
    </div>
  );
}
