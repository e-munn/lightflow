import {
  NUM_TUBES, PIXELS_PER_TUBE, Grid, createGrid,
  EffectInstance, EffectContext, Region, Color, BlendMode,
} from '@/types/v3';

// --- Region helpers ---

function getTubeMask(region: Region): boolean[] {
  if (region.tubes) return Array.from({ length: NUM_TUBES }, (_, i) => region.tubes!.includes(i));
  const presets: Record<string, boolean[]> = {
    all: Array(8).fill(true),
    left: [true, true, true, true, false, false, false, false],
    right: [false, false, false, false, true, true, true, true],
    outer: [true, true, false, false, false, false, true, true],
    inner: [false, false, true, true, true, true, false, false],
  };
  return presets[region.preset || 'all'] || presets.all;
}

function getPixelRange(region: Region): [number, number] {
  if (region.pixel_range) return region.pixel_range;
  if (region.preset === 'top') return [0, 8];
  if (region.preset === 'bottom') return [8, 16];
  return [0, PIXELS_PER_TUBE];
}

function makeMask(region: Region): Float32Array {
  const mask = new Float32Array(PIXELS_PER_TUBE * NUM_TUBES);
  const tubes = getTubeMask(region);
  const [pxStart, pxEnd] = getPixelRange(region);
  for (let t = 0; t < NUM_TUBES; t++) {
    if (tubes[t]) {
      for (let px = pxStart; px < pxEnd; px++) {
        mask[px * NUM_TUBES + t] = 1.0;
      }
    }
  }
  return mask;
}

function applyColor(mask: Float32Array, color: Color, grid: Grid): void {
  for (let i = 0; i < PIXELS_PER_TUBE * NUM_TUBES; i++) {
    const m = mask[i];
    if (m > 0) {
      const gi = i * 3;
      grid[gi] = m * color.r;
      grid[gi + 1] = m * color.g;
      grid[gi + 2] = m * color.b;
    }
  }
}

function makePanMask(pan: number, baseMask: Float32Array): Float32Array {
  const center = (pan + 1.0) * 0.5 * (NUM_TUBES - 1);
  const sigma = 1.5;
  const weights = new Float32Array(NUM_TUBES);
  let mx = 0;
  for (let t = 0; t < NUM_TUBES; t++) {
    weights[t] = Math.exp(-0.5 * ((t - center) / sigma) ** 2);
    mx = Math.max(mx, weights[t]);
  }
  if (mx > 0) for (let t = 0; t < NUM_TUBES; t++) weights[t] /= mx;

  const result = new Float32Array(baseMask.length);
  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    for (let t = 0; t < NUM_TUBES; t++) {
      result[px * NUM_TUBES + t] = baseMask[px * NUM_TUBES + t] * weights[t];
    }
  }
  return result;
}

// --- Smoothing ---

const smoothState = new Map<string, number>();
const impactTriggerTimes = new Map<string, number>();

export function resetSmoothing(): void {
  smoothState.clear();
  impactTriggerTimes.clear();
}

function smoothValue(key: string, raw: number, attackMs: number, releaseMs: number, dt: number): number {
  const prev = smoothState.get(key) ?? raw;
  if (dt <= 0) { smoothState.set(key, raw); return raw; }
  const tau = Math.max((raw > prev ? attackMs : releaseMs) / 1000, 0.001);
  const alpha = 1 - Math.exp(-dt / tau);
  const val = prev + alpha * (raw - prev);
  smoothState.set(key, val);
  return val;
}

function resolveAttackMs(inst: EffectInstance, bpm: number): number {
  if (inst.attack_beats != null && bpm > 0) return inst.attack_beats * (60 / bpm) * 1000;
  return inst.attack_ms;
}

function resolveReleaseMs(inst: EffectInstance, bpm: number): number {
  if (inst.release_beats != null && bpm > 0) return inst.release_beats * (60 / bpm) * 1000;
  return inst.release_ms;
}

function smoothBpm(key: string, raw: number, inst: EffectInstance, ctx: EffectContext): number {
  return smoothValue(key, raw, resolveAttackMs(inst, ctx.bpm), resolveReleaseMs(inst, ctx.bpm), ctx.dt);
}

// --- Context helpers ---

