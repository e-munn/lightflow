"""Training entry point for the LightFlow audio-to-lighting model."""

import argparse
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
import yaml

from src.dataset import LightFlowDataset, LightFlowSequenceDataset, SilenceNoiseDataset, STEM_CHANNELS
from src.model import build_model


def train(config: dict, data_dir: str, checkpoint_dir: str):
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Datasets
    train_dataset = LightFlowDataset(data_dir, config, split="train")
    val_dataset = LightFlowDataset(data_dir, config, split="val")

    if len(train_dataset) == 0:
        print("No training data found. Run scripts/prepare_data.py first.")
        return

    print(f"Training samples: {len(train_dataset)}, Validation samples: {len(val_dataset)}")

    train_cfg = config["training"]
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]

    train_loader = DataLoader(
        train_dataset,
        batch_size=train_cfg["batch_size"],
        shuffle=True,
        num_workers=0,  # macOS stability (fork issues with librosa)
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
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Training setup
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=train_cfg["learning_rate"],
        weight_decay=train_cfg["weight_decay"],
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=train_cfg["epochs"],
    )
    criterion = nn.MSELoss()

    # TensorBoard logging
    writer = None
    try:
        from torch.utils.tensorboard import SummaryWriter
        writer = SummaryWriter(Path(checkpoint_dir).parent / "runs")
    except ImportError:
        pass

    checkpoint_path = Path(checkpoint_dir)
    checkpoint_path.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")

    for epoch in range(train_cfg["epochs"]):
        # Train
        model.train()
        train_loss = 0.0
        for batch_idx, (features, labels) in enumerate(train_loader):
            features, labels = features.to(device), labels.to(device)

            optimizer.zero_grad()
            predictions = model(features)
            loss = criterion(predictions, labels)
            loss.backward()

            if train_cfg.get("grad_clip"):
                nn.utils.clip_grad_norm_(model.parameters(), train_cfg["grad_clip"])

            optimizer.step()
            train_loss += loss.item()

        train_loss /= len(train_loader)
        scheduler.step()

        # Validate with per-channel tracking
        model.eval()
        val_loss = 0.0
        per_channel_mse = torch.zeros(output_dim)
        n_val_batches = 0
        with torch.no_grad():
            for features, labels in val_loader:
                features, labels = features.to(device), labels.to(device)
                predictions = model(features)
                val_loss += criterion(predictions, labels).item()

                # Per-channel MSE
                channel_mse = ((predictions - labels) ** 2).mean(dim=0).cpu()
                per_channel_mse += channel_mse
                n_val_batches += 1

        val_loss /= max(len(val_loader), 1)
        per_channel_mse /= max(n_val_batches, 1)

        lr = optimizer.param_groups[0]["lr"]
        print(f"Epoch {epoch+1}/{train_cfg['epochs']} - "
              f"Train: {train_loss:.6f} - Val: {val_loss:.6f} - LR: {lr:.6f}")

        # Print per-channel MSE
        ch_strs = [f"{name}: {per_channel_mse[i]:.4f}" for i, name in enumerate(channel_names)]
        print(f"  Per-channel MSE: {', '.join(ch_strs)}")

        if writer:
            writer.add_scalar("Loss/train", train_loss, epoch)
            writer.add_scalar("Loss/val", val_loss, epoch)
            writer.add_scalar("LR", lr, epoch)
            for i, name in enumerate(channel_names):
                writer.add_scalar(f"ValMSE/{name}", per_channel_mse[i].item(), epoch)

        # Save best model
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss,
                "config": config,
            }, checkpoint_path / "best.pt")
            print(f"  -> Saved best model (val_loss={val_loss:.6f})")

        # Periodic checkpoint
        if (epoch + 1) % 10 == 0:
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss,
                "config": config,
            }, checkpoint_path / f"epoch_{epoch+1}.pt")

    if writer:
        writer.close()
    print(f"Training complete. Best val loss: {best_val_loss:.6f}")


