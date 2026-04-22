'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * 3-peak Spectro scene.
 * A tilted grid plane with three Gaussian peaks driven by the low /
 * mid / high band values from the multi-channel pipeline. Low peak
 * sits at the front (near camera), mid in the middle, high at the
 * back. All monochrome white on black.
 */

interface Screen3DProps {
  /** 0..1 — normalized low-band signal (bass+kick) */
  low: number;
  /** 0..1 — normalized mid-band signal (snare+other) */
  mid: number;
  /** 0..1 — normalized high-band signal (hat strobe) */
  high: number;
}

function PeakPlane({ low, mid, high }: Screen3DProps) {
  const SIZE = 40;
  const SEGS = 220;
  const GRID_DIVISIONS = 320;

  const geometry = useMemo(
    () => new THREE.PlaneGeometry(SIZE, SIZE, SEGS, SEGS),
    [],
  );

  // Triangle layout on the plane. The plane is tilted so +y becomes
  // depth — "front" is the near edge.
  //   LOW  (bass)  → front-center, close to camera (y=-4 keeps it
  //                  well above the near-edge fade at y=-16..-20 so
  //                  the peak reads as a discrete bump, not part of
  //                  the foreground gradient)
  //   MID  (snare) → back-right, far
  //   HIGH (hat)   → back-left,  far
  const PEAK_ORIGINS = useMemo(
    () => [
      new THREE.Vector2( 0, -4),  // LOW — front center
      new THREE.Vector2( 7,  3),  // MID (snare) — mid-right, closer in
      new THREE.Vector2(-7,  3),  // HIGH (hat)  — mid-left,  closer in
    ],
    [],
  );

  const uniforms = useMemo(
    () => ({
      uTime:    { value: 0 },
      uBands:   { value: new Float32Array([0, 0, 0]) },
      uOrigins: { value: PEAK_ORIGINS },
    }),
    [PEAK_ORIGINS],
  );

  useFrame((state, dt) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    // Smooth the incoming band values — lightly on attack, slower on
    // release — so the 3D animation reads as continuous even when React
    // updates at ~30Hz.
    const aAttack  = 1 - Math.exp(-dt / 0.08);
    const aRelease = 1 - Math.exp(-dt / 0.35);
    const targets = [low, mid, high];
    const bands = uniforms.uBands.value;
    for (let i = 0; i < 3; i++) {
      const a = targets[i] > bands[i] ? aAttack : aRelease;
      bands[i] += (targets[i] - bands[i]) * a;
    }
  });

  const vertexShader = `
    uniform float uTime;
    uniform float uBands[3];
    uniform vec2  uOrigins[3];
    varying float vEnergy;
    varying float vAlpha;
    varying vec2  vUv;

    float peak(vec2 p, vec2 origin, float amp, float radius) {
      if (amp < 0.001) return 0.0;
      float d = distance(p, origin);
      return amp * exp(-d * d / (radius * radius));
    }

    void main() {
      vUv = uv;
      vec3 pos = position;
      vec2 p = pos.xy;

      // Total energy drives a gentle always-on base wobble so the plane
      // breathes with the song.
      float total = uBands[0] + uBands[1] + uBands[2];
      float t = uTime * 0.15;
      float base =
        sin(p.x * 0.3 + t) * 0.18 +
        cos(p.y * 0.25 - t * 0.6) * 0.15;
      base *= 0.05 + total * 0.08;

      // Three tight peaks. Radii are deliberately small so the peaks
      // stay distinct in a triangle layout instead of merging into one
      // bulge. Amplitude nudges radius slightly for a "spread on hit"
      // feel, but never enough to overlap.
      float lowAmp  = uBands[0];
      float midAmp  = uBands[1];
      float highAmp = uBands[2];
      // Heights are capped so no peak ever reaches above the camera
      // line (camera is ~1.0 world unit above the plane). Going higher
      // than that makes the peak envelop the view.
      float z =
        peak(p, uOrigins[0], lowAmp,  2.2 + lowAmp  * 0.8) * 2.2 +
        peak(p, uOrigins[1], midAmp,  1.6 + midAmp  * 0.7) * 1.8 +
        peak(p, uOrigins[2], highAmp, 1.5 + highAmp * 0.6) * 1.6;

      pos.z = base + z;
      vEnergy = clamp(z + total * 0.15, 0.0, 2.0);

      // Edge fading so the plane melts into black at the horizon
      float edgeX    = 1.0 - smoothstep(14.0, 20.0, abs(position.x));
      float edgeNear = 1.0 - smoothstep(16.0, 20.0, -position.y);
      float edgeFar  = 1.0 - smoothstep(2.0,  18.0, position.y);
      vAlpha = edgeX * edgeNear * edgeFar;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    varying float vEnergy;
    varying float vAlpha;
    varying vec2  vUv;

    void main() {
      // Anti-aliased grid — thick lines at every 1/${GRID_DIVISIONS} UV step.
      vec2 grid = abs(fract(vUv * ${GRID_DIVISIONS}.0 - 0.5) - 0.5);
      vec2 dgrid = fwidth(vUv * ${GRID_DIVISIONS}.0);
      vec2 g = smoothstep(dgrid, vec2(0.0), grid);
      float line = max(g.x, g.y);
      if (line < 0.02) discard;

      // Monochrome: line brightness modulated by local peak energy
      float brightness = 0.25 + vEnergy * 0.55;
      gl_FragColor = vec4(vec3(brightness), vAlpha * line * (0.45 + vEnergy * 0.6));
    }
  `;

  return (
    <mesh
      geometry={geometry}
      rotation={[-Math.PI / 2 + 0.18, 0, 0]}
      position={[0, -0.9, -2]}
    >
      <shaderMaterial
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

export function Screen3D({ low, mid, high }: Screen3DProps) {
  const fov =
    typeof window !== 'undefined' && window.innerWidth < 768 ? 95 : 75;
  return (
    <div className="absolute inset-0">
      <Canvas
        // Pulled back from 2.5 → 4.0 and raised from 0.12 → 0.8 so the
        // bass peak (capped ~2.2 world units tall near the camera) sits
        // comfortably in frame instead of engulfing the view at peak
        // amplitude.
        camera={{ position: [0, 0.8, 4.0], fov, near: 0.1, far: 200 }}
        dpr={[1, 2]}
        gl={{ alpha: true, premultipliedAlpha: false }}
        style={{ background: 'transparent' }}
      >
        <PeakPlane low={low} mid={mid} high={high} />
      </Canvas>
    </div>
  );
}

export function resetScreen3D() {}
