"""Iterative training pipeline with self-checking.

Runs the full loop: data check → train → evaluate → check metrics → adjust → retrain
until per-channel Pearson r meets target thresholds or max iterations reached.

Usage:
    python scripts/pipeline.py --input-dir ~/Desktop/beatport_tracks_2026-01/
    python scripts/pipeline.py --skip-data-prep     # if data/ already exists
    python scripts/pipeline.py --target-r 0.7       # custom correlation target
"""

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

import yaml


CHANNEL_NAMES = [
    "bass_energy", "kick_energy", "snare_energy",
    "hat_energy", "vocals_energy", "other_energy",
]

# Hyperparameter search space for CNN iteration
HYPERPARAMS = [
    # (epochs, lr, hidden_dim, batch_size, dropout, description)
    (30,  0.0005, 128, 64, 0.2,  "baseline"),
    (40,  0.0003, 128, 64, 0.15, "lower lr + less dropout"),
    (40,  0.0005, 192, 32, 0.2,  "wider model + smaller batch"),
    (60,  0.0003, 192, 32, 0.15, "wider + longer + low lr"),
    (80,  0.0002, 256, 32, 0.1,  "full capacity"),
]

# Hyperparameter search space for StreamingGRU
STREAMING_HYPERPARAMS = [
    # (epochs, lr, hidden_dim, batch_size, dropout, gru_layers, seq_len, description)
    (30,  0.0005, 128, 32, 0.15, 2, 64,  "streaming baseline"),
    (40,  0.0003, 128, 32, 0.15, 2, 64,  "streaming lower lr"),
    (40,  0.0005, 192, 16, 0.2,  2, 64,  "streaming wider"),
    (60,  0.0003, 192, 16, 0.15, 3, 96,  "streaming deeper + longer seq"),
    (80,  0.0002, 256, 16, 0.1,  2, 128, "streaming full capacity"),
]


