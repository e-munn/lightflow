'use client';

import { useRef, useEffect } from 'react';
import { NUM_TUBES, PIXELS_PER_TUBE, Grid } from '@/types/v3';

interface TubePreviewProps {
  grid: Grid | null;
}

const PX_WIDTH = 36;
const PX_HEIGHT = 20;
const TUBE_GAP = 10;
const PX_GAP = 1;
const CORNER_RADIUS = 4;

export function TubePreview({ grid }: TubePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const totalWidth = NUM_TUBES * PX_WIDTH + (NUM_TUBES - 1) * TUBE_GAP;
    const totalHeight = PIXELS_PER_TUBE * PX_HEIGHT + (PIXELS_PER_TUBE - 1) * PX_GAP;

    canvas.width = totalWidth + 40;
    canvas.height = totalHeight + 40;

    // Background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const offsetX = 20;
    const offsetY = 20;

    for (let t = 0; t < NUM_TUBES; t++) {
      const x = offsetX + t * (PX_WIDTH + TUBE_GAP);

      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        const y = offsetY + px * (PX_HEIGHT + PX_GAP);

        let r = 0, g = 0, b = 0;
        if (grid) {
          const i = (px * NUM_TUBES + t) * 3;
          r = Math.round(Math.min(1, grid[i]) * 255);
          g = Math.round(Math.min(1, grid[i + 1]) * 255);
          b = Math.round(Math.min(1, grid[i + 2]) * 255);
        }

        // Glow halo
        const brightness = (r + g + b) / (255 * 3);
        if (brightness > 0.1) {
          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${brightness * 0.3})`;
          ctx.beginPath();
          ctx.roundRect(x - 3, y - 3, PX_WIDTH + 6, PX_HEIGHT + 6, CORNER_RADIUS + 2);
          ctx.fill();
        }

        // Pixel
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.beginPath();
        ctx.roundRect(x, y, PX_WIDTH, PX_HEIGHT, CORNER_RADIUS);
        ctx.fill();

        // Subtle border
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Tube labels
    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    for (let t = 0; t < NUM_TUBES; t++) {
      const x = offsetX + t * (PX_WIDTH + TUBE_GAP) + PX_WIDTH / 2;
      ctx.fillText(`T${t + 1}`, x, canvas.height - 5);
    }
  }, [grid]);

  return (
    <div className="w-full h-full flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
