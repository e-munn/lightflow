"""LightFlow v4 — Real-Time ML Lighting System.

CLI entry point with subcommands:
    generate-data   Generate training data from audio files
    train           Train the ML model
    run             Run real-time inference
    demo            Demo mode with synthetic audio

Usage:
    python main.py generate-data --audio-dir ~/music --output-dir data/training
    python main.py train --data-dir data/training
    python main.py run --checkpoint checkpoints/best.pt
    python main.py demo --checkpoint checkpoints/best.pt
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml


def cmd_generate_data(args):
    """Generate training data by running v3 pipeline on audio files."""
    from data.batch_generate import batch_generate

    batch_generate(
        audio_dir=Path(args.audio_dir),
        output_dir=Path(args.output_dir),
        cache_dir=Path(args.cache_dir) if args.cache_dir else None,
        styles=args.styles,
        model=args.model,
        max_songs=args.max_songs,
    )


def cmd_train(args):
    """Train the LightFlow v4 model."""
    from model.train import train

    config_path = Path(args.config)
    with open(config_path) as f:
        config = yaml.safe_load(f)

    # Apply CLI overrides
    if args.epochs is not None:
        config["training"]["epochs"] = args.epochs
    if args.batch_size is not None:
        config["training"]["batch_size"] = args.batch_size
    if args.lr is not None:
        config["training"]["learning_rate"] = args.lr

    train(
        config=config,
        data_dir=args.data_dir,
        checkpoint_dir=args.checkpoint_dir,
    )


def cmd_run(args):
    """Run real-time inference."""
    from runtime.inference import InferenceEngine

    engine = InferenceEngine(
        checkpoint_path=args.checkpoint,
        dmx_method=args.dmx,
        sacn_ip=args.sacn_ip,
        usb_port=args.usb_port,
        audio_device=args.audio_device,
        no_preview=args.no_preview,
        fps=args.fps,
    )
    engine.run()


def cmd_demo(args):
    """Demo mode: runs inference with a pre-recorded audio file."""
    import time

    import numpy as np
    import librosa
    import torch
    import yaml as yaml_mod

    from model.model import build_model
    from model.protocol import Slice, SECTION_LABELS, bpm_to_normalized, normalized_to_bpm, PROTOCOL_DIM
    from router.titan_tubes import TitanTubeRouter
    from runtime.preview import PreviewWindow

    # Add v1 to path for feature extraction
    v1_dir = Path(__file__).resolve().parent.parent / "v1" / "model"
    if str(v1_dir) not in sys.path:
        sys.path.insert(0, str(v1_dir))
    from src.features import AudioFeatureExtractor

    # Load model
    if args.checkpoint:
        ckpt = torch.load(args.checkpoint, map_location="cpu", weights_only=False)
        config = ckpt["config"]

        device = torch.device(
            "mps" if torch.backends.mps.is_available()
            else "cpu"
        )
        model = build_model(config).to(device)
        model.load_state_dict(ckpt["model_state_dict"])
        model.eval()
        print(f"Model loaded from {args.checkpoint}")
        use_model = True
    else:
        # Demo without model — generate synthetic protocol vectors
        config_path = Path(__file__).parent / "model" / "config" / "v4.yaml"
        with open(config_path) as f:
            config = yaml_mod.safe_load(f)
        device = torch.device("cpu")
        use_model = False
        print("Demo mode: no checkpoint, using synthetic protocol vectors")

    audio_cfg = config["audio"]
    sr = audio_cfg["sample_rate"]
    window_samples = int(audio_cfg["window_seconds"] * sr)

    # Load audio file
    if args.audio:
        print(f"Loading audio: {args.audio}")
        y, _ = librosa.load(args.audio, sr=sr, mono=True)
        duration = len(y) / sr
        print(f"Duration: {duration:.1f}s")
    else:
        # Generate synthetic audio (sine sweep)
        duration = 60.0
        t = np.linspace(0, duration, int(duration * sr))
        y = np.sin(2 * np.pi * (100 + t * 5) * t) * 0.3
        y += np.random.randn(len(y)) * 0.01
        y = y.astype(np.float32)
        print(f"Synthetic audio: {duration:.0f}s")

    # Play audio if requested
    if args.play_audio and args.audio:
        import sounddevice as sd
        import soundfile as sf
        audio_data, audio_sr = sf.read(args.audio, dtype="float32")
        sd.play(audio_data, audio_sr)

    extractor = AudioFeatureExtractor(config)
    router = TitanTubeRouter()
    preview = PreviewWindow(title="LightFlow v4 Demo")
    preview.open()

    fps = args.fps
    frame_interval = 1.0 / fps
    section_feedback = np.zeros(6, dtype=np.float32)

    print(f"\nRunning demo at {fps}fps — press ESC to quit\n")

    frame = 0
    start_time = time.time()

    try:
        while True:
            t0 = time.time()
            elapsed = t0 - start_time

            if elapsed >= duration:
                break

            # Get audio window
            sample_pos = int(elapsed * sr)
            end_pos = min(sample_pos + window_samples, len(y))
            window = y[sample_pos:end_pos]
            if len(window) < window_samples:
                window = np.pad(window, (0, window_samples - len(window)))

            # Extract features
            features = extractor.extract_fast(window)
            feature_vec = extractor.concat_features(features).mean(axis=0)

            if use_model:
                # Build input
                input_vec = np.zeros(config["model"]["input_channels"], dtype=np.float32)
                input_vec[:143] = feature_vec
                input_vec[143] = bpm_to_normalized(128.0)
                input_vec[144] = (elapsed * 128.0 / 60.0) % 1.0
                input_vec[145:151] = section_feedback

                with torch.no_grad():
                    x = torch.from_numpy(input_vec).float().to(device)
                    x = x.unsqueeze(0).unsqueeze(0)
                    outputs = model.predict_step(x, device)

                protocol = model.assemble_protocol_vector(outputs).cpu().numpy()
                section_probs = outputs["section_probs"].cpu().numpy()
                section_feedback = section_probs
                gate = float(outputs["gate"].cpu())
            else:
                # Synthetic protocol vector from features
                protocol = np.zeros(PROTOCOL_DIM, dtype=np.float32)
                rms = float(feature_vec[141])  # RMS energy
                protocol[Slice.STEM_ENERGY] = rms
                protocol[Slice.STEM_ENERGY + 1] = rms * 0.8
                protocol[Slice.TEXTURE + 5] = 0.3  # glow
                protocol[Slice.TEXTURE + 4] = rms * 0.5  # flash
                protocol[Slice.DYNAMICS + 2] = rms  # master intensity
                protocol[Slice.DYNAMICS + 3] = 1.0  # gate
                protocol[Slice.BPM + 2] = bpm_to_normalized(128.0)
                protocol[Slice.SPATIAL:Slice.SPATIAL + 8] = 0.5
                section_probs = np.array([0, 1, 0, 0, 0, 0], dtype=np.float32)
                gate = 1.0

            # Route to grid
            grid = router.route(protocol, elapsed, frame_interval)

            section_idx = int(np.argmax(section_probs))
            latency_ms = (time.time() - t0) * 1000

            if not preview.update(
                grid,
                section=SECTION_LABELS[section_idx],
                bpm=normalized_to_bpm(float(protocol[Slice.BPM + 2])),
                latency_ms=latency_ms,
                protocol=protocol,
                gate=gate,
            ):
                break

            frame += 1
            sleep_time = frame_interval - (time.time() - t0)
            if sleep_time > 0:
                time.sleep(sleep_time)

    except KeyboardInterrupt:
        pass
    finally:
        preview.close()
        if args.play_audio:
            try:
                import sounddevice as sd
                sd.stop()
            except Exception:
                pass

    print(f"\nDemo complete: {frame} frames rendered")


def main():
    parser = argparse.ArgumentParser(
        description="LightFlow v4 — Real-Time ML Lighting System",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # --- generate-data ---
    gen = subparsers.add_parser("generate-data", help="Generate training data")
    gen.add_argument("--audio-dir", type=str, required=True,
                     help="Directory containing audio files")
    gen.add_argument("--output-dir", type=str, default="data/training",
                     help="Output directory for training data")
    gen.add_argument("--cache-dir", type=str, default=None,
                     help="Demucs cache directory")
    gen.add_argument("--styles", nargs="+", default=None,
                     choices=["energetic", "dramatic", "chill", "elegant", "party"])
    gen.add_argument("--model", type=str, default="claude-sonnet-4-6",
                     help="Claude model for show generation")
    gen.add_argument("--max-songs", type=int, default=None)

    # --- train ---
    tr = subparsers.add_parser("train", help="Train the model")
    tr.add_argument("--config", type=str, default="model/config/v4.yaml",
                    help="Config YAML path")
    tr.add_argument("--data-dir", type=str, default="data/training",
                    help="Training data directory")
    tr.add_argument("--checkpoint-dir", type=str, default="checkpoints",
                    help="Checkpoint output directory")
    tr.add_argument("--epochs", type=int, default=None)
    tr.add_argument("--batch-size", type=int, default=None)
    tr.add_argument("--lr", type=float, default=None)

    # --- run ---
    run = subparsers.add_parser("run", help="Run real-time inference")
    run.add_argument("--checkpoint", type=str, required=True,
                     help="Path to model checkpoint")
    run.add_argument("--dmx", type=str, default="dummy",
                     choices=["sacn", "usb", "dummy"])
    run.add_argument("--sacn-ip", type=str, default=None)
    run.add_argument("--usb-port", type=str, default=None)
    run.add_argument("--audio-device", type=str, default=None)
    run.add_argument("--no-preview", action="store_true")
    run.add_argument("--fps", type=int, default=30)

    # --- demo ---
    demo = subparsers.add_parser("demo", help="Demo mode")
    demo.add_argument("--checkpoint", type=str, default=None,
                      help="Model checkpoint (optional for demo)")
    demo.add_argument("--audio", type=str, default=None,
                      help="Audio file to demo with")
    demo.add_argument("--play-audio", action="store_true",
                      help="Also play the audio through speakers")
    demo.add_argument("--fps", type=int, default=30)

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        return

    commands = {
        "generate-data": cmd_generate_data,
        "train": cmd_train,
        "run": cmd_run,
        "demo": cmd_demo,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
