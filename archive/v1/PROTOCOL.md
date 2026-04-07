# LightFlow Protocol

A declarative light show protocol that scales from 1 light to 100+.

## Core Concept

Instead of programming discrete light counts, define **abstract layers** that get **distributed** based on available lights at runtime.

```
LAYER DEFINITION (the "show")          RUNTIME ROUTER
┌────────────────────────────────┐     ┌─────────────────────────┐
│ Layer 1: Bass    │ p1 │ center │     │ 1 light  → Layer 1     │
│ Layer 2: Drums   │ p2 │ all    │ ──► │ 2 lights → L1 + L2     │
│ Layer 3: Vocals  │ p3 │ stereo │     │ 6 lights → Full spatial│
│ Layer 4: Ambient │ p4 │ edges  │     │ 100 → Smooth gradients │
└────────────────────────────────┘     └─────────────────────────┘
```

## Protocol Structure

```typescript
interface LightShowProtocol {
  layers: Layer[];
}

interface Layer {
  name: string;
  source: Source;           // What audio signal drives this layer
  priority: number;         // Lower = more important (gets lights first)
  spatial: SpatialHint;     // Where it prefers to live
  response: ResponseCurve;  // How it reacts to the source
  color?: ColorRule;        // Optional color behavior
}

type Source =
  | 'bass'       // Low frequency energy (kick, bass)
  | 'drums'      // Percussive energy
  | 'vocals'     // Mid-high melodic content
  | 'intensity'  // Overall loudness
  | 'section';   // Song structure (intro/drop/breakdown)

type SpatialHint =
  | 'center'     // Prefers middle lights
  | 'all'        // Wants to be everywhere
  | 'stereo'     // Left/right from audio channels
  | 'edges'      // Outer lights only
  | 'random';    // Any available

type ResponseCurve =
  | 'pulse'      // Size/brightness follows energy smoothly
  | 'flash'      // Binary on/off on transients
  | 'smooth'     // Heavily smoothed, ambient feel
  | 'inverse';   // Bright when source is quiet
```

## Router Logic

The router takes N available lights and distributes layers intelligently:

### Priority-based assignment
When lights are limited, higher priority layers get lights first.

```
1 light:  Bass only (priority 1)
2 lights: Bass + Drums
3 lights: Bass + Drums + Vocals
```

### Spatial distribution
When lights exceed layer count, spatial hints distribute layers across positions.

```
6 lights in a row: [L1] [L2] [L3] [L4] [L5] [L6]
                   left -------------- right

Bass (center):    dim  med  FULL FULL med  dim
Drums (all):      equal across all
Vocals (stereo):  LEFT ----  ---- ---- ---- RIGHT
```

### Blending
When a light receives multiple layers, they combine:
- **Add**: Sum values (clamped to 1.0)
- **Max**: Take highest value
- **Multiply**: Combine (creates contrast)

## Current Implementation

### V1: Single Light Router (MVP)

The simplest router - one output that follows the most prevalent stem:

```typescript
function routeToStem(stems, currentTime): { source, energy } {
  // Get energy for each stem at current time
  const bass = getValueAtTime(stems.bass, currentTime);
  const drums = getValueAtTime(stems.drums, currentTime);
  const vocals = getValueAtTime(stems.vocals, currentTime);

  // Return the dominant one
  return pickHighest([bass, drums, vocals]);
}
```

**Visual feedback:**
- Green = Bass driving
- Amber = Drums driving
- Blue = Vocals driving
- White = Fallback to intensity

### Output Targets

| Target | Status | Description |
|--------|--------|-------------|
| **Web** | Active | Browser-based preview (what we're building now) |
| DMX | Planned | DMX512/ArtNet for professional fixtures |
| Hue | Planned | Philips Hue smart bulbs |
| WLED | Planned | ESP32/LED strips |
| Vision Pro | Future | Spatial computing light simulation |

### Next Steps

1. **V2: Multi-light array** - Test with 3-6 virtual lights in web
2. **V3: Layer definitions** - Create reusable show presets
3. **V4: Spatial router** - Position-aware distribution
4. **V5: Hardware output** - DMX/ArtNet/WLED integration

## Example Shows

### "Bass Drop"
```yaml
layers:
  - name: bass_pulse
    source: bass
    priority: 1
    spatial: center
    response: pulse

  - name: drum_flash
    source: drums
    priority: 2
    spatial: all
    response: flash
```

### "Vocal Focus"
```yaml
layers:
  - name: vocal_flow
    source: vocals
    priority: 1
    spatial: stereo
    response: smooth

  - name: bass_ambient
    source: bass
    priority: 2
    spatial: edges
    response: smooth
```

### "Full Energy"
```yaml
layers:
  - name: intensity_all
    source: intensity
    priority: 1
    spatial: all
    response: pulse
```
