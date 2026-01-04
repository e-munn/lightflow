'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { FrequencyData, BeatInfo } from '@/types/audio';

interface StageSceneProps {
  frequencyData: FrequencyData | null;
  beatInfo: BeatInfo;
}

// Individual spotlight fixture
function SpotlightFixture({
  position,
  targetPosition,
  color,
  intensity,
}: {
  position: [number, number, number];
  targetPosition: [number, number, number];
  color: string;
  intensity: number;
}) {
  const lightRef = useRef<THREE.SpotLight>(null);
  const coneRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (lightRef.current) {
      lightRef.current.intensity = intensity * 50;
    }
    if (coneRef.current) {
      const material = coneRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = intensity * 0.3;
    }
  });

  return (
    <group position={position}>
      {/* Light housing */}
      <mesh>
        <cylinderGeometry args={[0.15, 0.2, 0.3, 16]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Light lens */}
      <mesh position={[0, -0.2, 0]}>
        <cylinderGeometry args={[0.12, 0.12, 0.05, 16]} />
        <meshBasicMaterial color={color} transparent opacity={Math.min(1, intensity + 0.2)} />
      </mesh>

      {/* Spotlight */}
      <spotLight
        ref={lightRef}
        position={[0, -0.2, 0]}
        target-position={targetPosition}
        color={color}
        intensity={intensity * 50}
        angle={0.4}
        penumbra={0.5}
        distance={15}
        castShadow
      />

      {/* Visible light cone */}
      <mesh
        ref={coneRef}
        position={[0, -3, 0]}
        rotation={[0, 0, 0]}
      >
        <coneGeometry args={[1.5, 6, 16, 1, true]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={intensity * 0.15}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// Moving head fixture
function MovingHead({
  position,
  color,
  intensity,
  pan,
  tilt,
}: {
  position: [number, number, number];
  color: string;
  intensity: number;
  pan: number;
  tilt: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.SpotLight>(null);

  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.rotation.y = THREE.MathUtils.lerp(
        groupRef.current.rotation.y,
        pan,
        0.1
      );
    }
    if (headRef.current) {
      headRef.current.rotation.x = THREE.MathUtils.lerp(
        headRef.current.rotation.x,
        tilt,
        0.1
      );
    }
    if (lightRef.current) {
      lightRef.current.intensity = intensity * 80;
    }
  });

  return (
    <group position={position}>
      {/* Base */}
      <mesh>
        <boxGeometry args={[0.3, 0.15, 0.3]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Yoke */}
      <group ref={groupRef}>
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[0.05, 0.25, 0.25]} />
          <meshStandardMaterial color="#2a2a2a" metalness={0.7} roughness={0.3} />
        </mesh>

        {/* Head */}
        <group ref={headRef} position={[0, 0.2, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.15, 0.25, 16]} />
            <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.2} />
          </mesh>

          {/* Lens */}
          <mesh position={[0, 0, 0.15]}>
            <circleGeometry args={[0.1, 16]} />
            <meshBasicMaterial color={color} transparent opacity={Math.min(1, intensity + 0.3)} />
          </mesh>

          {/* Spotlight */}
          <spotLight
            ref={lightRef}
            position={[0, 0, 0.2]}
            color={color}
            intensity={intensity * 80}
            angle={0.3}
            penumbra={0.3}
            distance={20}
            castShadow
          />
        </group>
      </group>
    </group>
  );
}