def train_streaming(config: dict, data_dir: str, checkpoint_dir: str,
                     warm_start: str | None = None):
    """Training loop for StreamingGRU with multi-head loss."""
    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    print(f"Using device: {device}")

    # Sequence datasets
    train_dataset = LightFlowSequenceDataset(data_dir, config, split="train")
    val_dataset = LightFlowSequenceDataset(data_dir, config, split="val")

    if len(train_dataset) == 0:
        print("No training data found. Run scripts/prepare_data.py first.")
        return

    # Add silence/noise samples for gate training (10% of training data)
    n_silence = max(len(train_dataset) // 10, 50)
    silence_dataset = SilenceNoiseDataset(n_silence, config)
    train_combined = torch.utils.data.ConcatDataset([train_dataset, silence_dataset])

    print(f"Training sequences: {len(train_dataset)} + {n_silence} silence = {len(train_combined)}")
    print(f"Validation sequences: {len(val_dataset)}")

    train_cfg = config["training"]
    output_dim = config["model"]["output_dim"]
    channel_names = STEM_CHANNELS[:output_dim]
    n_future = config["model"].get("n_future", 4)

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
    print(f"Model parameters: {sum(p.numel() for p in model.parameters()):,}")

    # Optional warm-start from CNN checkpoint (transfer conv weights)
    if warm_start:
        print(f"Warm-starting from {warm_start}...")
        ckpt = torch.load(warm_start, map_location=device, weights_only=False)
        src_state = ckpt["model_state_dict"]
        tgt_state = model.state_dict()
        transferred = 0
        for key in src_state:
            # Map conv.X → frame_encoder.X
            mapped_key = key.replace("conv.", "frame_encoder.")
            if mapped_key in tgt_state and src_state[key].shape == tgt_state[mapped_key].shape:
                tgt_state[mapped_key] = src_state[key]
                transferred += 1
        model.load_state_dict(tgt_state)
        print(f"  Transferred {transferred} parameter tensors from CNN checkpoint")

    # Loss functions and weights
    loss_weights = train_cfg.get("loss_weights", {"energy": 1.0, "future": 0.5, "gate": 0.1})
    w_energy = loss_weights["energy"]
    w_future = loss_weights["future"]
    w_gate = loss_weights["gate"]
    mse_loss = nn.MSELoss()
    bce_loss = nn.BCELoss()

    print(f"Loss weights: energy={w_energy}, future={w_future}, gate={w_gate}")

    # Optimizer and scheduler
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=train_cfg["learning_rate"],
        weight_decay=train_cfg["weight_decay"],
    )
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
        optimizer, T_max=train_cfg["epochs"],
    )

    # TensorBoard logging
    writer = None
    try:
        from torch.utils.tensorboard import SummaryWriter
        writer = SummaryWriter(Path(checkpoint_dir).parent / "runs")
    except ImportError:
        pass

    checkpoint_path = Path(checkpoint_dir)
    checkpoint_path.mkdir(parents=True, exist_ok=True)

    best_val_loss = float("inf")

    for epoch in range(train_cfg["epochs"]):
        # Train
        model.train()
        train_loss_total = 0.0
        train_loss_energy = 0.0
        train_loss_future = 0.0
        train_loss_gate = 0.0

        for batch_idx, (feat_seq, energy_labels, future_labels, gate_labels) in enumerate(train_loader):
            feat_seq = feat_seq.to(device)
            energy_labels = energy_labels.to(device)
            future_labels = future_labels.to(device)
            gate_labels = gate_labels.to(device)

            optimizer.zero_grad()

            # StreamingGRU forward expects (batch, seq_len, time_frames, feat_dim)
            # but our cached features are pre-pooled: (batch, seq_len, feat_dim)
            # We need to add a dummy time dimension
            feat_input = feat_seq.unsqueeze(2)  # (batch, seq_len, 1, feat_dim)

            outputs = model(feat_input)

            l_energy = mse_loss(outputs["energy"], energy_labels)
            l_future = mse_loss(outputs["future"], future_labels)
            l_gate = bce_loss(outputs["gate"], gate_labels)

            loss = w_energy * l_energy + w_future * l_future + w_gate * l_gate
            loss.backward()

            if train_cfg.get("grad_clip"):
                nn.utils.clip_grad_norm_(model.parameters(), train_cfg["grad_clip"])

            optimizer.step()

            train_loss_total += loss.item()
            train_loss_energy += l_energy.item()
            train_loss_future += l_future.item()
            train_loss_gate += l_gate.item()

        n_batches = len(train_loader)
        train_loss_total /= n_batches
        train_loss_energy /= n_batches
        train_loss_future /= n_batches
        train_loss_gate /= n_batches
        scheduler.step()

        # Validate
        model.eval()
        val_loss_total = 0.0
        val_loss_energy = 0.0
        val_loss_future = 0.0
        val_loss_gate = 0.0
        per_channel_mse = torch.zeros(output_dim)
        n_val_batches = 0

        with torch.no_grad():
            for feat_seq, energy_labels, future_labels, gate_labels in val_loader:
                feat_seq = feat_seq.to(device)
                energy_labels = energy_labels.to(device)
                future_labels = future_labels.to(device)
                gate_labels = gate_labels.to(device)

                feat_input = feat_seq.unsqueeze(2)
                outputs = model(feat_input)

                l_energy = mse_loss(outputs["energy"], energy_labels)
                l_future = mse_loss(outputs["future"], future_labels)
                l_gate = bce_loss(outputs["gate"], gate_labels)

                val_loss_total += (w_energy * l_energy + w_future * l_future + w_gate * l_gate).item()
                val_loss_energy += l_energy.item()
                val_loss_future += l_future.item()
                val_loss_gate += l_gate.item()

                # Per-channel MSE on energy head
                channel_mse = ((outputs["energy"] - energy_labels) ** 2).mean(dim=(0, 1)).cpu()
                per_channel_mse += channel_mse
                n_val_batches += 1

        val_loss_total /= max(n_val_batches, 1)
        val_loss_energy /= max(n_val_batches, 1)
        val_loss_future /= max(n_val_batches, 1)
        val_loss_gate /= max(n_val_batches, 1)
        per_channel_mse /= max(n_val_batches, 1)

        lr = optimizer.param_groups[0]["lr"]
        print(f"Epoch {epoch+1}/{train_cfg['epochs']} - "
              f"Train: {train_loss_total:.6f} (E:{train_loss_energy:.4f} F:{train_loss_future:.4f} G:{train_loss_gate:.4f}) - "
              f"Val: {val_loss_total:.6f} - LR: {lr:.6f}")

        ch_strs = [f"{name}: {per_channel_mse[i]:.4f}" for i, name in enumerate(channel_names)]
        print(f"  Per-channel MSE: {', '.join(ch_strs)}")

        if writer:
            writer.add_scalar("Loss/train", train_loss_total, epoch)
            writer.add_scalar("Loss/train_energy", train_loss_energy, epoch)
            writer.add_scalar("Loss/train_future", train_loss_future, epoch)
            writer.add_scalar("Loss/train_gate", train_loss_gate, epoch)
            writer.add_scalar("Loss/val", val_loss_total, epoch)
            writer.add_scalar("Loss/val_energy", val_loss_energy, epoch)
            writer.add_scalar("Loss/val_future", val_loss_future, epoch)
            writer.add_scalar("Loss/val_gate", val_loss_gate, epoch)
            writer.add_scalar("LR", lr, epoch)
            for i, name in enumerate(channel_names):
                writer.add_scalar(f"ValMSE/{name}", per_channel_mse[i].item(), epoch)

        # Save best model
        if val_loss_total < best_val_loss:
            best_val_loss = val_loss_total
            torch.save({
                "epoch": epoch,
                "model_state_dict": model.state_dict(),
                "optimizer_state_dict": optimizer.state_dict(),
                "val_loss": val_loss_total,
                "config": config,
            }, checkpoint_path / "best.pt")
            print(f"  -> Saved best model (val_loss={val_loss_total:.6f})")

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
    print(f"Training complete. Best val loss: {best_val_loss:.6f}")


