# LightFlow v3 — AI Lighting Director

Real-time lighting show system for 8 Astera Titan Tubes (16 pixels each). Analyzes songs with Demucs stem separation, generates show plans via Claude, and executes them with a pygame preview and DMX output.

## Architecture

```
analyze.py    Audio → stem separation (Demucs) → BPM/sections/onsets/pans → AnalysisResult JSON
generate.py   AnalysisResult + style → Claude LLM → ShowPlan JSON
execute.py    ShowPlan + audio → real-time renderer → preview window + DMX
effects.py    31 composable visual effects with BPM-synced ADSR smoothing
schemas.py    Pydantic models (AnalysisResult, ShowPlan, EffectInstance, etc.)
preview.py    Pygame window rendering 8 light bars with rounded caps
dmx.py        sACN/E1.31 DMX output to physical Titan Tubes
main.py       CLI entry point (analyze, generate, run, full, demo)
```

## Usage

```bash
# Full pipeline: analyze → generate → run
python v3/main.py full ~/Desktop/song.mp3 --style energetic --no-dmx

# Step by step
python v3/main.py analyze ~/Desktop/song.mp3
python v3/main.py generate song_analysis.json --style dramatic
python v3/main.py run song_analysis.json song_show.json --audio ~/Desktop/song.mp3 --no-dmx

# Demo: cycle through all effects in white to evaluate visuals
python v3/main.py demo
python v3/main.py demo --effect breathe,meteor,abracadabra --loop
python v3/main.py demo --duration 10
```

## Effects Library (31 effects)

### Base / Ambient
| Effect | Description |
|--------|-------------|
| `solid` | Static color fill |
| `gradient` | Two-color gradient along a direction |
| `color_wash` | Slowly cycling color blend across tubes |
| `fade_in` | Fade from black to color |
| `fade_out` | Fade from color to black |
| `blackout` | Zeros out the region |

### Rhythmic / Reactive
| Effect | Description |
|--------|-------------|
| `bass_fill` | Bottom-up fill driven by bass energy |
| `kick_flash` | Full-region flash on kick hits (supports `onset_mode`) |
| `snare_accent` | Flash on snare hits (supports `onset_mode`) |
| `hat_sparkle` | Random sparkle pixels driven by hi-hat (supports `onset_mode`) |
| `energy_pulse` | Pulsing brightness synced to beat |
| `strobe` | On/off flash at BPM-synced rate |
| `strobe_chase` | Strobe advancing one tube per beat with subdivisions |
| `impact` | Onset-triggered flash → expanding ring decay (debounced) |
| `firecracker` | Radial sparkle burst expanding from center each beat |

### Motion / Spatial
| Effect | Description |
|--------|-------------|
| `chase` | Light chasing along tubes or pixels |
| `scan` | Scanner beam ping-ponging across tubes |
| `rain` | Falling pixel drops with tails |
| `meteor` | Bright head pixel falling down tubes with exponential decay trail |
| `ripple` | Radial wave from center outward |
| `buildup_rise` | Rising fill that builds intensity toward drops |
| `lighthouse` | Wide Gaussian beam ping-ponging across tubes (4-beat cycle) |
| `abracadabra` | Wandering focused spotlight with decay trail (wand-waving motion) |

### Ambient / Atmospheric
| Effect | Description |
|--------|-------------|
| `breathe` | Slow sine modulation across tubes (1 cycle / 2 bars) |
| `breathe_y` | Vertical breathing wave sweeping up/down tubes |
| `firefly` | 12 dots with independent asymmetric glow cycles |
| `candles` | Slow bottom-weighted flickering dots (candle flames) |
| `vocal_wave` | Flowing vertical wave driven by vocal energy |

### Spectral / Pan
| Effect | Description |
|--------|-------------|
| `pan_sweep` | Light column follows a stem's stereo pan across tubes |
| `spectral_color` | Color interpolates based on stem brightness/centroid |
| `flux_burst` | Expanding radial ring triggered by spectral flux |

## Key Features

### BPM-Relative Timing
Effects support `attack_beats` and `release_beats` fields that scale with tempo automatically. Overrides fixed `attack_ms`/`release_ms` when set.

```json
{"effect": "kick_flash", "release_beats": 0.5}
```
At 120 BPM → 250ms release. At 140 BPM → 214ms release.

### Glow Post-Processing
Subtle pixel bleed via `scipy.ndimage.uniform_filter` applied after compositing. Adds softness to the 16x8 grid.

### Live Controls (during show playback)
```
1-6 (hold): Boost stem  1=bass 2=kick 3=snare 4=hat 5=vocals 6=other
7   (tap):  White flash
8   (tap):  Strobe burst
9   (tap):  Color burst
0   (hold): Blackout
ESC:        Quit
```

### Show Generation
Claude acts as creative lighting director. Receives song analysis (sections, BPM, stem energies, onset density, stereo pans, spectral flux) and outputs a ShowPlan with layered effects per section. 20 design rules guide the LLM toward musical, dynamic shows.

## Dependencies

```
numpy, scipy, pydantic, anthropic, pygame, sounddevice, soundfile,
demucs, torch, torchaudio, librosa, python-dotenv
```

## Status

- [x] Audio analysis pipeline (Demucs stems, BPM, sections, onsets, pans, spectral flux)
- [x] 31-effect composable renderer with BPM-synced ADSR
- [x] LLM show generation with style presets
- [x] Real-time executor with audio sync
- [x] Pygame preview (light bar visualization with rounded caps)
- [x] Live keyboard controls (stem boost, flash, strobe, blackout)
- [x] DMX output (sACN/E1.31)
- [x] Effect demo mode (white-only, cycle through effects)
- [x] Glow post-processing
- [ ] Update LLM vocabulary for newest effects (breathe_y, candles, firecracker, abracadabra)
- [ ] Test with more songs and tune effect parameters
- [ ] Save/load presets for effect parameter tuning
