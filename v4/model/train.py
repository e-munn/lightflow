"""Training loop for LightFlow v4 with multi-head weighted loss.

Loss heads and weights:
    stem_energy [0:6]     weight=1.0   MSE
    onsets [6:9]          weight=0.8   MSE
    spatial [9:17]        weight=0.6   MSE
    texture_motion [17:27] weight=0.5  MSE (motion[17:21] + texture[21:27])
    color [27:31]         weight=0.5   MSE (grouped with texture_motion)
    dynamics [31:35]      weight=0.5   MSE
    section [35:41]       weight=0.4   CrossEntropy
    future [44:64]        weight=0.3   MSE
    bpm [41:44]           weight=0.2   MSE
    gate [34]             weight=0.1   BCE
"""

from __future__ import annotations

from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, ConcatDataset

from .dataset import ProtocolSequenceDataset, SilenceDataset
from .model import build_model
from .protocol import Slice, NUM_SECTIONS


def compute_loss(
    outputs: dict[str, torch.Tensor],
    labels: torch.Tensor,
    loss_weights: dict[str, float],
) -> tuple[torch.Tensor, dict[str, float]]:
    """Compute multi-head weighted loss.

    Args:
        outputs: model outputs dict
        labels: (batch, seq_len, 64) protocol vector targets
        loss_weights: per-head weight dict

    Returns:
        (total_loss, per_head_losses_dict)
    """
    mse = nn.functional.mse_loss
    bce = nn.functional.binary_cross_entropy
    ce = nn.functional.cross_entropy

    protocol = outputs["protocol"]        # (batch, seq_len, 35)
    section_logits = outputs["section_logits"]  # (batch, seq_len, 6)
    bpm_pred = outputs["bpm"]             # (batch, seq_len, 3)
    gate_pred = outputs["gate"]           # (batch, seq_len, 1)
    future_pred = outputs["future"]       # (batch, seq_len, 20)

    losses = {}

    # Stem energy [0:6]
    losses["stem_energy"] = mse(
        protocol[:, :, Slice.STEM_ENERGY:Slice.STEM_ENERGY + 6],
        labels[:, :, Slice.STEM_ENERGY:Slice.STEM_ENERGY + 6],
    )

    # Onsets [6:9]
    losses["onsets"] = mse(
        protocol[:, :, Slice.ONSET:Slice.ONSET + 3],
        labels[:, :, Slice.ONSET:Slice.ONSET + 3],
    )

    # Spatial [9:17]
    losses["spatial"] = mse(
        protocol[:, :, Slice.SPATIAL:Slice.SPATIAL + 8],
        labels[:, :, Slice.SPATIAL:Slice.SPATIAL + 8],
    )

    # Motion [17:21] + Texture [21:27]
    losses["texture_motion"] = mse(
        protocol[:, :, Slice.MOTION:Slice.TEXTURE + 6],
        labels[:, :, Slice.MOTION:Slice.TEXTURE + 6],
    )

    # Section — CrossEntropy: convert one-hot targets to class indices
    section_targets = labels[:, :, Slice.SECTION:Slice.SECTION + NUM_SECTIONS]
    section_indices = section_targets.argmax(dim=-1)  # (batch, seq_len)
    losses["section"] = ce(
        section_logits.reshape(-1, NUM_SECTIONS),
        section_indices.reshape(-1),
    )

    # Future [44:64]
    losses["future"] = mse(
        future_pred,
        labels[:, :, Slice.FUTURE:Slice.FUTURE + 20],
    )

    # BPM [41:44]
    losses["bpm"] = mse(
        bpm_pred,
        labels[:, :, Slice.BPM:Slice.BPM + 3],
    )

    # Gate — BCE on single channel
    gate_target = labels[:, :, Slice.DYNAMICS + 3:Slice.DYNAMICS + 4]  # (batch, seq_len, 1)
    losses["gate"] = bce(gate_pred, gate_target)

    # Weighted total
    total = sum(loss_weights.get(k, 0.5) * v for k, v in losses.items())

    # Return scalar losses for logging
    loss_values = {k: v.item() for k, v in losses.items()}
    return total, loss_values