function getStem(ctx: EffectContext, name: string): number {
  const solo = ctx.soloStem;
  // Vocals excluded from model entirely
  if (name === 'vocals') return 0;
  if (name === 'none') {
    if (solo) return 0.15;
    if (ctx.attention) {
      const domStem = ctx.attention.dominant;
      const domEnergy = (ctx.frame.stems as unknown as Record<string, number>)[domStem] ?? 0;
      return 0.3 + domEnergy * 0.7;
    }
    return 1.0;
  }
  const val = (ctx.frame.stems as unknown as Record<string, number>)[name] ?? 0;
  if (solo) {
    return name === solo ? Math.min(val * 2.5, 1.0) : 0.0;
  }
  if (ctx.attention) {
    const isDominant = name === ctx.attention.dominant;
    const novelty = ctx.attention.novelty[name] ?? 0;

    if (isDominant) {
      // Dominant stem: boost energy + novelty kick
      return Math.min(1.0, val * 1.4 + novelty * 0.5);
    } else {
      // Non-dominant: dim to 40% so dominant stands out
      // But allow novelty spikes through (incidental sounds)
      return Math.min(1.0, val * 0.4 + novelty * 1.5);
    }
  }
  return val;
}

function getOnset(ctx: EffectContext, name: string): number {
  return (ctx.frame.onsets as unknown as Record<string, number>)[name] ?? 0;
}

function getPan(ctx: EffectContext, name: string): number {
  return (ctx.frame.pans as unknown as Record<string, number>)[name] ?? 0;
}

function getBrightness(ctx: EffectContext, name: string): number {
  return (ctx.frame.brightness as unknown as Record<string, number>)[name] ?? 0.5;
}

// --- Effect type ---

type EffectRenderer = (ctx: EffectContext, inst: EffectInstance, key: string) => Grid;

// =============================================================================
// Effects (31 total)
// =============================================================================

// 1. solid
function solidEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  for (let i = 0; i < mask.length; i++) mask[i] *= intensity;
  applyColor(mask, inst.color, grid);
  return grid;
}

// 2. gradient
function gradientEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const c1 = inst.color;
  const c2 = inst.secondary_color || { r: 0, g: 0, b: 0 };

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    for (let t = 0; t < NUM_TUBES; t++) {
      let blend: number;
      if (inst.direction === 'up' || inst.direction === 'down') {
        blend = px / (PIXELS_PER_TUBE - 1);
        if (inst.direction === 'down') blend = 1 - blend;
      } else {
        blend = t / (NUM_TUBES - 1);
        if (inst.direction === 'left') blend = 1 - blend;
      }
      const m = mask[px * NUM_TUBES + t] * intensity;
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = (c1.r * (1 - blend) + c2.r * blend) * m;
      grid[i + 1] = (c1.g * (1 - blend) + c2.g * blend) * m;
      grid[i + 2] = (c1.b * (1 - blend) + c2.b * blend) * m;
    }
  }
  return grid;
}

// 3. color_wash
function colorWashEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const c1 = inst.color;
  const c2 = inst.secondary_color || { r: 0, g: 0.5, b: 1 };

  for (let t = 0; t < NUM_TUBES; t++) {
    const phase = ctx.time * inst.speed * 0.5 + t * 0.3;
    const blend = Math.sin(phase) * 0.5 + 0.5;
    const r = c1.r * (1 - blend) + c2.r * blend;
    const g = c1.g * (1 - blend) + c2.g * blend;
    const b = c1.b * (1 - blend) + c2.b * blend;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const m = mask[px * NUM_TUBES + t] * intensity;
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = r * m;
      grid[i + 1] = g * m;
      grid[i + 2] = b * m;
    }
  }
  return grid;
}

// 4. bass_fill
function bassFillEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let bass = getStem(ctx, inst.intensity_source) * inst.intensity;
  bass = smoothBpm(key, bass, inst, ctx);
  const fillHeight = bass * 1.1;

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    const pn = px / (PIXELS_PER_TUBE - 1);
    const fill = Math.min(1, Math.max(0, (fillHeight - (1 - pn)) / 0.15));
    for (let t = 0; t < NUM_TUBES; t++) {
      const m = mask[px * NUM_TUBES + t] * bass;
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = fill * inst.color.r * m;
      grid[i + 1] = fill * inst.color.g * m;
      grid[i + 2] = fill * inst.color.b * m;
    }
  }
  return grid;
}

// 5. kick_flash
function kickFlashEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  let m = makeMask(inst.region);
  let kick = getStem(ctx, inst.intensity_source) * inst.intensity;
  if (inst.onset_mode) kick = Math.max(kick, getOnset(ctx, 'kick'));
  kick = smoothBpm(key, kick, inst, ctx);
  if (inst.pan_follow) m = makePanMask(getPan(ctx, inst.intensity_source), m);
  const kick2 = kick * kick;
  for (let i = 0; i < m.length; i++) m[i] *= kick2;
  applyColor(m, inst.color, grid);
  return grid;
}

