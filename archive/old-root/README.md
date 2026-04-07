# LightFlow

Audio-reactive lighting system for live events. Analyzes audio in real-time and drives DMX lighting fixtures.

## Project Structure

```
lightflow/
├── v1/              # Original prototype (archived)
│   ├── webapp/      # Next.js React Flow node editor
│   ├── backend/     # FastAPI server (Hue, demucs, analysis)
│   └── model/       # PyTorch audio→stem energy ML pipeline
│
└── v2/              # Active - Wedding DJ lighting system
    ├── td_network.py    # TouchDesigner setup script (3D spectral viz)
    ├── td_setup.py      # TouchDesigner setup script (basic spectrogram)
    ├── src/
    │   ├── audio.py     # Real-time mic capture + spectral features
    │   ├── dmx.py       # DMX output (ENTTEC USB adapters)
    │   ├── mapping.py   # Audio features → DMX channel values
    │   └── engine.py    # Main engine wiring audio→mapping→DMX
    ├── main.py          # CLI entry point
    └── *.toe            # TouchDesigner project files
```

## V2 Status

**Goal:** Live mic input → real-time audio visualization + DMX lighting for a wedding DJ setup.

### What works
- TouchDesigner project with mic input → FFT spectrum analysis
- Script CHOP extracting spectral features (centroid, spread, RMS, flatness)
- Trail CHOP accumulating feature history over time
- 3D instanced sphere visualization driven by spectral features
- Sphere position mapped: X=centroid, Y=spread, Z=flatness, size=RMS
- Per-instance color mapping (blue=low freq, red=mid, yellow=high)
- Connecting line geometry between consecutive trail points (Script SOP)
- Python fallback pipeline (sounddevice + librosa + PyDMXControl) in src/

### TODO
- Fix sphere geometry (renders as torus, needs Polygon type + small radius)
- Configure per-instance color on Geometry COMP Instance page
- Set up materials (Constant MAT) on sphere and line geometry
- Add DMX output from TouchDesigner (DMX Out CHOP → ENTTEC USB)
- Purchase ENTTEC Open DMX USB adapter (~$70)
- Test with actual DMX fixtures
- Add axis labels and UI overlay (like Arese's visualizations)
- Tune feature mapping sensitivity for DJ music (bass-heavy)

### Hardware Plan
```
MacBook Pro (USB-C)
  → USB-C to USB-A adapter
    → ENTTEC Open DMX USB
      → 5-pin XLR DMX cable
        → DMX fixtures (wash lights, string lights, uplights)
```

### TouchDesigner Quick Start
1. Install [TouchDesigner](https://derivative.ca/download) (free non-commercial)
2. Open `v2/lightflow_v2.toe` (or any .toe file)
3. Run setup script in Textport (`Dialogs > Textport and DATs`):
   ```
   exec(open('/Users/elijah/code/lightflow/v2/td_network.py').read())
   ```
4. Set mic device on the `mic` node
5. Configure instancing on the `spheres` geo node (see script output)
6. Right-click `out` → View

### Reference
- [Lucio Arese](https://www.lucioarese.net/) - 3D MFCC spectral visualization inspiration
- [td_mfcc](https://github.com/hrtlacek/td_mfcc) - MFCC implementation for TouchDesigner
- [DMX Out CHOP docs](https://docs.derivative.ca/DMX_Out_CHOP)
