"""Evaluate a trained model on the test split.

Computes per-channel MSE and Pearson correlation, generates comparison plots.

Usage:
    python evaluate.py --checkpoint checkpoints/best.pt
"""

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import yaml
from scipy import stats
from torch.utils.data import DataLoader

from src.dataset import LightFlowDataset, LightFlowSequenceDataset, SilenceNoiseDataset, STEM_CHANNELS
from src.model import build_model


def evaluate(config: dict, checkpoint_path: str, data_dir: str, output_dir: str):
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load model
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_model(config).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    epoch = checkpoint.get("epoch", "?")
    print(f"Loaded checkpoint from epoch {epoch} (val_loss={checkpoint.get('val_loss', '?')})")

    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]

    # Test dataset
    test_dataset = LightFlowDataset(data_dir, config, split="test")
    if len(test_dataset) == 0:
        print("No test data found.")
        return

    print(f"Test samples: {len(test_dataset)}")

    test_loader = DataLoader(
        test_dataset,
        batch_size=config["training"]["batch_size"],
        shuffle=False,
        num_workers=0,
    )

    # Collect all predictions and labels
    all_preds = []
    all_labels = []
    with torch.no_grad():
        for features, labels in test_loader:
            features = features.to(device)
            predictions = model(features).cpu().numpy()
            all_preds.append(predictions)
            all_labels.append(labels.numpy())

    all_preds = np.concatenate(all_preds, axis=0)
    all_labels = np.concatenate(all_labels, axis=0)
    n_frames = len(all_preds)
    print(f"Evaluated {n_frames} frames")

    # Per-channel metrics
    metrics = {"n_frames": n_frames, "channels": {}}
    print(f"\n{'Channel':<16} {'MSE':>8} {'Pearson r':>10} {'p-value':>10}")
    print("-" * 48)

    for i, name in enumerate(channel_names):
        pred_ch = all_preds[:, i]
        label_ch = all_labels[:, i]
        mse = float(np.mean((pred_ch - label_ch) ** 2))
        r, p = stats.pearsonr(pred_ch, label_ch) if np.std(label_ch) > 1e-6 else (0.0, 1.0)
        metrics["channels"][name] = {
            "mse": round(mse, 6),
            "pearson_r": round(float(r), 4),
            "pearson_p": round(float(p), 6),
        }
        print(f"{name:<16} {mse:>8.6f} {r:>10.4f} {p:>10.6f}")

    overall_mse = float(np.mean((all_preds - all_labels) ** 2))
    metrics["overall_mse"] = round(overall_mse, 6)
    print(f"\nOverall MSE: {overall_mse:.6f}")

    # Save metrics
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    with open(out_path / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"Saved metrics to {out_path / 'metrics.json'}")

    # Plot: predicted vs actual for each channel
    colors = ["purple", "red", "orange", "cyan", "blue", "green"]
    fig, axes = plt.subplots(output_dim, 1, figsize=(14, 2.5 * output_dim), sharex=True)
    if output_dim == 1:
        axes = [axes]

    times = np.arange(n_frames) * config["audio"]["hop_seconds"]

    for i, (ax, name) in enumerate(zip(axes, channel_names)):
        ax.plot(times, all_labels[:, i], alpha=0.7, label="Ground Truth", color=colors[i % len(colors)])
        ax.plot(times, all_preds[:, i], alpha=0.7, label="Predicted", color=colors[i % len(colors)], linestyle="--")
        ax.set_ylabel(name)
        ax.set_ylim(-0.05, 1.05)
        ax.legend(loc="upper right", fontsize=8)
        ax.grid(True, alpha=0.3)

    axes[-1].set_xlabel("Time (s)")
    fig.suptitle(f"Model Evaluation — Overall MSE: {overall_mse:.6f}", fontsize=14)
    plt.tight_layout()
    plt.savefig(out_path / "evaluation_plot.png", dpi=150)
    print(f"Saved plot to {out_path / 'evaluation_plot.png'}")


