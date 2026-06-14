'use client';

// Unified 3D playground — ALL five fixtures rendered as 3D objects (no 2D wash
// layer, so nothing drifts when the view changes). Two visual representations of
// the same rig, switchable via `mode`:
//   • abstract — glowing primitives + beams over a grid (stylised)
//   • literal  — a real-looking room: Amaran Halo on a tripod, the two Spot 160
//     moving heads, two Shocker panels on stands, and a table in the middle.
// Every fixture shows a "source" that resembles light (emissive), driven from
// the shared per-frame Visual map (frameRef) — same data the DMX gets.

import { RefObject, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Visual } from '@/lib/fixtures';

export type RigMode = 'abstract' | 'literal';
type FrameRef = RefObject<Record<string, Visual>>;

// 3D placement of each fixture (world units; floor = y0, camera looks down +Z).
const POS = {
  halo: new THREE.Vector3(0, 0, -0.7), // close behind the podium, keying it
  spotL: new THREE.Vector3(-2.8, 0, 2.4),
  spotR: new THREE.Vector3(2.8, 0, 2.4),
  shockerL: new THREE.Vector3(-4.7, 0, 0.4),
  shockerR: new THREE.Vector3(4.7, 0, 0.4),
};

const setCol = (rgb: [number, number, number], c: THREE.Color) =>
  c.setRGB((rgb[0] / 255) ** 2.2, (rgb[1] / 255) ** 2.2, (rgb[2] / 255) ** 2.2);

// ---------------------------------------------------------------------------
// Spot 160 moving head — base + (literal) yoke/head, a bright lens source, and
// an up-and-out beam steered by pan/tilt.
// ---------------------------------------------------------------------------
const YAW = 0.95;
const PITCH_MIN = 0.12;
const PITCH_MAX = 1.05;
const BEAM_LEN = 7;
const BEAM_SPREAD = 0.26;