// Stage floor
function Stage() {
  return (
    <group>
      {/* Main stage floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 8]} />
        <meshStandardMaterial color="#0a0a0a" metalness={0.3} roughness={0.8} />
      </mesh>

      {/* Stage edge */}
      <mesh position={[0, -0.1, 4]}>
        <boxGeometry args={[12, 0.2, 0.2]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>

      {/* Truss structure */}
      {[-5, 0, 5].map((x) => (
        <mesh key={x} position={[x, 4, -2]}>
          <boxGeometry args={[0.1, 0.1, 8]} />
          <meshStandardMaterial color="#333" metalness={0.9} roughness={0.1} />
        </mesh>
      ))}

      {/* Cross truss */}
      <mesh position={[0, 4, -2]}>
        <boxGeometry args={[10, 0.1, 0.1]} />
        <meshStandardMaterial color="#333" metalness={0.9} roughness={0.1} />
      </mesh>
    </group>
  );
}

// Scene content with lights
function SceneContent({ frequencyData, beatInfo }: StageSceneProps) {
  const lightStates = useMemo(() => {
    if (!frequencyData) {
      return {
        spots: Array(6).fill({ color: '#333', intensity: 0.1 }),
        movers: Array(4).fill({ color: '#333', intensity: 0.1, pan: 0, tilt: -0.5 }),
      };
    }

    const { bands } = frequencyData;
    const beatPulse = beatInfo.isBeat ? 1 : Math.max(0, 1 - beatInfo.timeSinceLastBeat / 200);

    // Spots - react to different frequency bands
    const spots = [
      { color: '#ff3030', intensity: bands.subBass + bands.bass * 0.5 + beatPulse * 0.3 },
      { color: '#ff6600', intensity: bands.bass * 0.8 + beatPulse * 0.2 },
      { color: '#ffaa00', intensity: bands.lowMid * 0.7 },
      { color: '#00ff88', intensity: bands.mid * 0.8 },
      { color: '#00aaff', intensity: bands.highMid * 0.7 },
      { color: '#aa00ff', intensity: bands.high * 0.6 + beatPulse * 0.2 },
    ];

    // Moving heads - more dynamic
    const time = Date.now() / 1000;
    const movers = [
      {
        color: '#ff0066',
        intensity: bands.bass * 0.9 + beatPulse * 0.4,
        pan: Math.sin(time * 0.5) * 0.5 + bands.mid * 0.3,
        tilt: -0.3 - bands.bass * 0.3,
      },
      {
        color: '#00ffaa',
        intensity: bands.mid * 0.8 + beatPulse * 0.3,
        pan: Math.cos(time * 0.4) * 0.5 - bands.high * 0.2,
        tilt: -0.4 - bands.mid * 0.2,
      },
      {
        color: '#6600ff',
        intensity: bands.highMid * 0.8 + beatPulse * 0.3,
        pan: Math.sin(time * 0.6 + 1) * 0.4,
        tilt: -0.3 - bands.high * 0.3,
      },
      {
        color: '#ff6600',
        intensity: bands.lowMid * 0.7 + beatPulse * 0.2,
        pan: Math.cos(time * 0.5 + 2) * 0.5,
        tilt: -0.5 - bands.bass * 0.2,
      },
    ];

    return { spots, movers };
  }, [frequencyData, beatInfo]);

  return (
    <>
      {/* Static ambient light - always on */}
      <ambientLight intensity={0.3} />

      {/* Static directional light - always on, provides base illumination */}
      <directionalLight
        position={[5, 10, 5]}
        intensity={0.5}
        color="#ffffff"
      />
      <directionalLight
        position={[-5, 8, -5]}
        intensity={0.3}
        color="#8888ff"
      />

      {/* Stage */}
      <Stage />

      {/* Front spots on truss */}
      {lightStates.spots.map((spot, i) => (
        <SpotlightFixture
          key={`spot-${i}`}
          position={[-4 + i * 1.6, 4, 2]}
          targetPosition={[-2 + i * 0.8, 0, 0]}
          color={spot.color}
          intensity={spot.intensity}
        />
      ))}

      {/* Moving heads on back truss */}
      {lightStates.movers.map((mover, i) => (
        <MovingHead
          key={`mover-${i}`}
          position={[-3 + i * 2, 4, -3]}
          color={mover.color}
          intensity={mover.intensity}
          pan={mover.pan}
          tilt={mover.tilt}
        />
      ))}

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        minDistance={5}
        maxDistance={15}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.2}
        target={[0, 1, 0]}
      />
    </>
  );
}

export function StageScene({ frequencyData, beatInfo }: StageSceneProps) {
  return (
    <div className="w-full h-full bg-black rounded-lg overflow-hidden">
      <Canvas
        shadows
        camera={{ position: [0, 3, 8], fov: 50 }}
        gl={{ antialias: true }}
      >
        <SceneContent frequencyData={frequencyData} beatInfo={beatInfo} />
        <Environment preset="night" />
      </Canvas>
    </div>
  );
}