// 6. snare_accent
function snareAccentEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  let m = makeMask(inst.region);
  let snare = getStem(ctx, inst.intensity_source) * inst.intensity;
  if (inst.onset_mode) snare = Math.max(snare, getOnset(ctx, 'snare'));
  snare = smoothBpm(key, snare, inst, ctx);
  if (inst.pan_follow) m = makePanMask(getPan(ctx, inst.intensity_source), m);
  for (let i = 0; i < m.length; i++) m[i] *= snare;
  applyColor(m, inst.color, grid);
  return grid;
}

// 7. hat_sparkle
function hatSparkleEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  let m = makeMask(inst.region);
  let hat = getStem(ctx, inst.intensity_source) * inst.intensity;
  if (inst.onset_mode) hat = Math.max(hat, getOnset(ctx, 'hat'));
  hat = smoothBpm(key, hat, inst, ctx);
  if (inst.pan_follow) m = makePanMask(getPan(ctx, inst.intensity_source), m);

  const timeSlot = Math.floor(ctx.time * 8);
  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const seed = Math.abs(Math.sin((t * 16 + px) * 127.1 + timeSlot * 311.7) * 43758.5453) % 1;
      if (seed > (1 - hat * 0.5)) {
        const spark = m[px * NUM_TUBES + t] * hat;
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = spark * inst.color.r;
        grid[i + 1] = spark * inst.color.g;
        grid[i + 2] = spark * inst.color.b;
      }
    }
  }
  return grid;
}

// 8. vocal_wave
function vocalWaveEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let vocals = getStem(ctx, inst.intensity_source) * inst.intensity;
  vocals = smoothBpm(key, vocals, inst, ctx);

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const pn = px / (PIXELS_PER_TUBE - 1);
      const wave = Math.sin(pn * 2 * Math.PI + ctx.time * inst.speed * 1.5 + t * 0.5) * 0.5 + 0.5;
      const val = wave * vocals * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }
  return grid;
}

// 9. energy_pulse
function energyPulseEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let energy = getStem(ctx, inst.intensity_source) * inst.intensity;
  energy = smoothBpm(key, energy, inst, ctx);
  const pulse = (Math.cos(ctx.beatPhase * 2 * Math.PI) * 0.5 + 0.5) * energy;
  for (let i = 0; i < mask.length; i++) mask[i] *= pulse;
  applyColor(mask, inst.color, grid);
  return grid;
}

// 10. chase
function chaseEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const effectiveSpeed = inst.speed * (0.5 + intensity * 0.5);
  const bps = ctx.bpm / 60;

  if (inst.direction === 'left' || inst.direction === 'right') {
    let pos = (ctx.time * bps * effectiveSpeed) % NUM_TUBES;
    if (inst.direction === 'left') pos = NUM_TUBES - 1 - pos;
    for (let t = 0; t < NUM_TUBES; t++) {
      const dist = Math.min(Math.abs(t - pos), NUM_TUBES - Math.abs(t - pos));
      const val = Math.max(0, 1 - dist / 2) * intensity;
      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        const m = mask[px * NUM_TUBES + t];
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = val * inst.color.r * m;
        grid[i + 1] = val * inst.color.g * m;
        grid[i + 2] = val * inst.color.b * m;
      }
    }
  } else {
    let pos = (ctx.time * bps * effectiveSpeed) % PIXELS_PER_TUBE;
    if (inst.direction === 'up') pos = PIXELS_PER_TUBE - 1 - pos;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const dist = Math.min(Math.abs(px - pos), PIXELS_PER_TUBE - Math.abs(px - pos));
      const val = Math.max(0, 1 - dist / 3) * intensity;
      for (let t = 0; t < NUM_TUBES; t++) {
        const m = mask[px * NUM_TUBES + t];
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = val * inst.color.r * m;
        grid[i + 1] = val * inst.color.g * m;
        grid[i + 2] = val * inst.color.b * m;
      }
    }
  }
  return grid;
}

// 11. scan
function scanEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const effectiveSpeed = inst.speed * (0.5 + intensity * 0.5);
  const bps = ctx.bpm / 60;
  let phase = (ctx.time * bps * effectiveSpeed * 0.5) % 2;
  if (phase > 1) phase = 2 - phase;
  const pos = phase * (NUM_TUBES - 1);

  for (let t = 0; t < NUM_TUBES; t++) {
    const dist = Math.abs(t - pos);
    const val = Math.max(0, 1 - dist / 1.5) * intensity;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const m = mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r * m;
      grid[i + 1] = val * inst.color.g * m;
      grid[i + 2] = val * inst.color.b * m;
    }
  }
  return grid;
}

