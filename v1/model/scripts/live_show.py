"""Live audio → model → Hue lights.

Captures mic audio, runs the trained model, and sends stem energies
to Philips Hue lights via the LightFlow backend API.

Usage:
    python scripts/live_show.py --checkpoint checkpoints/best.pt
    python scripts/live_show.py --checkpoint checkpoints/best.pt --hue-bridge 192.168.1.100
    python scripts/live_show.py --checkpoint checkpoints/best.pt --backend http://localhost:8000

Light mapping (default — editable via --mapping):
    Light 1: kick_energy   (red)
    Light 2: snare_energy   (orange)
    Light 3: bass_energy    (purple)
    Light 4: hat_energy     (cyan)
    Light 5: vocals_energy  (blue)
    Light 6: other_energy   (green)
"""

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import requests
import torch

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.dataset import STEM_CHANNELS
from src.features import AudioFeatureExtractor
from src.model import build_model

# Default light mapping: light_id → (channel_name, hue_value)
# Hue values: 0=red, 8000=orange, 12000=yellow, 25000=green, 35000=cyan, 46000=blue, 56000=purple
DEFAULT_MAPPING = {
    1: ("kick_energy", 0),         # red
    2: ("snare_energy", 8000),     # orange
    3: ("bass_energy", 56000),     # purple
    4: ("hat_energy", 35000),      # cyan
    5: ("vocals_energy", 46000),   # blue
    6: ("other_energy", 25000),    # green
}

# Attack/release smoothing (higher = more responsive, lower = smoother)
ATTACK = 0.7    # How fast lights respond to increases
RELEASE = 0.3   # How fast lights fade


def load_model(checkpoint_path: str, device: torch.device):
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    config = checkpoint["config"]
    model = build_model(config).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()
    return model, config


def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def send_hue_command(backend_url: str, light_id: int, brightness: float, hue: int, transition: int = 1):
    """Send a light control command via the LightFlow backend."""
    try:
        requests.post(
            f"{backend_url}/hue/control",
            json={
                "light_id": light_id,
                "brightness": max(0.0, min(1.0, brightness)),
                "hue": hue,
                "saturation": 254,
                "on": brightness > 0.02,
                "transition": transition,
            },
            timeout=0.1,  # Non-blocking, fire-and-forget
        )
    except requests.exceptions.RequestException:
        pass  # Don't block on network errors


def main():
    parser = argparse.ArgumentParser(description="Live audio → model → Hue lights")
    parser.add_argument("--checkpoint", type=str, required=True)
    parser.add_argument("--backend", type=str, default="http://localhost:8000",
                        help="LightFlow backend URL")
    parser.add_argument("--mapping", type=str, default=None,
                        help="JSON file with custom light mapping")
    parser.add_argument("--transition", type=int, default=1,
                        help="Hue transition time in 100ms units (default: 1 = 100ms)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Print values without sending to Hue")
    args = parser.parse_args()

    try:
        import pyaudio
    except ImportError:
        print("pyaudio is required. Install with: pip install pyaudio")
        sys.exit(1)

    device = get_device()
    model, config = load_model(args.checkpoint, device)
    extractor = AudioFeatureExtractor(config)

    sr = config["audio"]["sample_rate"]
    window_samples = int(config["audio"]["window_seconds"] * sr)
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]

    # Load mapping
    mapping = DEFAULT_MAPPING
    if args.mapping:
        with open(args.mapping) as f:
            raw = json.load(f)
        mapping = {int(k): (v["channel"], v["hue"]) for k, v in raw.items()}

    # Verify backend connection
    if not args.dry_run:
        try:
            resp = requests.get(f"{args.backend}/hue/status", timeout=2)
            status = resp.json()
            print(f"Hue bridge: {status.get('bridge_name', 'unknown')} ({status.get('status', '?')})")
        except Exception as e:
            print(f"WARNING: Cannot reach backend at {args.backend}: {e}")
            print("Running in dry-run mode")
            args.dry_run = True

    # Audio capture
    pa = pyaudio.PyAudio()
    stream = pa.open(
        format=pyaudio.paFloat32,
        channels=1,
        rate=sr,
        input=True,
        frames_per_buffer=window_samples,
    )

    print(f"\nDevice: {device}")
    print(f"Mic: {window_samples} samples @ {sr}Hz ({config['audio']['window_seconds']}s window)")
    print(f"\nLight mapping:")
    for light_id, (channel, hue) in sorted(mapping.items()):
        print(f"  Light {light_id}: {channel} (hue={hue})")
    print(f"\nListening... (Ctrl+C to stop)\n")

    # Smoothed values for attack/release envelope
    smoothed = {ch: 0.0 for ch in channel_names}

    try:
        while True:
            t0 = time.time()

            data = stream.read(window_samples, exception_on_overflow=False)
            audio = np.frombuffer(data, dtype=np.float32)

            # Model prediction
            features = extractor.extract(audio)
            feature_array = extractor.concat_features(features)

            with torch.no_grad():
                tensor = torch.from_numpy(feature_array).float().unsqueeze(0).to(device)
                prediction = model(tensor).cpu().numpy()[0]

            raw_values = {ch: float(prediction[i]) for i, ch in enumerate(channel_names)}

            # Attack/release smoothing
            for ch in channel_names:
                raw = raw_values[ch]
                prev = smoothed[ch]
                if raw > prev:
                    smoothed[ch] = prev + ATTACK * (raw - prev)
                else:
                    smoothed[ch] = prev + RELEASE * (raw - prev)

            # Send to lights
            for light_id, (channel, hue) in mapping.items():
                if channel in smoothed:
                    brightness = smoothed[channel]
                    if not args.dry_run:
                        send_hue_command(args.backend, light_id, brightness, hue, args.transition)

            elapsed = time.time() - t0

            # Print status
            bars = []
            for ch in channel_names:
                v = smoothed[ch]
                short = ch.replace("_energy", "")
                bar = "█" * int(v * 15) + "░" * (15 - int(v * 15))
                bars.append(f"{short:>6}|{bar}|{v:.2f}")
            mode = "DRY" if args.dry_run else "HUE"
            print(f"\r[{mode} {elapsed*1000:4.0f}ms] " + "  ".join(bars), end="", flush=True)

    except KeyboardInterrupt:
        print("\n\nShutting down...")
        # Turn off all lights
        if not args.dry_run:
            for light_id in mapping:
                send_hue_command(args.backend, light_id, 0.0, 0, transition=5)
            print("Lights off.")
    finally:
        stream.stop_stream()
        stream.close()
        pa.terminate()


if __name__ == "__main__":
    main()
