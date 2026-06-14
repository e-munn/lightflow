// 2D wash layer of the playground: the Amaran Halo as a radial light in the
// centre, and the two Shocker panels as flashes blooming from the bottom
// corners. The two Spot 160 movers are drawn separately in 3D (Spots3D.tsx) on
// a transparent canvas layered above this one. Both layers read the same
// per-frame Visual map, so what you see is the decoded DMX.

import { RIG, Visual } from './fixtures';

const rgbStr = (rgb: [number, number, number], a = 1) =>
  `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${a})`;

function radial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, rgb: [number, number, number], a: number) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgbStr(rgb, a));
  g.addColorStop(0.5, rgbStr(rgb, a * 0.35));
  g.addColorStop(1, rgbStr(rgb, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawWashes(ctx: CanvasRenderingContext2D, W: number, H: number, frame: Record<string, Visual>) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const minWH = Math.min(W, H);

  for (const f of RIG) {
    const v = frame[f.id];
    if (!v || v.intensity <= 0.002) continue;

    if (f.kind === 'halo100x') {
      // soft warm wash, centre-back of the stage
      radial(ctx, W / 2, H * 0.42, minWH * (0.4 + 0.45 * v.intensity), v.rgb, 0.4 * v.intensity);
    } else if (f.kind === 'shockerPanel') {
      // side wash: L fades IN from the hard-left edge, R from the hard-right edge
      // — a single smooth gradient (no stacked radials that blow out to white).
      const left = f.pos.x < 0.5;
      const reach = W * (0.16 + 0.12 * v.intensity); // how far across it washes
      const g = ctx.createLinearGradient(left ? 0 : W, 0, left ? reach : W - reach, 0);
      g.addColorStop(0, rgbStr(v.rgb, 0.5 * v.intensity));
      g.addColorStop(1, rgbStr(v.rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(left ? 0 : W - reach, 0, reach, H);
    } else if (f.kind === 'titanTube') {
      const pixels = v.pixels ?? [v.rgb];
      const barW = W * 0.5;
      const px = W / 2 - barW / 2;
      const pw = barW / pixels.length;
      for (let i = 0; i < pixels.length; i++) {
        radial(ctx, px + i * pw + pw / 2, H * 0.9, pw * 2, pixels[i], 0.6 * v.intensity);
      }
    }
  }
  ctx.restore();
}
