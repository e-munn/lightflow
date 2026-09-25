import type { PoseFrame } from './types';

export type SmoothingSettings = { enabled: boolean; steadiness: number; responsiveness: number; compare: boolean };
export const DEFAULT_SMOOTHING: SmoothingSettings = { enabled: true, steadiness: 55, responsiveness: 35, compare: false };
const unit = (value: number) => Math.max(0, Math.min(100, value)) / 100;
const alpha = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
const valid = (p: number[]) => p.length >= 4 && p[3] >= .5 && p.slice(0, 2).every(v => Number.isFinite(v) && v >= 0 && v <= 1);
type Joint = { raw: number[]; value: number[]; velocity: number[] };

/** Causal, speed-adaptive low-pass (1€ filter). Display only; never mutates source poses.
 * Uses source timestamps and image-height units, not browser frame rate or playback rate.
 * Method/tuning: https://gery.casiez.net/1euro/
 */
export function smoothSkeletonFrames(frames: PoseFrame[], settings: SmoothingSettings, aspect = 1): PoseFrame[] {
  if (!settings.enabled || settings.steadiness <= 0) return frames;
  const minCutoff = 24 * Math.pow(.6 / 24, unit(settings.steadiness));
  const beta = 18 * unit(settings.responsiveness);
  const scale = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  let joints = new Map<number, Joint>();
  let previous: PoseFrame | null = null;
  return frames.map(frame => {
    const pose = frame.primary === null ? null : frame.poses[frame.primary];
    const dt = previous ? frame.t - previous.t : 0;
    if (!pose || !previous || dt <= 0 || dt > .15 || frame.cut || previous.track !== frame.track) joints.clear();
    previous = frame;
    if (!pose) return frame;
    const points = pose.map((point, index) => {
      if (!valid(point)) { joints.delete(index); return point; }
      const raw = [point[0] * scale, point[1]], old = joints.get(index);
      if (!old) { joints.set(index, { raw, value: raw, velocity: [0, 0] }); return point; }
      const aD = alpha(1, dt);
      const velocity = raw.map((x, axis) => aD * (x - old.raw[axis]) / dt + (1 - aD) * old.velocity[axis]);
      const a = alpha(minCutoff + beta * Math.hypot(...velocity), dt);
      const value = raw.map((x, axis) => a * x + (1 - a) * old.value[axis]);
      joints.set(index, { raw, value, velocity });
      return [value[0] / scale, value[1], ...point.slice(2)];
    });
    const poses = frame.poses.slice(); poses[frame.primary!] = points;
    return { ...frame, poses };
  });
}

/** Process every saved frame once so seeking, dropped display frames, and speed changes
 * show the same result at the same source timestamp. Cache never crosses a source array.
 */
export class SkeletonDisplayFilter {
  private input: PoseFrame[] | null = null;
  private key = '';
  private output: PoseFrame[] = [];
  frames(input: PoseFrame[], settings: SmoothingSettings, aspect: number) {
    const key = `${settings.enabled}/${settings.steadiness}/${settings.responsiveness}/${aspect}`;
    if (this.input !== input || this.key !== key) {
      this.input = input; this.key = key;
      this.output = smoothSkeletonFrames(input, settings, aspect);
    }
    return this.output;
  }
}
