/**
 * Proposed scene, recorded from the September 24 design discussion.
 * This is a declarative specification, not a Three.js implementation.
 * It is not imported by the current renderer or a brightness model.
 */
type Vec3 = readonly [number, number, number];

type Fixture = {
  id: string;
  kind: 'moving-head' | 'led-panel';
  position: Vec3;
  target: Vec3;
  color: string;
  relativePower: number;
  beamAngleDegrees: number;
};

export const scene = {
  units: 'meters',
  viewport: {fullscreen: true, aspect: 'match-window'},
  camera: {
    position: [0, 3.4, 11.5], target: [0, 1.4, 0],
    fieldOfViewDegrees: 45, movement: 'fixed',
    exposure: 1, automaticExposure: false,
  },
  environment: {
    background: '#030405', ambientIntensity: 0.025,
    haze: {density: 0.025, color: '#101113', scattering: 'subtle'},
  },
  floor: {
    size: [40, 40], position: [0, 0, 0],
    material: {
      color: '#111214', roughness: 0.85, metalness: 0.05,
      surface: 'fine concrete grain',
    },
    receiveShadows: true,
    reflections: {strength: 0.12, blur: 0.8},
  },
  podium: {
    position: [0, 0, 0.6],
    body: {size: [1, 1.1, 0.55], centerHeight: 0.55},
    top: {size: [1.18, 0.07, 0.7], centerHeight: 1.135},
    material: {
      color: '#2b2119', roughness: 0.65, metalness: 0,
      surface: 'subtle wood grain',
    },
    castShadows: true, receiveShadows: true,
  },
  fixtureAppearance: {
    housing: {color: '#111216', roughness: 0.48, metalness: 0.65, castShadows: true},
    movingHead: {
      base: 'low rectangular enclosure', support: 'two-sided metal yoke',
      head: 'cylindrical pivoting housing', lens: 'recessed optical glass',
    },
    ledPanel: {
      support: 'slender black stand with stable feet',
      housing: 'shallow rectangular enclosure', face: 'diffused LED surface',
    },
  },
  lightRendering: {
    distanceFalloff: 'inverse-square', shadows: 'soft, including beam occlusion',
    beams: {
      technique: 'volumetric scattering', core: 'concentrated',
      edges: 'feathered', visibilityFollowsLightPower: true,
    },
    bloom: {threshold: 1.2, strength: 0.2, radius: 0.3},
    surfaceResponse: {
      floor: 'broad, subdued pools of light', wood: 'warm diffuse illumination',
      metal: 'small sharp highlights', glass: 'concentrated lens highlights',
    },
  },
} as const;

export const fixtures: readonly Fixture[] = [
  {
    id: 'spot-left', kind: 'moving-head', position: [-2.8, 1, 2.4],
    target: [-1.2, 5.5, -3], color: '#ffbf78', relativePower: 1, beamAngleDegrees: 12,
  },
  {
    id: 'spot-right', kind: 'moving-head', position: [2.8, 1, 2.4],
    target: [1.2, 5.5, -3], color: '#ffbf78', relativePower: 1, beamAngleDegrees: 12,
  },
  {
    id: 'panel-left', kind: 'led-panel', position: [-4.7, 1.2, 0.4],
    target: [0, 0.8, 0.6], color: '#ffbf78', relativePower: 0.65, beamAngleDegrees: 100,
  },
  {
    id: 'panel-right', kind: 'led-panel', position: [4.7, 1.2, 0.4],
    target: [0, 0.8, 0.6], color: '#ffbf78', relativePower: 0.65, beamAngleDegrees: 100,
  },
];

// One shared input. Timing and decay belong to the upstream brightness signal.
// Power values are relative; physical units require fixture calibration.
export function lightingFrame(brightness: number) {
  const level = Number.isFinite(brightness)
    ? Math.max(0, Math.min(1, brightness)) : 0;
  return fixtures.map(fixture => ({
    id: fixture.id, color: fixture.color, target: fixture.target,
    emittedPower: level * fixture.relativePower,
    luminousFaceIntensity: level * fixture.relativePower,
  }));
}
