'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Screen3DProps {
  stemSignals: Record<string, number>;
  stemPans: Record<string, number>;
  stemNovelty: Record<string, number>;
}

const STEM_COLORS: Record<string, THREE.Color> = {
  bass:  new THREE.Color('#166534'), // dark green
  kick:  new THREE.Color('#22c55e'), // green
  snare: new THREE.Color('#a3e635'), // lime
  hat:   new THREE.Color('#facc15'), // yellow
  other: new THREE.Color('#6b7280'), // gray
};

// =============================================================================
// SPECTROGRAPH SCENE
// All 5 stems mapped to a continuous wave plane (or grid of points).
// Bands ordered front-to-back like frequency: kick → bass → snare → other → hat
// Pan biases amplitude horizontally.
// =============================================================================
function SpectrographScene({
  stemSignals,
  stemPans,
  stemNovelty,
}: {
  stemSignals: Record<string, number>;
  stemPans: Record<string, number>;
  stemNovelty: Record<string, number>;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const STEM_LIST = ['kick', 'bass', 'snare', 'other', 'hat'] as const;

  const SIZE = 40;
  const GRID_DIVISIONS = 320; // visible grid cells across the plane

  // Triangulated plane — supports thick anti-aliased grid lines drawn in fragment.
  const geometry = useMemo(() => {
    const segs = 220;
    return new THREE.PlaneGeometry(SIZE, SIZE, segs, segs);
  }, []);

  // Per-stem origins spread across the visible plane area.
  // Each owns its own region so colors don't muddy together.
  // Order: kick, bass, snare, other, hat
  const STEM_ORIGINS = useMemo(
    () => [
      new THREE.Vector2(0, -7),     // kick — front center (closest, low energy)
      new THREE.Vector2(-9, -2),    // bass — front-left
      new THREE.Vector2(9, -2),     // snare — front-right
      new THREE.Vector2(-6, 6),     // other — back-left
      new THREE.Vector2(6, 6),      // hat — back-right
    ],
    []
  );

  // Pool ring constants
  const RINGS_PER_STEM = 4;
  const RING_POOL_SIZE = RINGS_PER_STEM * 5;
  const RING_LIFE = 6.0;
  const RING_SPEED = 3.0;

  const uniforms = useMemo(
    () => ({
      uTime:    { value: 0 },
      uSig:     { value: new Float32Array(5) },
      uPans:    { value: new Float32Array(5) },
      uRingAge: { value: new Float32Array(RING_POOL_SIZE) },
      uRingAmp: { value: new Float32Array(RING_POOL_SIZE) },
      uOrigins: { value: STEM_ORIGINS },
      uColors: {
        value: STEM_LIST.map((s) => {
          const c = STEM_COLORS[s];
          return new THREE.Vector3(c.r, c.g, c.b);
        }),
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [STEM_ORIGINS]
  );

  // Initialize state once
  const initRef = useRef(false);
  if (!initRef.current) {
    uniforms.uRingAge.value.fill(RING_LIFE * 2);
    initRef.current = true;
  }

  const prevSigRef = useRef<Float32Array>(new Float32Array(5));

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;

    // Slower attack smooths out per-frame jitter from the analysis.
    const tauAttack = 0.18;
    const tauRelease = 3.5;
    const tauPan = 0.6;
    const aAttack = 1.0 - Math.exp(-dt / tauAttack);
    const aRelease = 1.0 - Math.exp(-dt / tauRelease);
    const aPan = 1.0 - Math.exp(-dt / tauPan);

    const sigs = uniforms.uSig.value;
    const pans = uniforms.uPans.value;
    const prevSig = prevSigRef.current;

    // Common: smooth signals, pans
    for (let i = 0; i < STEM_LIST.length; i++) {
      const stem = STEM_LIST[i];
      const target = stemSignals[stem] ?? 0;
      const a = target > sigs[i] ? aAttack : aRelease;
      sigs[i] += (target - sigs[i]) * a;
      pans[i] += ((stemPans[stem] ?? 0) - pans[i]) * aPan;
    }

    // Pool ring spawning: each stem fires new rings on novelty/rise events
    const ringAge = uniforms.uRingAge.value;
    const ringAmp = uniforms.uRingAmp.value;
    for (let k = 0; k < RING_POOL_SIZE; k++) ringAge[k] += dt;
    for (let i = 0; i < STEM_LIST.length; i++) {
      const stem = STEM_LIST[i];
      const nov = stemNovelty[stem] ?? 0;
      const rise = sigs[i] - prevSig[i];
      const spawn = nov > 0.28 || rise > 0.20;
      if (spawn) {
        const newAmp = Math.min(1.0, Math.max(nov, rise) * 1.6 + 0.2);
        const base = i * RINGS_PER_STEM;
        let weakestSlot = base;
        let weakestIntensity = Infinity;
        for (let j = 0; j < RINGS_PER_STEM; j++) {
          const k = base + j;
          const intensity = ringAmp[k] * Math.exp(-ringAge[k] / RING_LIFE);
          if (intensity < weakestIntensity) {
            weakestIntensity = intensity;
            weakestSlot = k;
          }
        }
        if (newAmp > weakestIntensity * 0.6) {
          ringAge[weakestSlot] = 0;
          ringAmp[weakestSlot] = newAmp;
        }
      }
    }

    for (let i = 0; i < STEM_LIST.length; i++) prevSig[i] = sigs[i];
  });

  const vertexShader = `
    uniform float uTime;
    uniform float uSig[5];
    uniform float uPans[5];
    uniform float uRingAge[20];
    uniform float uRingAmp[20];
    uniform vec2  uOrigins[5];
    uniform vec3  uColors[5];
    varying float vAlpha;
    varying vec3  vColor;
    varying float vEnergy;
    varying vec2  vUv;

    const float RING_SPEED = 3.0;
    const float RING_LIFE  = 6.0;

    float poolContribution(vec2 p, vec2 origin, float age, float amp) {
      if (amp < 0.001) return 0.0;
      float r = distance(p, origin);
      float r0 = age * RING_SPEED;
      float width = 0.7 + age * 0.45;
      float crest = exp(-pow((r - r0) / width, 2.0));
      float decay = exp(-age / RING_LIFE);
      return crest * decay * amp;
    }

    void main() {
      vUv = uv;
      vec3 pos = position;
      vec2 p = pos.xy;

      // Slow rolling base — gentle, always-on, very low frequency.
      // Driven by total energy so plane breathes with the song.
      float total = uSig[0] + uSig[1] + uSig[2] + uSig[3] + uSig[4];
      float t = uTime * 0.15;
      float base =
        sin(p.x * 0.35 + t) * 0.25 +
        cos(p.y * 0.3 - t * 0.7) * 0.2;
      base *= 0.08 + total * 0.10;

      // Per-stem rings: 4 concurrent slots per stem, 20 total. Older rings
      // keep traveling outward while new ones spawn behind them.
      // Each stem keeps its own color identity in its region — we track the
      // nearest origin and use that color, plus accumulate ring/puddle amplitude.
      float ringSum = 0.0;
      float closestDist = 1e9;
      int   closestStem = 0;
      float secondDist = 1e9;
      int   secondStem = 0;
      // Total puddle for the brightness contribution
      float puddleSum = 0.0;

      for (int i = 0; i < 5; i++) {
        vec2  origin = uOrigins[i];
        vec3  color  = uColors[i];

        // Track nearest two stems for smooth color blending at borders
        float d = distance(p, origin);
        if (d < closestDist) {
          secondDist = closestDist;
          secondStem = closestStem;
          closestDist = d;
          closestStem = i;
        } else if (d < secondDist) {
          secondDist = d;
          secondStem = i;
        }

        // Sharper puddle, weighted by signal strength so stems still bleed
        // outward when loud.
        float radius = 3.5 + uSig[i] * 4.0;
        float puddle = exp(-d * d / (radius * radius * 0.5)) * uSig[i] * 0.5;
        puddleSum += puddle;

        // Pool rings: 4 concurrent slots per stem expanding outward
        for (int j = 0; j < 4; j++) {
          int k = i * 4 + j;
          float c = poolContribution(p, origin, uRingAge[k], uRingAmp[k]);
          ringSum += c;
        }
      }

      pos.z = base + ringSum * 0.198;
      vEnergy = clamp(ringSum + total * 0.15 + puddleSum * 0.6, 0.0, 1.5);

      // Color from nearest stem with smooth blend at the boundary
      // (uses Voronoi-like distance ratio for soft edges)
      vec3 c1 = uColors[0];
      vec3 c2 = uColors[0];
      // Pick color by index (avoid dynamic array indexing for compatibility)
      if (closestStem == 0) c1 = uColors[0];
      else if (closestStem == 1) c1 = uColors[1];
      else if (closestStem == 2) c1 = uColors[2];
      else if (closestStem == 3) c1 = uColors[3];
      else c1 = uColors[4];

      if (secondStem == 0) c2 = uColors[0];
      else if (secondStem == 1) c2 = uColors[1];
      else if (secondStem == 2) c2 = uColors[2];
      else if (secondStem == 3) c2 = uColors[3];
      else c2 = uColors[4];

      // Blend factor: how close the second-nearest is to being equally close
      float blendT = closestDist / max(secondDist, 0.001);
      blendT = smoothstep(0.7, 1.0, blendT) * 0.5;
      vColor = mix(c1, c2, blendT);

      // Sides fade gently; near edge fades soft; far edge fades long for an
      // infinite-horizon feel.
      float edgeX = 1.0 - smoothstep(14.0, 20.0, abs(position.x));
      float edgeNear = 1.0 - smoothstep(16.0, 20.0, -position.y);
      float edgeFar  = 1.0 - smoothstep(2.0, 18.0, position.y);
      vAlpha = edgeX * edgeNear * edgeFar;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    varying float vAlpha;
    varying vec3  vColor;
    varying float vEnergy;
    varying vec2  vUv;

    void main() {
      vec3 color = vColor + vEnergy * 0.25;
      // Anti-aliased grid: thick lines drawn at every 1/${GRID_DIVISIONS} UV step.
      vec2 grid = abs(fract(vUv * ${GRID_DIVISIONS}.0 - 0.5) - 0.5);
      vec2 dgrid = fwidth(vUv * ${GRID_DIVISIONS}.0);
      float lineThickness = 1.0;
      vec2 g = smoothstep(dgrid * lineThickness, vec2(0.0), grid);
      float line = max(g.x, g.y);
      if (line < 0.02) discard;
      gl_FragColor = vec4(color, vAlpha * line * (0.5 + vEnergy * 0.6));
    }
  `;

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2 + 0.18, 0, 0]}
      position={[0, -0.9, -2]}
    >
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

export function Screen3D({ stemSignals, stemPans, stemNovelty }: Screen3DProps) {
  const fov = typeof window !== 'undefined' && window.innerWidth < 768 ? 95 : 75;
  return (
    <div className="absolute inset-0">
      <Canvas
        camera={{ position: [0, 0.12, 2.5], fov, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        gl={{ alpha: true, premultipliedAlpha: false }}
        style={{ background: 'transparent' }}
      >
        <SpectrographScene
          stemSignals={stemSignals}
          stemPans={stemPans}
          stemNovelty={stemNovelty}
        />
      </Canvas>
    </div>
  );
}

export function resetScreen3D() {}
