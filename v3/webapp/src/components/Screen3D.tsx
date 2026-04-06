'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Screen3DProps {
  signal: number;
  accent: number;
  accentStem: string;
  time: number;
  scene: string;
  stemSignals: Record<string, number>;
  stemPans: Record<string, number>;
}

const STEM_COLORS: Record<string, THREE.Color> = {
  kick:  new THREE.Color('#ff6b35'),
  snare: new THREE.Color('#3a86ff'),
  hat:   new THREE.Color('#c77dff'),
  bass:  new THREE.Color('#ffbe0b'),
  other: new THREE.Color('#06ffa5'),
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
  renderMode,
}: {
  stemSignals: Record<string, number>;
  stemPans: Record<string, number>;
  renderMode: 'lines' | 'points';
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const STEM_LIST = ['kick', 'bass', 'snare', 'other', 'hat'] as const;

  const geometry = useMemo(() => {
    const SIZE = 60;
    const DIVISIONS = renderMode === 'points' ? 140 : 220;
    const step = SIZE / DIVISIONS;
    const half = SIZE / 2;
    const positions: number[] = [];

    if (renderMode === 'points') {
      for (let i = 0; i <= DIVISIONS; i++) {
        for (let j = 0; j <= DIVISIONS; j++) {
          positions.push(-half + j * step, -half + i * step, 0);
        }
      }
    } else {
      // Horizontal lines
      for (let i = 0; i <= DIVISIONS; i++) {
        const y = -half + i * step;
        for (let j = 0; j < DIVISIONS; j++) {
          positions.push(-half + j * step, y, 0);
          positions.push(-half + (j + 1) * step, y, 0);
        }
      }
      // Vertical lines
      for (let j = 0; j <= DIVISIONS; j++) {
        const x = -half + j * step;
        for (let i = 0; i < DIVISIONS; i++) {
          positions.push(x, -half + i * step, 0);
          positions.push(x, -half + (i + 1) * step, 0);
        }
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    return geom;
  }, [renderMode]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uStems: { value: new Float32Array(5) },
      uPans: { value: new Float32Array(5) },
      uColors: {
        value: STEM_LIST.map((s) => {
          const c = STEM_COLORS[s];
          return new THREE.Vector3(c.r, c.g, c.b);
        }),
      },
    }),
    []
  );

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
    const sigs = uniforms.uStems.value;
    const pans = uniforms.uPans.value;
    for (let i = 0; i < STEM_LIST.length; i++) {
      const stem = STEM_LIST[i];
      sigs[i] += ((stemSignals[stem] ?? 0) - sigs[i]) * 0.25;
      pans[i] += ((stemPans[stem] ?? 0) - pans[i]) * 0.15;
    }
  });

  const vertexShader = `
    uniform float uTime;
    uniform float uStems[5];
    uniform float uPans[5];
    varying float vBandPos;
    varying float vSignal;
    varying float vAlpha;

    void main() {
      ${renderMode === 'points' ? 'gl_PointSize = 2.0;' : ''}
      vec3 pos = position;
      float yNorm = clamp((pos.y + 30.0) / 60.0, 0.0, 1.0);
      float bandPos = yNorm * 4.0;
      vBandPos = bandPos;

      int lo = int(floor(bandPos));
      int hi = int(min(floor(bandPos) + 1.0, 4.0));
      float f = fract(bandPos);
      float sLo =
        lo == 0 ? uStems[0] :
        lo == 1 ? uStems[1] :
        lo == 2 ? uStems[2] :
        lo == 3 ? uStems[3] : uStems[4];
      float sHi =
        hi == 0 ? uStems[0] :
        hi == 1 ? uStems[1] :
        hi == 2 ? uStems[2] :
        hi == 3 ? uStems[3] : uStems[4];
      float sig = mix(sLo, sHi, smoothstep(0.0, 1.0, f));

      float pLo =
        lo == 0 ? uPans[0] :
        lo == 1 ? uPans[1] :
        lo == 2 ? uPans[2] :
        lo == 3 ? uPans[3] : uPans[4];
      float pHi =
        hi == 0 ? uPans[0] :
        hi == 1 ? uPans[1] :
        hi == 2 ? uPans[2] :
        hi == 3 ? uPans[3] : uPans[4];
      float pan = mix(pLo, pHi, smoothstep(0.0, 1.0, f));

      // x range [-30, 30] → normalized [-1, 1]
      float xNorm = pos.x / 30.0;
      // pan bias: 1.7 on the side pan points to, 0.3 on the opposite
      float panWeight = max(0.3, 1.0 + pan * xNorm * 0.7);

      vSignal = sig * panWeight;

      float t = uTime * 0.6;
      float wave =
        sin(pos.x * 0.5 + t) * 0.3 +
        cos(pos.y * 0.4 + t * 0.8) * 0.2;
      pos.z = wave * (0.3 + sig * panWeight * 2.0);

      float dist = length(position.xy);
      vAlpha = 1.0 - smoothstep(15.0, 28.0, dist);

      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const fragmentShader = `
    uniform vec3 uColors[5];
    varying float vBandPos;
    varying float vSignal;
    varying float vAlpha;

    void main() {
      int lo = int(floor(vBandPos));
      int hi = int(min(floor(vBandPos) + 1.0, 4.0));
      float f = fract(vBandPos);
      vec3 cLo =
        lo == 0 ? uColors[0] :
        lo == 1 ? uColors[1] :
        lo == 2 ? uColors[2] :
        lo == 3 ? uColors[3] : uColors[4];
      vec3 cHi =
        hi == 0 ? uColors[0] :
        hi == 1 ? uColors[1] :
        hi == 2 ? uColors[2] :
        hi == 3 ? uColors[3] : uColors[4];
      vec3 color = mix(cLo, cHi, smoothstep(0.0, 1.0, f));
      color += vSignal * 0.3;
      gl_FragColor = vec4(color, vAlpha * (0.5 + vSignal * 0.5));
    }
  `;

  if (renderMode === 'points') {
    return (
      <points
        geometry={geometry}
        rotation={[-Math.PI / 2 + 0.5, 0, 0]}
        position={[0, -0.8, 0]}
      >
        <shaderMaterial
          ref={matRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
        />
      </points>
    );
  }

  return (
    <lineSegments
      geometry={geometry}
      rotation={[-Math.PI / 2 + 0.5, 0, 0]}
      position={[0, -0.8, 0]}
    >
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
      />
    </lineSegments>
  );
}

// =============================================================================
// Scene picker
// =============================================================================
export const SCENES_3D: { key: string; label: string }[] = [
  { key: 'plane',     label: 'Plane' },
  { key: 'particles', label: 'Particles' },
];

export function Screen3D({ signal, accent, accentStem, scene, stemSignals, stemPans }: Screen3DProps) {
  return (
    <div className="absolute inset-0">
      <Canvas
        key={scene}
        camera={{ position: [0, 0.3, 2.5], fov: 75 }}
        dpr={[1, 2]}
        gl={{ alpha: true, premultipliedAlpha: false }}
        style={{ background: 'transparent' }}
      >
        {scene === 'plane' && (
          <SpectrographScene
            stemSignals={stemSignals}
            stemPans={stemPans}
            renderMode="lines"
          />
        )}
        {scene === 'particles' && (
          <SpectrographScene
            stemSignals={stemSignals}
            stemPans={stemPans}
            renderMode="points"
          />
        )}
      </Canvas>
    </div>
  );
}

export function resetScreen3D() {}