def run_cmd(cmd: list[str], desc: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """Run a command, printing output in real time."""
    print(f"\n{'='*60}")
    print(f"  {desc}")
    print(f"{'='*60}\n", flush=True)
    env = {**__import__("os").environ, "PYTHONUNBUFFERED": "1", "KMP_DUPLICATE_LIB_OK": "TRUE"}
    result = subprocess.run(cmd, cwd=cwd, text=True, env=env)
    if result.returncode != 0:
        print(f"\n  FAILED: {desc} (exit code {result.returncode})")
    return result


def check_data(data_dir: Path) -> dict:
    """Check data directory for valid training data."""
    tracks = []
    if not data_dir.exists():
        return {"ok": False, "tracks": [], "msg": f"Data dir {data_dir} does not exist"}

    for d in sorted(data_dir.iterdir()):
        if not d.is_dir() or d.name.startswith("."):
            continue
        audio = d / "audio.wav"
        labels = d / "labels.json"
        if audio.exists() and labels.exists():
            with open(labels) as f:
                data = json.load(f)
            n_states = len(data.get("states", []))
            duration = data.get("duration", 0)
            # Check labels have actual non-zero content
            has_content = False
            for state in data.get("states", [])[:100]:
                channels = state.get("channels", {})
                if any(v > 0.01 for v in channels.values()):
                    has_content = True
                    break
            tracks.append({
                "name": d.name,
                "duration": duration,
                "frames": n_states,
                "has_content": has_content,
            })

    n_valid = sum(1 for t in tracks if t["has_content"])
    ok = n_valid >= 3  # need at least 3 tracks with non-zero labels

    return {
        "ok": ok,
        "tracks": tracks,
        "n_valid": n_valid,
        "msg": f"{n_valid}/{len(tracks)} tracks with valid stem labels"
    }


def load_eval_metrics(eval_dir: Path) -> dict | None:
    """Load evaluation metrics if they exist."""
    metrics_path = eval_dir / "metrics.json"
    if not metrics_path.exists():
        return None
    with open(metrics_path) as f:
        return json.load(f)


def check_metrics(metrics: dict, target_r: float) -> dict:
    """Check if metrics meet targets."""
    channels = metrics.get("channels", {})
    results = {}
    all_pass = True
    for name in CHANNEL_NAMES:
        ch = channels.get(name, {})
        r = ch.get("pearson_r", 0)
        mse = ch.get("mse", 1.0)
        passed = r >= target_r
        if not passed:
            all_pass = False
        results[name] = {"r": r, "mse": mse, "passed": passed}

    return {"all_pass": all_pass, "channels": results, "overall_mse": metrics.get("overall_mse", 1.0)}


def update_config(config_path: Path, lr: float, hidden_dim: int, batch_size: int,
                  dropout: float, epochs: int, gru_layers: int | None = None,
                  seq_len: int | None = None):
    """Update config with new hyperparameters."""
    with open(config_path) as f:
        config = yaml.safe_load(f)

    config["model"]["hidden_dim"] = hidden_dim
    config["model"]["dropout"] = dropout
    config["training"]["learning_rate"] = lr
    config["training"]["batch_size"] = batch_size
    config["training"]["epochs"] = epochs

    if gru_layers is not None:
        config["model"]["gru_layers"] = gru_layers
    if seq_len is not None:
        config["model"]["seq_len"] = seq_len

    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

    return config


def main():
    parser = argparse.ArgumentParser(description="Iterative LightFlow training pipeline")
    parser.add_argument("--input-dir", type=str, default=None,
                        help="Directory containing raw audio tracks (for data prep)")
    parser.add_argument("--data-dir", type=str, default="data",
                        help="Processed data directory")
    parser.add_argument("--skip-data-prep", action="store_true",
                        help="Skip data preparation step")
    parser.add_argument("--target-r", type=float, default=0.6,
                        help="Target Pearson r per channel (default: 0.6)")
    parser.add_argument("--max-iterations", type=int, default=5,
                        help="Maximum training iterations")
    parser.add_argument("--config", type=str, default="config/default.yaml")
    args = parser.parse_args()

    model_dir = Path(__file__).parent.parent
    data_dir = model_dir / args.data_dir
    config_path = model_dir / args.config
    checkpoint_dir = model_dir / "checkpoints"
    eval_dir = model_dir / "eval_results"

    print("=" * 60)
    print("  LightFlow Iterative Training Pipeline")
    print("=" * 60)
    print(f"  Target Pearson r: {args.target_r}")
    print(f"  Max iterations: {args.max_iterations}")
    print(f"  Data dir: {data_dir}")
    print()

    # ─── STEP 1: Data Preparation ────────────────────────────
    if not args.skip_data_prep:
        if not args.input_dir:
            print("ERROR: --input-dir required for data preparation")
            print("  Use --skip-data-prep if data/ already exists")
            sys.exit(1)

        result = run_cmd(
            [sys.executable, "scripts/prepare_data.py",
             "--input-dir", args.input_dir,
             "--output-dir", args.data_dir],
            "Step 1: Preparing training data (demucs separation)",
            cwd=str(model_dir),
        )
        if result.returncode != 0:
            print("\nData preparation failed. Check demucs installation.")
            sys.exit(1)

    # ─── STEP 2: Validate Data ───────────────────────────────
    print("\n" + "=" * 60)
    print("  Step 2: Validating data")
    print("=" * 60)

    data_check = check_data(data_dir)
    print(f"\n  {data_check['msg']}")
    for t in data_check["tracks"]:
        status = "OK" if t["has_content"] else "EMPTY LABELS"
        print(f"    {t['name']}: {t['duration']:.0f}s, {t['frames']} frames [{status}]")

    if not data_check["ok"]:
        print("\nNot enough valid training data. Need at least 3 tracks with stem labels.")
        print("Re-run data preparation or check demucs output.")
        sys.exit(1)

    # ─── STEP 3: Iterative Training Loop ─────────────────────
    best_overall_r = -1.0
    best_iteration = -1

    # Detect model type from config
    with open(config_path) as f:
        base_config = yaml.safe_load(f)
    is_streaming = base_config["model"]["type"] == "streaming_gru"
    hp_list = STREAMING_HYPERPARAMS if is_streaming else HYPERPARAMS

    for iteration in range(args.max_iterations):
        hp = hp_list[iteration % len(hp_list)]

        if is_streaming:
            epochs, lr, hidden_dim, batch_size, dropout, gru_layers, seq_len, desc = hp
            print(f"\n{'#'*60}")
            print(f"  Iteration {iteration + 1}/{args.max_iterations}: {desc}")
            print(f"  epochs={epochs}, lr={lr}, hidden={hidden_dim}, batch={batch_size}, "
                  f"dropout={dropout}, gru_layers={gru_layers}, seq_len={seq_len}")
            print(f"{'#'*60}")
            config = update_config(config_path, lr, hidden_dim, batch_size, dropout, epochs,
                                   gru_layers=gru_layers, seq_len=seq_len)
        else:
            epochs, lr, hidden_dim, batch_size, dropout, desc = hp
            print(f"\n{'#'*60}")
            print(f"  Iteration {iteration + 1}/{args.max_iterations}: {desc}")
            print(f"  epochs={epochs}, lr={lr}, hidden={hidden_dim}, batch={batch_size}, dropout={dropout}")
            print(f"{'#'*60}")
            config = update_config(config_path, lr, hidden_dim, batch_size, dropout, epochs)

        # Clear old checkpoints for this run
        best_pt = checkpoint_dir / "best.pt"

        # Train
        t0 = time.time()
        result = run_cmd(
            [sys.executable, "train.py",
             "--config", str(config_path),
             "--data-dir", args.data_dir],
            f"Training iteration {iteration + 1}",
            cwd=str(model_dir),
        )
        elapsed = time.time() - t0
        print(f"\n  Training took {elapsed:.0f}s")

        if result.returncode != 0 or not best_pt.exists():
            print("  Training failed or no checkpoint saved. Skipping evaluation.")
            continue

        # Evaluate
        result = run_cmd(
            [sys.executable, "evaluate.py",
             "--checkpoint", str(best_pt),
             "--config", str(config_path),
             "--data-dir", args.data_dir,
             "--output-dir", str(eval_dir)],
            f"Evaluating iteration {iteration + 1}",
            cwd=str(model_dir),
        )

        if result.returncode != 0:
            print("  Evaluation failed.")
            continue

        # Check metrics
        metrics = load_eval_metrics(eval_dir)
        if metrics is None:
            print("  No metrics file found.")
            continue

        check = check_metrics(metrics, args.target_r)

        print(f"\n  {'─'*50}")
        print(f"  Iteration {iteration + 1} Results (target r >= {args.target_r}):")
        print(f"  {'─'*50}")
        print(f"  {'Channel':<16} {'Pearson r':>10} {'MSE':>8} {'Status':>8}")
        print(f"  {'─'*50}")

        avg_r = 0.0
        for name in CHANNEL_NAMES:
            ch = check["channels"][name]
            status = "PASS" if ch["passed"] else "FAIL"
            print(f"  {name:<16} {ch['r']:>10.4f} {ch['mse']:>8.5f} {status:>8}")
            avg_r += ch["r"]
        avg_r /= len(CHANNEL_NAMES)

        print(f"  {'─'*50}")
        print(f"  Overall MSE: {check['overall_mse']:.6f}, Avg r: {avg_r:.4f}")

        if avg_r > best_overall_r:
            best_overall_r = avg_r
            best_iteration = iteration + 1
            # Save best checkpoint with iteration metadata
            import shutil
            shutil.copy2(checkpoint_dir / "best.pt", checkpoint_dir / "pipeline_best.pt")
            print(f"\n  New best model! (avg r = {avg_r:.4f})")

        if check["all_pass"]:
            print(f"\n  ALL CHANNELS PASS target r >= {args.target_r}")
            print(f"  Pipeline complete after {iteration + 1} iteration(s)!")
            break
        else:
            failed = [n for n, c in check["channels"].items() if not c["passed"]]
            print(f"\n  Channels below target: {', '.join(failed)}")
            if iteration < args.max_iterations - 1:
                print(f"  Trying next hyperparameter configuration...")

    # ─── SUMMARY ─────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  Pipeline Summary")
    print(f"{'='*60}")
    print(f"  Best iteration: {best_iteration}")
    print(f"  Best avg Pearson r: {best_overall_r:.4f}")
    print(f"  Best checkpoint: checkpoints/pipeline_best.pt")
    print(f"  Evaluation plot: eval_results/evaluation_plot.png")
    print()

    if best_overall_r >= args.target_r:
        print("  READY for live inference:")
        print("    python inference.py --checkpoint checkpoints/pipeline_best.pt --mode live")
        print("    python scripts/live_show.py --checkpoint checkpoints/pipeline_best.pt")
    else:
        print(f"  Model did not reach target r={args.target_r}.")
        print("  Consider: more training data, longer training, or lower target.")
    print()


if __name__ == "__main__":
    main()