// 12. rain
function rainEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let drop = 0; drop < 3; drop++) {
      const seed = (t * 3 + drop) * 7.13;
      const dropSpeed = 0.5 + (seed % 1) * inst.speed;
      const dropPos = (ctx.time * dropSpeed + seed * 2.7) % 1;
      const px = Math.floor(dropPos * PIXELS_PER_TUBE);
      if (px >= 0 && px < PIXELS_PER_TUBE) {
        const val = intensity * mask[px * NUM_TUBES + t];
        const gi = (px * NUM_TUBES + t) * 3;
        grid[gi] = val * inst.color.r;
        grid[gi + 1] = val * inst.color.g;
        grid[gi + 2] = val * inst.color.b;
        for (let tail = 1; tail < 4; tail++) {
          const tpx = px - tail;
          if (tpx >= 0) {
            const fade = 1 - tail / 4;
            const tv = intensity * fade * mask[tpx * NUM_TUBES + t];
            const ti = (tpx * NUM_TUBES + t) * 3;
            grid[ti] = Math.max(grid[ti], tv * inst.color.r);
            grid[ti + 1] = Math.max(grid[ti + 1], tv * inst.color.g);
            grid[ti + 2] = Math.max(grid[ti + 2], tv * inst.color.b);
          }
        }
      }
    }
  }
  return grid;
}

// 13. ripple
function rippleEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const cx = NUM_TUBES / 2, cy = PIXELS_PER_TUBE / 2;
  const bps = ctx.bpm / 60;
  const wavePos = (ctx.time * bps * inst.speed) % 10;

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const dist = Math.sqrt((t - cx) ** 2 + (px - cy) ** 2);
      const wave = Math.sin(dist * 1.5 - wavePos * 3) * 0.5 + 0.5;
      const val = wave * intensity * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }
  return grid;
}

// 14. buildup_rise
function buildupRiseEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    const pn = px / (PIXELS_PER_TUBE - 1);
    let level = Math.min(1, Math.max(0, (intensity - (1 - pn)) / 0.2));
    if (Math.abs(pn - (1 - intensity)) < 0.15) {
      level *= Math.sin(ctx.time * inst.speed * 10) * 0.3 + 0.7;
    }
    for (let t = 0; t < NUM_TUBES; t++) {
      const m = mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = level * inst.color.r * m;
      grid[i + 1] = level * inst.color.g * m;
      grid[i + 2] = level * inst.color.b * m;
    }
  }
  return grid;
}

// 15. strobe
function strobeEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  const intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  const bps = ctx.bpm / 60;
  const on = Math.floor(ctx.time * bps * inst.speed * 2) % 2;
  if (on) {
    for (let i = 0; i < mask.length; i++) mask[i] *= intensity;
    applyColor(mask, inst.color, grid);
  }
  return grid;
}

// 16. blackout
function blackoutEffect(): Grid {
  return createGrid();
}

// 17. fade_in
function fadeInEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  return solidEffect(ctx, inst, key);
}

// 18. fade_out
function fadeOutEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  return solidEffect(ctx, inst, key);
}

// 19. pan_sweep
function panSweepEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const pan = getPan(ctx, inst.intensity_source);
  const center = (pan + 1) * 0.5 * (NUM_TUBES - 1);
  const sigma = 0.75;

  for (let t = 0; t < NUM_TUBES; t++) {
    const weight = Math.exp(-0.5 * ((t - center) / sigma) ** 2);
    const val = weight * intensity;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const m = mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r * m;
      grid[i + 1] = val * inst.color.g * m;
      grid[i + 2] = val * inst.color.b * m;
    }
  }
  return grid;
}

// 20. spectral_color
function spectralColorEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  let m = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const brightness = getBrightness(ctx, inst.intensity_source);
  const c1 = inst.color;
  const c2 = inst.secondary_color || { r: 0, g: 0.5, b: 1 };
  const blended: Color = {
    r: c1.r * (1 - brightness) + c2.r * brightness,
    g: c1.g * (1 - brightness) + c2.g * brightness,
    b: c1.b * (1 - brightness) + c2.b * brightness,
  };
  if (inst.pan_follow) m = makePanMask(getPan(ctx, inst.intensity_source), m);
  for (let i = 0; i < m.length; i++) m[i] *= intensity;
  applyColor(m, blended, grid);
  return grid;
}

// 21. flux_burst
function fluxBurstEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let flux = ctx.frame.spectral_flux * inst.intensity;
  flux = smoothBpm(key, flux, inst, ctx);
  const cx = NUM_TUBES / 2, cy = PIXELS_PER_TUBE / 2;
  const bps = ctx.bpm / 60;
  const ringRadius = (ctx.time * bps * inst.speed) % 12;
  const ringWidth = 2;

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const dist = Math.sqrt((t - cx) ** 2 + (px - cy) ** 2);
      const ringVal = Math.max(0, 1 - Math.abs(dist - ringRadius) / ringWidth);
      const val = ringVal * flux * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }
  return grid;
}

