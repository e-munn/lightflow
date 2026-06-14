'use client';

// 3D layer: the two Intimidator Spot 160 movers as FLOOR-STANDING fixtures
// throwing an up-and-out beam. Pan yaws the beam left/right; tilt pitches it
// from near-vertical toward the stage. The beam is a cone with its apex (narrow
// end) at the fixture, widening with distance — no floor disc, so nothing to
// mis-align. Driven each frame from the shared Visual map (frameRef).

import { RefObject, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { RIG, Visual } from '@/lib/fixtures';

const HEAD_Y = 0.22; // fixture sits just above the floor
const HEAD_Z = 2.6; // toward the front; beams shoot up and back over the stage
const BEAM_LEN = 7;
// Beam spread = base radius of the cone at BEAM_LEN. The real Spot 160 beam
// angle is FIXED (no zoom channel), so this is a one-time match to the fixture's
// optics, not a live control. ~0.6 over len 7 ≈ a ~10° spot. Tune at the bench.
const BEAM_SPREAD = 0.6;
const YAW_RANGE = 0.95; // rad, pan -1..1 -> +/- ~54°
const PITCH_MIN = 0.12; // near-vertical
const PITCH_MAX = 1.05; // lean toward the stage

type FrameRef = RefObject<Record<string, Visual>>;

function MovingHead({ id, hx, frameRef }: { id: string; hx: number; frameRef: FrameRef }) {
  const body = useRef<THREE.MeshStandardMaterial>(null);
  const source = useRef<THREE.MeshBasicMaterial>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const col = useMemo(() => new THREE.Color(), []);
  const origin = useMemo(() => new THREE.Vector3(hx, HEAD_Y, HEAD_Z), [hx]);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const xAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const v = frameRef.current?.[id];
    if (!v) return;
    const I = v.intensity;
    col.setRGB((v.rgb[0] / 255) ** 2.2, (v.rgb[1] / 255) ** 2.2, (v.rgb[2] / 255) ** 2.2);

    const pitch = PITCH_MIN + ((v.tilt ?? 0) + 1) / 2 * (PITCH_MAX - PITCH_MIN);
    const yaw = (v.pan ?? 0) * YAW_RANGE;
    // start pointing up, pitch toward -Z (into the stage), then yaw around Y
    dir.set(0, 1, 0).applyAxisAngle(xAxis, -pitch).applyAxisAngle(yAxis, yaw);

    if (body.current) {
      body.current.emissive.copy(col);
      // near-black when the fixture is off, so a dimmed-to-0 spot disappears
      // (only a faint physical body remains) — e.g. scene 1 = Halo only.
      body.current.emissiveIntensity = 0.04 + I * 1.4;
    }
    if (source.current) {
      source.current.color.copy(col);
      source.current.opacity = Math.min(1, I * 1.2); // lens glows only when lit
    }
    if (beam.current && beamMat.current) {
      // cone apex (+Y) at the fixture; base out along dir. Align +Y to -dir.
      beam.current.position.copy(origin).addScaledVector(dir, BEAM_LEN / 2);
      beam.current.quaternion.setFromUnitVectors(up, dir.clone().negate());
      beam.current.scale.set(1, BEAM_LEN, 1);
      beamMat.current.color.copy(col);
      // Stronger, since there will be fog/haze making the beam shaft visible.
      // (Lower the 0.4 toward 0.15 to preview a clearer, less-hazy room.)
      beamMat.current.opacity = I <= 0.002 ? 0 : 0.12 + 0.4 * I;
    }
  });

  return (
    <group>
      {/* small fixture body on the floor */}
      <mesh position={[hx, HEAD_Y, HEAD_Z]}>
        <boxGeometry args={[0.2, 0.18, 0.2]} />
        <meshStandardMaterial ref={body} color="#101015" emissive="#ffffff" emissiveIntensity={0.2} />
      </mesh>
      {/* bright source point at the lens */}
      <mesh position={[hx, HEAD_Y + 0.05, HEAD_Z]}>
        <sphereGeometry args={[0.08, 16, 16]} />
        <meshBasicMaterial ref={source} transparent opacity={0.8} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* up-and-out beam, narrow at the fixture, widening with distance */}
      <mesh ref={beam}>
        <coneGeometry args={[BEAM_SPREAD, 1, 28, 1, true]} />
        <meshBasicMaterial
          ref={beamMat}
          transparent
          opacity={0.1}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

export function Spots3D({ frameRef }: { frameRef: FrameRef }) {
  const spots = RIG.filter((f) => f.kind === 'spot160');
  return (
    <Canvas camera={{ position: [0, 3, 9.5], fov: 45 }} gl={{ alpha: true, antialias: true }} style={{ background: 'transparent' }}>
      <ambientLight intensity={0.25} />
      <gridHelper args={[24, 24, '#1a1a26', '#101018']} position={[0, 0, 0]} />
      {spots.map((f) => (
        <MovingHead key={f.id} id={f.id} hx={(f.pos.x - 0.5) * 9} frameRef={frameRef} />
      ))}
      {/* Camera LOCKED: the wash glow is a screen-space 2D layer behind this
          canvas and can't follow camera moves, so zoom/orbit would drift the
          two out of register. Fixed view keeps the preview consistent. */}
      <OrbitControls enableZoom={false} enableRotate={false} enablePan={false} target={[0, 1.8, 0]} />
    </Canvas>
  );
}