def evaluate_streaming(config: dict, checkpoint_path: str, data_dir: str, output_dir: str):
    """Evaluate StreamingGRU on test split with future + gate metrics."""
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Load model
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
    model = build_model(config).to(device)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    epoch = checkpoint.get("epoch", "?")
    print(f"Loaded checkpoint from epoch {epoch} (val_loss={checkpoint.get('val_loss', '?')})")

    output_dim = config["model"]["output_dim"]
    n_future = config["model"].get("n_future", 4)
    hop_sec = config["audio"]["hop_seconds"]
    channel_names = STEM_CHANNELS[:output_dim]

    # Test sequence dataset
    test_dataset = LightFlowSequenceDataset(data_dir, config, split="test")
    if len(test_dataset) == 0:
        print("No test data found.")
        return

    print(f"Test sequences: {len(test_dataset)}")

    test_loader = DataLoader(
        test_dataset,
        batch_size=config["training"]["batch_size"],
        shuffle=False,
        num_workers=0,
    )

    # Collect predictions
    all_energy_preds = []
    all_energy_labels = []
    all_future_preds = []
    all_future_labels = []
    all_gate_preds = []
    all_gate_labels = []

    with torch.no_grad():
        for feat_seq, energy_labels, future_labels, gate_labels in test_loader:
            feat_input = feat_seq.unsqueeze(2).to(device)
            outputs = model(feat_input)

            # Flatten batch × seq_len
            all_energy_preds.append(outputs["energy"].cpu().numpy().reshape(-1, output_dim))
            all_energy_labels.append(energy_labels.numpy().reshape(-1, output_dim))
            all_future_preds.append(outputs["future"].cpu().numpy().reshape(-1, n_future, output_dim))
            all_future_labels.append(future_labels.numpy().reshape(-1, n_future, output_dim))
            all_gate_preds.append(outputs["gate"].cpu().numpy().reshape(-1))
            all_gate_labels.append(gate_labels.numpy().reshape(-1))

    all_energy_preds = np.concatenate(all_energy_preds, axis=0)
    all_energy_labels = np.concatenate(all_energy_labels, axis=0)
    all_future_preds = np.concatenate(all_future_preds, axis=0)
    all_future_labels = np.concatenate(all_future_labels, axis=0)
    all_gate_preds = np.concatenate(all_gate_preds, axis=0)
    all_gate_labels = np.concatenate(all_gate_labels, axis=0)

    n_frames = len(all_energy_preds)
    print(f"Evaluated {n_frames} frames\n")

    metrics = {"n_frames": n_frames, "channels": {}, "future": {}, "gate": {}}

    # ── Energy head metrics ──
    print(f"{'Channel':<16} {'MSE':>8} {'Pearson r':>10} {'p-value':>10}")
    print("-" * 48)

    for i, name in enumerate(channel_names):
        pred_ch = all_energy_preds[:, i]
        label_ch = all_energy_labels[:, i]
        mse = float(np.mean((pred_ch - label_ch) ** 2))
        r, p = stats.pearsonr(pred_ch, label_ch) if np.std(label_ch) > 1e-6 else (0.0, 1.0)
        metrics["channels"][name] = {
            "mse": round(mse, 6),
            "pearson_r": round(float(r), 4),
            "pearson_p": round(float(p), 6),
        }
        print(f"{name:<16} {mse:>8.6f} {r:>10.4f} {p:>10.6f}")

    overall_mse = float(np.mean((all_energy_preds - all_energy_labels) ** 2))
    metrics["overall_mse"] = round(overall_mse, 6)
    print(f"\nOverall MSE: {overall_mse:.6f}")

    # ── Future head metrics (per horizon) ──
    print(f"\nFuture Prediction Accuracy:")
    print(f"{'Horizon':>10} {'MSE':>8} {'Avg r':>8}")
    print("-" * 30)

    for f in range(n_future):
        horizon_ms = (f + 1) * hop_sec * 1000
        f_preds = all_future_preds[:, f, :]
        f_labels = all_future_labels[:, f, :]
        f_mse = float(np.mean((f_preds - f_labels) ** 2))

        # Average Pearson r across channels
        rs = []
        for i in range(output_dim):
            if np.std(f_labels[:, i]) > 1e-6:
                r, _ = stats.pearsonr(f_preds[:, i], f_labels[:, i])
                rs.append(float(r))
        avg_r = np.mean(rs) if rs else 0.0

        metrics["future"][f"{int(horizon_ms)}ms"] = {
            "mse": round(f_mse, 6),
            "avg_pearson_r": round(float(avg_r), 4),
        }
        print(f"{int(horizon_ms):>8}ms {f_mse:>8.6f} {avg_r:>8.4f}")

    # ── Gate head metrics ──
    gate_binary = (all_gate_preds > 0.5).astype(float)
    gate_accuracy = float(np.mean(gate_binary == all_gate_labels))
    n_music = int(np.sum(all_gate_labels > 0.5))
    n_silence = int(np.sum(all_gate_labels <= 0.5))
    metrics["gate"] = {
        "accuracy": round(gate_accuracy, 4),
        "n_music_frames": n_music,
        "n_silence_frames": n_silence,
    }
    print(f"\nGate Accuracy: {gate_accuracy:.4f} ({n_music} music, {n_silence} silence frames)")

    # ── Gate on synthetic silence ──
    silence_dataset = SilenceNoiseDataset(100, config)
    silence_loader = DataLoader(silence_dataset, batch_size=32, shuffle=False)
    silence_gate_preds = []
    with torch.no_grad():
        for feat_seq, _, _, _ in silence_loader:
            feat_input = feat_seq.unsqueeze(2).to(device)
            outputs = model(feat_input)
            silence_gate_preds.append(outputs["gate"].cpu().numpy().reshape(-1))
    silence_gate_preds = np.concatenate(silence_gate_preds)
    silence_gate_mean = float(np.mean(silence_gate_preds))
    silence_gate_below = float(np.mean(silence_gate_preds < 0.3))
    metrics["gate"]["silence_mean_pred"] = round(silence_gate_mean, 4)
    metrics["gate"]["silence_pct_below_0.3"] = round(silence_gate_below, 4)
    print(f"Silence gate: mean={silence_gate_mean:.4f}, "
          f"{silence_gate_below*100:.1f}% below 0.3 threshold")

    # Save metrics
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    with open(out_path / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    print(f"\nSaved metrics to {out_path / 'metrics.json'}")

    # ── Plot: energy predictions vs actual ──
    colors = ["purple", "red", "orange", "cyan", "blue", "green"]
    fig, axes = plt.subplots(output_dim + 1, 1, figsize=(14, 2.5 * (output_dim + 1)), sharex=True)

    times = np.arange(n_frames) * hop_sec

    for i, (ax, name) in enumerate(zip(axes[:output_dim], channel_names)):
        ax.plot(times, all_energy_labels[:, i], alpha=0.7, label="Ground Truth",
                color=colors[i % len(colors)])
        ax.plot(times, all_energy_preds[:, i], alpha=0.7, label="Predicted",
                color=colors[i % len(colors)], linestyle="--")
        ax.set_ylabel(name)
        ax.set_ylim(-0.05, 1.05)
        ax.legend(loc="upper right", fontsize=8)
        ax.grid(True, alpha=0.3)

    # Gate plot
    axes[-1].plot(times, all_gate_labels, alpha=0.5, label="Gate Truth", color="gray")
    axes[-1].plot(times, all_gate_preds, alpha=0.7, label="Gate Pred", color="black", linestyle="--")
    axes[-1].set_ylabel("Gate")
    axes[-1].set_ylim(-0.05, 1.05)
    axes[-1].legend(loc="upper right", fontsize=8)
    axes[-1].grid(True, alpha=0.3)

    axes[-1].set_xlabel("Time (s)")
    fig.suptitle(f"StreamingGRU Evaluation — MSE: {overall_mse:.6f}, Gate Acc: {gate_accuracy:.4f}",
                 fontsize=14)
    plt.tight_layout()
    plt.savefig(out_path / "evaluation_plot.png", dpi=150)
    print(f"Saved plot to {out_path / 'evaluation_plot.png'}")

    # ── Future accuracy plot ──
    fig2, ax2 = plt.subplots(1, 1, figsize=(8, 5))
    horizons = [(f + 1) * hop_sec * 1000 for f in range(n_future)]
    for i, name in enumerate(channel_names):
        rs_per_horizon = []
        for f in range(n_future):
            if np.std(all_future_labels[:, f, i]) > 1e-6:
                r, _ = stats.pearsonr(all_future_preds[:, f, i], all_future_labels[:, f, i])
                rs_per_horizon.append(float(r))
            else:
                rs_per_horizon.append(0.0)
        ax2.plot(horizons, rs_per_horizon, marker="o", label=name.replace("_energy", ""),
                 color=colors[i % len(colors)])

    ax2.set_xlabel("Prediction Horizon (ms)")
    ax2.set_ylabel("Pearson r")
    ax2.set_title("Future Prediction Accuracy by Horizon")
    ax2.legend()
    ax2.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(out_path / "future_accuracy.png", dpi=150)
    print(f"Saved future accuracy plot to {out_path / 'future_accuracy.png'}")


def main():
    parser = argparse.ArgumentParser(description="Evaluate LightFlow model on test split")
    parser.add_argument("--checkpoint", type=str, required=True,
                        help="Path to model checkpoint (.pt)")
    parser.add_argument("--config", type=str, default="config/default.yaml",
                        help="Path to config YAML file")
    parser.add_argument("--data-dir", type=str, default="data",
                        help="Path to data directory")
    parser.add_argument("--output-dir", type=str, default="eval_results",
                        help="Directory to save evaluation results")
    args = parser.parse_args()

    with open(args.config) as f:
        config = yaml.safe_load(f)

    if config["model"]["type"] == "streaming_gru":
        evaluate_streaming(config, args.checkpoint, args.data_dir, args.output_dir)
    else:
        evaluate(config, args.checkpoint, args.data_dir, args.output_dir)


if __name__ == "__main__":
    main()