// 22. breathe
function breatheEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const bps = ctx.bpm / 60;
  const cycleFreq = bps * inst.speed / 8;

  for (let t = 0; t < NUM_TUBES; t++) {
    const phaseOffset = t * 0.15;
    const breathe = Math.sin(2 * Math.PI * cycleFreq * ctx.time + phaseOffset) * 0.5 + 0.5;
    const val = breathe * intensity;
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const m = mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r * m;
      grid[i + 1] = val * inst.color.g * m;
      grid[i + 2] = val * inst.color.b * m;
    }
  }
  return grid;
}

// 23. meteor
function meteorEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const bps = ctx.bpm / 60;
  const goingUp = inst.direction === 'up';
  const tailLen = 8;

  for (let t = 0; t < NUM_TUBES; t++) {
    const seed = t * 2.37;
    const meteorSpeed = 0.4 + (seed % 1) * 0.3;
    const effectiveSpeed = meteorSpeed * inst.speed * bps * 0.25;
    const pos = (ctx.time * effectiveSpeed + seed * 1.7) % 1;
    const headPx = goingUp
      ? PIXELS_PER_TUBE - 1 - Math.floor(pos * PIXELS_PER_TUBE)
      : Math.floor(pos * PIXELS_PER_TUBE);

    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const dist = goingUp ? px - headPx : headPx - px;
      if (dist >= 0 && dist <= tailLen) {
        const brt = Math.exp(-dist * 0.5) * intensity;
        const val = brt * mask[px * NUM_TUBES + t];
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = val * inst.color.r;
        grid[i + 1] = val * inst.color.g;
        grid[i + 2] = val * inst.color.b;
      }
    }
  }
  return grid;
}

// 24. firefly
function fireflyEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);

  for (let fi = 0; fi < 12; fi++) {
    const seedA = Math.abs(Math.sin(fi * 127.1) * 43758.5453) % 1;
    const seedB = Math.abs(Math.sin(fi * 269.5) * 29103.7137) % 1;
    const tube = Math.floor(seedA * NUM_TUBES) % NUM_TUBES;
    const px = Math.floor(seedB * PIXELS_PER_TUBE) % PIXELS_PER_TUBE;
    const period = (1.5 + (Math.abs(Math.sin(fi * 43.7)) % 1) * 4) / Math.max(inst.speed, 0.1);
    const phase = (ctx.time / period + seedA * 3.7) % 1;
    const glow = phase < 0.2 ? phase / 0.2 : 1 - (phase - 0.2) / 0.8;
    const val = glow * intensity * mask[px * NUM_TUBES + tube];

    const ci = (px * NUM_TUBES + tube) * 3;
    grid[ci] = Math.max(grid[ci], val * inst.color.r);
    grid[ci + 1] = Math.max(grid[ci + 1], val * inst.color.g);
    grid[ci + 2] = Math.max(grid[ci + 2], val * inst.color.b);
    for (const dpx of [-1, 1]) {
      const npx = px + dpx;
      if (npx >= 0 && npx < PIXELS_PER_TUBE) {
        const sv = val * 0.4;
        const ni = (npx * NUM_TUBES + tube) * 3;
        grid[ni] = Math.max(grid[ni], sv * inst.color.r);
        grid[ni + 1] = Math.max(grid[ni + 1], sv * inst.color.g);
        grid[ni + 2] = Math.max(grid[ni + 2], sv * inst.color.b);
      }
    }
  }
  return grid;
}

// 25. strobe_chase
function strobeChaseEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let baseIntensity = inst.intensity;
  if (inst.intensity_source !== 'none') baseIntensity *= 0.5 + 0.5 * getStem(ctx, inst.intensity_source);
  const bps = ctx.bpm / 60;
  const beatNum = ctx.time * bps * inst.speed;
  const activeTube = Math.floor(beatNum) % NUM_TUBES;
  const subPhase = beatNum % 1;
  const on = Math.floor(subPhase * 4) % 2;

  if (on) {
    for (const dt of [-1, 0, 1]) {
      const t = ((activeTube + dt) % NUM_TUBES + NUM_TUBES) % NUM_TUBES;
      const falloff = dt === 0 ? 1 : 0.4;
      const val = baseIntensity * falloff;
      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        const m = mask[px * NUM_TUBES + t];
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = val * inst.color.r * m;
        grid[i + 1] = val * inst.color.g * m;
        grid[i + 2] = val * inst.color.b * m;
      }
    }
  }
  return grid;
}