def main():
    parser = argparse.ArgumentParser(description="Train LightFlow audio-to-lighting model")
    parser.add_argument("--config", type=str, default="config/default.yaml",
                        help="Path to config YAML file")
    parser.add_argument("--data-dir", type=str, default="data",
                        help="Path to training data directory")
    parser.add_argument("--checkpoint-dir", type=str, default="checkpoints",
                        help="Path to save model checkpoints")
    parser.add_argument("--epochs", type=int, default=None,
                        help="Override number of training epochs")
    parser.add_argument("--batch-size", type=int, default=None,
                        help="Override batch size")
    parser.add_argument("--lr", type=float, default=None,
                        help="Override learning rate")
    parser.add_argument("--warm-start", type=str, default=None,
                        help="Path to CNN checkpoint for warm-starting StreamingGRU conv weights")
    args = parser.parse_args()

    with open(args.config) as f:
        config = yaml.safe_load(f)

    # Apply overrides
    if args.epochs is not None:
        config["training"]["epochs"] = args.epochs
    if args.batch_size is not None:
        config["training"]["batch_size"] = args.batch_size
    if args.lr is not None:
        config["training"]["learning_rate"] = args.lr

    # Dispatch based on model type
    model_type = config["model"]["type"]
    if model_type == "streaming_gru":
        train_streaming(config, args.data_dir, args.checkpoint_dir,
                        warm_start=args.warm_start)
    else:
        train(config, args.data_dir, args.checkpoint_dir)


if __name__ == "__main__":
    main()