function Mover({ id, mode, frameRef }: { id: 'spotL' | 'spotR'; mode: RigMode; frameRef: FrameRef }) {
  const origin = useMemo(() => POS[id].clone().setY(mode === 'literal' ? 1.0 : 0.3), [id, mode]);
  const head = useRef<THREE.Group>(null);
  const lens = useRef<THREE.MeshBasicMaterial>(null);
  const beam = useRef<THREE.Mesh>(null);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const col = useMemo(() => new THREE.Color(), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const xAxis = useMemo(() => new THREE.Vector3(1, 0, 0), []);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(() => {
    const v = frameRef.current?.[id];
    if (!v) return;
    const I = v.intensity;
    setCol(v.rgb, col);
    const pitch = PITCH_MIN + (((v.tilt ?? 0) + 1) / 2) * (PITCH_MAX - PITCH_MIN);
    const yaw = (v.pan ?? 0) * YAW;
    dir.set(0, 1, 0).applyAxisAngle(xAxis, -pitch).applyAxisAngle(yAxis, yaw);

    if (head.current) head.current.quaternion.setFromUnitVectors(up, dir);
    if (lens.current) {
      lens.current.color.copy(col);
      lens.current.opacity = Math.min(1, I * 1.6);
    }
    if (beam.current && beamMat.current) {
      beam.current.position.copy(origin).addScaledVector(dir, BEAM_LEN / 2);
      beam.current.quaternion.setFromUnitVectors(up, dir.clone().negate());
      beam.current.scale.set(1, BEAM_LEN, 1);
      beamMat.current.color.copy(col);
      beamMat.current.opacity = I <= 0.002 ? 0 : 0.16 + 0.5 * I;
    }
    if (spot.current) {
      spot.current.color.copy(col);
      spot.current.intensity = I * 12;
      spot.current.target.position.copy(origin).addScaledVector(dir, BEAM_LEN);
      spot.current.target.updateMatrixWorld();
    }
  });

  return (
    <group>
      {/* base on the floor */}
      <mesh position={[POS[id].x, 0.09, POS[id].z]}>
        <boxGeometry args={[0.34, 0.18, 0.34]} />
        <meshStandardMaterial color="#0b0b10" metalness={0.6} roughness={0.5} />
      </mesh>
      {mode === 'literal' && (
        <>
          {/* yoke posts */}
          <mesh position={[POS[id].x - 0.18, 0.55, POS[id].z]}>
            <boxGeometry args={[0.05, 0.7, 0.05]} />
            <meshStandardMaterial color="#15151c" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[POS[id].x + 0.18, 0.55, POS[id].z]}>
            <boxGeometry args={[0.05, 0.7, 0.05]} />
            <meshStandardMaterial color="#15151c" metalness={0.6} roughness={0.5} />
          </mesh>
        </>
      )}
      {/* head — pivots with pan/tilt */}
      <group position={origin.toArray()}>
        <group ref={head}>
          {mode === 'literal' && (
            <mesh position={[0, 0.12, 0]}>
              <cylinderGeometry args={[0.16, 0.16, 0.3, 20]} />
              <meshStandardMaterial color="#101016" metalness={0.7} roughness={0.4} />
            </mesh>
          )}
          {/* the lens / source — resembles light */}
          <mesh position={[0, mode === 'literal' ? 0.28 : 0, 0]}>
            <circleGeometry args={[0.13, 24]} />
            <meshBasicMaterial ref={lens} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      </group>
      {/* volumetric beam */}
      <mesh ref={beam}>
        <coneGeometry args={[BEAM_SPREAD, 1, 28, 1, true]} />
        <meshBasicMaterial ref={beamMat} transparent opacity={0.1} depthWrite={false} side={THREE.DoubleSide} fog={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {mode === 'literal' && (
        <spotLight ref={spot} position={origin.toArray()} angle={0.32} penumbra={0.6} distance={16} decay={1.2} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Amaran Halo — a round soft light. Literal: on a tripod, facing the stage.
// Abstract: a glowing disc floating centre-back. Casts a point light (literal).
// ---------------------------------------------------------------------------
function Halo({ mode, frameRef }: { mode: RigMode; frameRef: FrameRef }) {
  const y = mode === 'literal' ? 1.85 : 2.0;
  const face = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.PointLight>(null);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const v = frameRef.current?.halo;
    if (!v) return;
    setCol(v.rgb, col);
    if (face.current) {
      face.current.color.copy(col);
      face.current.opacity = Math.min(1, 0.3 + v.intensity * 1.3);
    }
    if (glow.current) {
      glow.current.color.copy(col);
      glow.current.intensity = v.intensity * 14;
    }
  });

  return (
    <group position={[POS.halo.x, 0, POS.halo.z]}>
      {mode === 'literal' && (
        <>
          {/* tripod: centre column + three splayed feet */}
          <mesh position={[0, y / 2, 0]}>
            <cylinderGeometry args={[0.03, 0.03, y, 10]} />
            <meshStandardMaterial color="#18181f" metalness={0.6} roughness={0.5} />
          </mesh>
          {[0, 2.1, 4.2].map((a, i) => (
            <mesh key={i} position={[Math.sin(a) * 0.3, 0.35, Math.cos(a) * 0.3]} rotation={[Math.cos(a) * 0.5, -a, Math.sin(a) * 0.5]}>
              <cylinderGeometry args={[0.02, 0.02, 0.8, 8]} />
              <meshStandardMaterial color="#18181f" metalness={0.6} roughness={0.5} />
            </mesh>
          ))}
        </>
      )}
      {/* the round soft-light source, facing the stage (+Z) */}
      <group position={[0, y, 0]} rotation={[Math.PI / 2 - 0.5, 0, 0]}>
        {mode === 'literal' && (
          <mesh>
            <cylinderGeometry args={[0.55, 0.55, 0.12, 32]} />
            <meshStandardMaterial color="#1c1c22" metalness={0.5} roughness={0.5} />
          </mesh>
        )}
        <mesh position={[0, 0.07, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[mode === 'literal' ? 0.54 : 0.6, 40]} />
          <meshBasicMaterial ref={face} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
      {mode === 'literal' && <pointLight ref={glow} position={[0, y, 0.5]} distance={26} decay={0.9} />}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Shocker panel — a flat LED panel on a stand at the hard side, facing inward.
// Abstract: just the glowing panel. Source = the emissive face.
// ---------------------------------------------------------------------------
function Shocker({ id, mode, frameRef }: { id: 'shockerL' | 'shockerR'; mode: RigMode; frameRef: FrameRef }) {
  const p = POS[id];
  const inward = p.x < 0 ? 1 : -1; // face toward centre
  const y = mode === 'literal' ? 1.2 : 1.4;
  const face = useRef<THREE.MeshBasicMaterial>(null);
  const glow = useRef<THREE.PointLight>(null);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const v = frameRef.current?.[id];
    if (!v) return;
    setCol(v.rgb, col);
    if (face.current) {
      face.current.color.copy(col);
      face.current.opacity = Math.min(1, 0.3 + v.intensity * 1.3);
    }
    if (glow.current) {
      glow.current.color.copy(col);
      glow.current.intensity = v.intensity * 8;
    }
  });

  // angle the upright panel toward the centre of the stage (yaw only — vertical)
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, inward * 0.7, 0]}>
      {mode === 'literal' && (
        <mesh position={[0, y / 2, 0]}>
          <cylinderGeometry args={[0.03, 0.04, y, 8]} />
          <meshStandardMaterial color="#18181f" metalness={0.6} roughness={0.5} />
        </mesh>
      )}
      <group position={[0, y, 0]}>
        {mode === 'literal' && (
          <mesh position={[0, 0, -0.06]}>
            <boxGeometry args={[0.7, 0.9, 0.08]} />
            <meshStandardMaterial color="#15151b" metalness={0.5} roughness={0.5} />
          </mesh>
        )}
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[0.62, 0.82]} />
          <meshBasicMaterial ref={face} transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} fog={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
      {mode === 'literal' && <pointLight ref={glow} position={[inward * 0.4, y, 0.3]} distance={10} decay={1.6} />}
    </group>
  );
}