// 26. impact
function impactEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  const intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  let onset = ['kick', 'snare', 'hat'].includes(inst.intensity_source) ? getOnset(ctx, inst.intensity_source) : 0;
  onset = Math.max(onset, getStem(ctx, inst.intensity_source));

  const bps = ctx.bpm > 0 ? ctx.bpm / 60 : 2;
  const quarterBeatSec = 0.25 / bps;
  const lastTrigger = impactTriggerTimes.get(key) ?? -999;

  if (onset > 0.6 && (ctx.time - lastTrigger) > quarterBeatSec) {
    impactTriggerTimes.set(key, ctx.time);
  }

  const triggerTime = impactTriggerTimes.get(key) ?? -999;
  const elapsed = ctx.time - triggerTime;
  const decayDuration = 1.5 / bps;
  if (elapsed > decayDuration) return grid;

  const progress = elapsed / decayDuration;
  const cx = NUM_TUBES / 2, cy = PIXELS_PER_TUBE / 2;

  if (progress < 0.15) {
    const flash = (1 - progress / 0.15) * intensity;
    for (let i = 0; i < mask.length; i++) mask[i] *= flash;
    applyColor(mask, inst.color, grid);
    return grid;
  }

  const ringRadius = (progress - 0.15) / 0.85 * Math.max(NUM_TUBES, PIXELS_PER_TUBE) * 0.6;
  const ringFade = (1 - progress) * intensity;

  for (let t = 0; t < NUM_TUBES; t++) {
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const dist = Math.sqrt((t - cx) ** 2 + (px - cy) ** 2);
      const ringVal = Math.max(0, 1 - Math.abs(dist - ringRadius) / 2);
      const val = ringVal * ringFade * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }
  return grid;
}

// 27. lighthouse
function lighthouseEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const bps = ctx.bpm / 60;
  let phase = (ctx.time * bps * inst.speed / 4) % 2;
  if (phase > 1) phase = 2 - phase;
  const beamCenter = phase * (NUM_TUBES - 1);
  const sigma = 1.2;

  for (let t = 0; t < NUM_TUBES; t++) {
    const beam = Math.exp(-0.5 * ((t - beamCenter) / sigma) ** 2);
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const vertGrad = 0.4 + 0.6 * (1 - px / (PIXELS_PER_TUBE - 1));
      const val = beam * vertGrad * intensity * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }
  return grid;
}

// 28. breathe_y
function breatheYEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const bps = ctx.bpm / 60;
  const cycleFreq = bps * inst.speed / 8;

  for (let px = 0; px < PIXELS_PER_TUBE; px++) {
    const pn = px / (PIXELS_PER_TUBE - 1);
    const wave = Math.sin(2 * Math.PI * (cycleFreq * ctx.time - pn * 0.8)) * 0.5 + 0.5;
    const val = wave * intensity;
    for (let t = 0; t < NUM_TUBES; t++) {
      const m = mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r * m;
      grid[i + 1] = val * inst.color.g * m;
      grid[i + 2] = val * inst.color.b * m;
    }
  }
  return grid;
}

// 29. candles
function candlesEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);

  for (let ci = 0; ci < 10; ci++) {
    const seedA = Math.abs(Math.sin(ci * 127.1) * 43758.5453) % 1;
    const tube = Math.floor(seedA * NUM_TUBES) % NUM_TUBES;
    const seedB = Math.abs(Math.sin(ci * 269.5) * 29103.7137) % 1;
    const px = Math.max(0, Math.min(PIXELS_PER_TUBE - 1, PIXELS_PER_TUBE - 1 - Math.floor(seedB * 6)));
    const period = (3 + (Math.abs(Math.sin(ci * 43.7)) % 1) * 5) / Math.max(inst.speed, 0.1);
    const phase = (ctx.time / period + seedA * 2.1) % 1;
    let glow = Math.sin(phase * 2 * Math.PI) * 0.3 + 0.7;
    glow = Math.max(0, Math.min(1, glow + Math.sin(ctx.time * (2 + ci * 0.3)) * 0.15));
    const bottomWeight = px / (PIXELS_PER_TUBE - 1);
    const val = glow * intensity * bottomWeight * mask[px * NUM_TUBES + tube];

    for (let dpx = -2; dpx <= 2; dpx++) {
      const npx = px + dpx;
      if (npx >= 0 && npx < PIXELS_PER_TUBE) {
        const falloff = Math.exp(-Math.abs(dpx) * 0.8);
        const sv = val * falloff;
        const ni = (npx * NUM_TUBES + tube) * 3;
        grid[ni] = Math.max(grid[ni], sv * inst.color.r);
        grid[ni + 1] = Math.max(grid[ni + 1], sv * inst.color.g);
        grid[ni + 2] = Math.max(grid[ni + 2], sv * inst.color.b);
      }
    }
  }
  return grid;
}

