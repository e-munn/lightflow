# LightFlow Model

PyTorch model that learns to map audio features to lighting states for DMX control.

## Architecture

**Input**: Audio feature windows (mel spectrogram + onset strength + chroma + energy)
**Output**: LightFlow protocol vectors (per-layer activation, color, spatial hints)
**Backbone**: Temporal CNN (default) or Bidirectional LSTM

```
Audio Window (0.5s)
    │
    ▼
┌──────────────────────┐
│  Feature Extraction  │  Mel spectrogram, onset, chroma, RMS, centroid
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│   Temporal CNN/LSTM  │  4 layers, 256 hidden dim
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│    Protocol Output   │  Per-layer: activation, hue, saturation, spatial
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│     DMX Mapping      │  Protocol → physical DMX channels
└──────────────────────┘
```

## Training Data

Place labeled songs in `data/`:

```
data/
  song_001/
    audio.wav          # Source audio
    labels.json        # Timestamped lighting states
  song_002/
    ...
```

`labels.json` format:
```json
{
  "fps": 20,
  "states": [
    {
      "time": 0.0,
      "layers": [
        {"activation": 0.8, "hue": 0.0, "saturation": 1.0, "spatial": 0.5}
      ]
    }
  ]
}
```

## Usage

```bash
# Install dependencies
pip install -r requirements.txt

# Train
python train.py --config config/default.yaml --data-dir data/

# Inference on file
python inference.py --checkpoint checkpoints/best.pt --audio song.wav

# Real-time from microphone
python inference.py --checkpoint checkpoints/best.pt
```

## Configuration

See `config/default.yaml` for all hyperparameters and settings.