// Rectangular desk / podium in the middle (literal only).
function Table() {
  return (
    <group position={[0, 0, 0.6]}>
      {/* podium body */}
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[1.0, 1.1, 0.55]} />
        <meshStandardMaterial color="#1d160f" metalness={0.2} roughness={0.6} />
      </mesh>
      {/* overhanging top surface */}
      <mesh position={[0, 1.13, 0]}>
        <boxGeometry args={[1.18, 0.07, 0.7]} />
        <meshStandardMaterial color="#241a11" metalness={0.25} roughness={0.55} />
      </mesh>
    </group>
  );
}

export function Rig3D({ frameRef, mode }: { frameRef: FrameRef; mode: RigMode }) {
  return (
    <Canvas camera={{ position: [0, 3.4, 11.5], fov: 45 }} gl={{ alpha: true, antialias: true }} style={{ background: 'transparent' }}>
      {/* atmospheric haze — distant rig/floor fades into the dark, and the
          additive beams read as volumetric light shafts cutting through it. */}
      <fogExp2 attach="fog" args={['#050509', mode === 'literal' ? 0.05 : 0.032]} />
      <ambientLight intensity={mode === 'literal' ? 0.2 : 0.3} />
      {/* floor: solid plane (literal, so light lands on it) + reference grid */}
      {mode === 'literal' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#0a0a0d" metalness={0.2} roughness={0.85} />
        </mesh>
      )}
      <gridHelper args={[28, 28, '#1a1a26', mode === 'literal' ? '#0c0c12' : '#101018']} position={[0, 0.001, 0]} />

      <Halo mode={mode} frameRef={frameRef} />
      <Mover id="spotL" mode={mode} frameRef={frameRef} />
      <Mover id="spotR" mode={mode} frameRef={frameRef} />
      <Shocker id="shockerL" mode={mode} frameRef={frameRef} />
      <Shocker id="shockerR" mode={mode} frameRef={frameRef} />
      {mode === 'literal' && <Table />}

      {/* camera locked — fixed preview, no layer drift */}
      <OrbitControls enableZoom={false} enableRotate={false} enablePan={false} target={[0, 1.4, 0]} />
    </Canvas>
  );
}