// 30. firecracker
function firecrackerEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  const intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  const cx = NUM_TUBES / 2, cy = PIXELS_PER_TUBE / 2;
  const bps = ctx.bpm / 60;
  const cyclePeriod = 1 / (bps * inst.speed);
  const burstPhase = (ctx.time % cyclePeriod) / cyclePeriod;
  const maxRadius = Math.sqrt(cx ** 2 + cy ** 2);
  const frontRadius = burstPhase * maxRadius * 1.5;
  const burstFade = Math.max(0, 1 - burstPhase * 1.2);

  for (let si = 0; si < 24; si++) {
    const angle = si * (2 * Math.PI / 24) + si * 0.37;
    const speedVar = 0.6 + Math.abs(Math.sin(si * 73.1)) % 1 * 0.8;
    const r = frontRadius * speedVar;
    const sx = cx + Math.cos(angle) * r;
    const sy = cy + Math.sin(angle) * r;
    const t = Math.round(sx);
    const px = Math.round(sy);

    if (t >= 0 && t < NUM_TUBES && px >= 0 && px < PIXELS_PER_TUBE) {
      const flickerSeed = Math.abs(Math.sin(si * 311.7 + ctx.time * 47) % 1);
      if (flickerSeed > 0.3) {
        const val = burstFade * intensity * flickerSeed * mask[px * NUM_TUBES + t];
        const gi = (px * NUM_TUBES + t) * 3;
        grid[gi] = Math.max(grid[gi], val * inst.color.r);
        grid[gi + 1] = Math.max(grid[gi + 1], val * inst.color.g);
        grid[gi + 2] = Math.max(grid[gi + 2], val * inst.color.b);
      }
    }
  }
  return grid;
}

// 31. abracadabra
function abracadabraEffect(ctx: EffectContext, inst: EffectInstance, key: string): Grid {
  const grid = createGrid();
  const mask = makeMask(inst.region);
  let intensity = getStem(ctx, inst.intensity_source) * inst.intensity;
  intensity = smoothBpm(key, intensity, inst, ctx);
  const speed = inst.speed;
  const sigmaT = 0.8, sigmaPx = 1.5;

  const tubeF = Math.sin(ctx.time * speed * 1.3) * 2.5 + Math.sin(ctx.time * speed * 0.7 + 1) * 1.5 + Math.sin(ctx.time * speed * 2.9 + 2.5) * 0.8;
  const tubeCenter = Math.max(0, Math.min(NUM_TUBES - 1, (NUM_TUBES - 1) / 2 + tubeF * 0.5));
  const pxF = Math.sin(ctx.time * speed * 0.9 + 0.5) * 4 + Math.sin(ctx.time * speed * 1.7 + 3) * 2;
  const pxCenter = Math.max(0, Math.min(PIXELS_PER_TUBE - 1, (PIXELS_PER_TUBE - 1) / 2 + pxF * 0.5));

  for (let t = 0; t < NUM_TUBES; t++) {
    const wt = Math.exp(-0.5 * ((t - tubeCenter) / sigmaT) ** 2);
    for (let px = 0; px < PIXELS_PER_TUBE; px++) {
      const wpx = Math.exp(-0.5 * ((px - pxCenter) / sigmaPx) ** 2);
      const val = wt * wpx * intensity * mask[px * NUM_TUBES + t];
      const i = (px * NUM_TUBES + t) * 3;
      grid[i] = val * inst.color.r;
      grid[i + 1] = val * inst.color.g;
      grid[i + 2] = val * inst.color.b;
    }
  }

  // Trail
  for (let trailI = 1; trailI <= 6; trailI++) {
    const trailT = ctx.time - trailI * 0.06 / Math.max(speed, 0.1);
    const ttF = Math.sin(trailT * speed * 1.3) * 2.5 + Math.sin(trailT * speed * 0.7 + 1) * 1.5 + Math.sin(trailT * speed * 2.9 + 2.5) * 0.8;
    const ttCenter = Math.max(0, Math.min(NUM_TUBES - 1, (NUM_TUBES - 1) / 2 + ttF * 0.5));
    const tpF = Math.sin(trailT * speed * 0.9 + 0.5) * 4 + Math.sin(trailT * speed * 1.7 + 3) * 2;
    const tpCenter = Math.max(0, Math.min(PIXELS_PER_TUBE - 1, (PIXELS_PER_TUBE - 1) / 2 + tpF * 0.5));
    const fade = Math.exp(-trailI * 0.5);

    for (let t = 0; t < NUM_TUBES; t++) {
      const wt = Math.exp(-0.5 * ((t - ttCenter) / sigmaT) ** 2);
      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        const wpx = Math.exp(-0.5 * ((px - tpCenter) / sigmaPx) ** 2);
        const val = wt * wpx * fade * intensity * mask[px * NUM_TUBES + t];
        const i = (px * NUM_TUBES + t) * 3;
        grid[i] = Math.max(grid[i], val * inst.color.r);
        grid[i + 1] = Math.max(grid[i + 1], val * inst.color.g);
        grid[i + 2] = Math.max(grid[i + 2], val * inst.color.b);
      }
    }
  }
  return grid;
}