def train(
    config: dict,
    data_dir: str,
    checkpoint_dir: str,
):
    """Main training loop."""
    device = torch.device(
        "cuda" if torch.cuda.is_available()
        else "mps" if torch.backends.mps.is_available()
        else "cpu"
    )
    print(f"Device: {device}")

    # Datasets
    train_dataset = ProtocolSequenceDataset(data_dir, config, split="train")
    val_dataset = ProtocolSequenceDataset(data_dir, config, split="val")

    if len(train_dataset) == 0:
        print("No training data found. Run `python -m data.batch_generate` first.")
        return

    # Add silence samples for gate training
    n_silence = max(len(train_dataset) // 10, 50)
    silence_dataset = SilenceDataset(n_silence, config)
    train_combined = ConcatDataset([train_dataset, silence_dataset])

    print(f"Training: {len(train_dataset)} + {n_silence} silence = {len(train_combined)}")
    print(f"Validation: {len(val_dataset)}")

    train_cfg = config["training"]
    loss_weights = train_cfg["loss_weights"]

    train_loader = DataLoader(
        train_combined,
        batch_size=train_cfg["batch_size"],
        shuffle=True,
        num_workers=0,
        pin_memory=True,
    )
    val_loader = DataLoader(
        val_dataset,
        batch_size=train_cfg["batch_size"],
        shuffle=False,
        num_workers=0,
    )

    # Model
    model = build_model(config).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {n_params:,}")

    # Optimizer + scheduler
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=train_cfg["learning_rate"],
        weight_decay=train_cfg["weight_decay"],
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=train_cfg["epochs"],
    )

    # TensorBoard
    writer = None
    try:
        from torch.utils.tensorboard import SummaryWriter
        writer = SummaryWriter(Path(checkpoint_dir).parent / "runs")
    except ImportError:
        pass

    checkpoint_path = Path(checkpoint_dir)
    checkpoint_path.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")
    print(f"Loss weights: {loss_weights}")
    print()

    for epoch in range(train_cfg["epochs"]):
        # === Train ===
        model.train()
        train_loss_total = 0.0
        train_head_losses: dict[str, float] = {}

        for features, labels in train_loader:
            features = features.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            outputs = model(features)

            loss, head_losses = compute_loss(outputs, labels, loss_weights)
            loss.backward()

            if train_cfg.get("grad_clip"):
                nn.utils.clip_grad_norm_(model.parameters(), train_cfg["grad_clip"])

            optimizer.step()

            train_loss_total += loss.item()
            for k, v in head_losses.items():
                train_head_losses[k] = train_head_losses.get(k, 0.0) + v

        n_batches = len(train_loader)
        train_loss_total /= n_batches
        for k in train_head_losses:
            train_head_losses[k] /= n_batches
        scheduler.step()

        # === Validate ===
        model.eval()
        val_loss_total = 0.0
        val_head_losses: dict[str, float] = {}
        n_val = 0

        with torch.no_grad():
            for features, labels in val_loader:
                features = features.to(device)
                labels = labels.to(device)

                outputs = model(features)
                loss, head_losses = compute_loss(outputs, labels, loss_weights)

                val_loss_total += loss.item()
                for k, v in head_losses.items():
                    val_head_losses[k] = val_head_losses.get(k, 0.0) + v
                n_val += 1

        if n_val > 0:
            val_loss_total /= n_val
            for k in val_head_losses:
                val_head_losses[k] /= n_val

        lr = optimizer.param_groups[0]["lr"]

        # Print summary
        head_str = " ".join(f"{k}={v:.4f}" for k, v in sorted(train_head_losses.items()))
        print(f"Epoch {epoch+1}/{train_cfg['epochs']} — "
              f"Train: {train_loss_total:.5f} — Val: {val_loss_total:.5f} — LR: {lr:.6f}")
        print(f"  Heads: {head_str}")

        # TensorBoard logging
        if writer:
            writer.add_scalar("Loss/train", train_loss_total, epoch)
            writer.add_scalar("Loss/val", val_loss_total, epoch)
            writer.add_scalar("LR", lr, epoch)
            for k, v in train_head_losses.items():
                writer.add_scalar(f"Train/{k}", v, epoch)
            for k, v in val_head_losses.items():
                writer.add_scalar(f"Val/{k}", v, epoch)

        # Save best
        if val_loss_total < best_val_loss:
            best_val_loss = val_loss_total
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss_total,
                "config": config,
            }, checkpoint_path / "best.pt")
            print(f"  -> Saved best (val={val_loss_total:.5f})")

        # Periodic checkpoint
        if (epoch + 1) % 10 == 0:
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss_total,
                "config": config,
            }, checkpoint_path / f"epoch_{epoch+1}.pt")

    if writer:
        writer.close()
    print(f"\nTraining complete. Best val loss: {best_val_loss:.5f}")