// --- Effect registry ---

const EFFECT_REGISTRY: Record<string, EffectRenderer> = {
  solid: solidEffect,
  gradient: gradientEffect,
  color_wash: colorWashEffect,
  bass_fill: bassFillEffect,
  kick_flash: kickFlashEffect,
  snare_accent: snareAccentEffect,
  hat_sparkle: hatSparkleEffect,
  vocal_wave: vocalWaveEffect,
  energy_pulse: energyPulseEffect,
  chase: chaseEffect,
  scan: scanEffect,
  rain: rainEffect,
  ripple: rippleEffect,
  buildup_rise: buildupRiseEffect,
  strobe: strobeEffect,
  blackout: () => blackoutEffect(),
  fade_in: fadeInEffect,
  fade_out: fadeOutEffect,
  pan_sweep: panSweepEffect,
  spectral_color: spectralColorEffect,
  flux_burst: fluxBurstEffect,
  breathe: breatheEffect,
  meteor: meteorEffect,
  firefly: fireflyEffect,
  strobe_chase: strobeChaseEffect,
  impact: impactEffect,
  lighthouse: lighthouseEffect,
  breathe_y: breatheYEffect,
  candles: candlesEffect,
  firecracker: firecrackerEffect,
  abracadabra: abracadabraEffect,
};

// --- Compositing ---

export function compositeFrame(layers: Array<{ grid: Grid; blendMode: BlendMode }>): Grid {
  const result = createGrid();
  for (const { grid, blendMode } of layers) {
    const len = result.length;
    if (blendMode === 'add') {
      for (let i = 0; i < len; i++) result[i] += grid[i];
    } else if (blendMode === 'replace') {
      for (let px = 0; px < PIXELS_PER_TUBE; px++) {
        for (let t = 0; t < NUM_TUBES; t++) {
          const i = (px * NUM_TUBES + t) * 3;
          if (grid[i] + grid[i + 1] + grid[i + 2] > 0) {
            result[i] = grid[i];
            result[i + 1] = grid[i + 1];
            result[i + 2] = grid[i + 2];
          }
        }
      }
    } else { // max
      for (let i = 0; i < len; i++) result[i] = Math.max(result[i], grid[i]);
    }
  }
  // Clamp
  for (let i = 0; i < result.length; i++) result[i] = Math.min(1, result[i]);
  return result;
}

// --- Main render function ---

export function renderSectionFrame(effects: EffectInstance[], ctx: EffectContext): Grid {
  const layers: Array<{ grid: Grid; blendMode: BlendMode }> = [];
  for (let e = 0; e < effects.length; e++) {
    const inst = effects[e];
    const effectFn = EFFECT_REGISTRY[inst.effect];
    if (!effectFn) continue;
    const key = `${e}_${inst.effect}`;
    const grid = effectFn(ctx, inst, key);
    layers.push({ grid, blendMode: inst.blend_mode });
  }
  return compositeFrame(layers);
}

// --- Glow post-processing (simplified for browser) ---

export function applyGlow(grid: Grid, amount: number = 0.3): Grid {
  const result = new Float32Array(grid);
  // Simple 3x3 box blur per channel
  for (let ch = 0; ch < 3; ch++) {
    for (let px = 1; px < PIXELS_PER_TUBE - 1; px++) {
      for (let t = 0; t < NUM_TUBES; t++) {
        let sum = 0;
        let count = 0;
        for (let dpx = -1; dpx <= 1; dpx++) {
          for (let dt = -1; dt <= 1; dt++) {
            const nt = t + dt;
            if (nt >= 0 && nt < NUM_TUBES) {
              sum += grid[((px + dpx) * NUM_TUBES + nt) * 3 + ch];
              count++;
            }
          }
        }
        result[(px * NUM_TUBES + t) * 3 + ch] = Math.min(1, grid[(px * NUM_TUBES + t) * 3 + ch] + (sum / count) * amount);
      }
    }
  }
  return result;
}
