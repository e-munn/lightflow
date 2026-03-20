"""Neural network architecture for audio-to-lighting prediction.

Takes audio features (mel spectrogram, onset, chroma, etc.) and outputs
abstract lighting state vectors conforming to the LightFlow protocol.
"""

import torch
import torch.nn as nn


class TemporalCNN(nn.Module):
    """Temporal CNN that processes audio feature windows.

    Architecture:
        - 1D conv layers over time axis with increasing receptive field
        - Global pooling to fixed-size representation
        - MLP head to lighting state output
    """

    def __init__(self, config: dict):
        super().__init__()
        model_cfg = config["model"]

        input_channels = model_cfg["input_channels"]
        hidden_dim = model_cfg["hidden_dim"]
        num_layers = model_cfg["num_layers"]
        dropout = model_cfg["dropout"]
        output_dim = model_cfg["output_dim"]

        # Temporal conv blocks: (batch, time, features) -> (batch, time, hidden)
        layers = []
        in_ch = input_channels
        for i in range(num_layers):
            out_ch = hidden_dim
            layers.extend([
                nn.Conv1d(in_ch, out_ch, kernel_size=3, padding=1),
                nn.BatchNorm1d(out_ch),
                nn.GELU(),
                nn.Dropout(dropout),
            ])
            in_ch = out_ch

        self.conv = nn.Sequential(*layers)

        # Global pooling + MLP head
        self.head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.Sigmoid(),  # Output in [0, 1] for lighting values
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: (batch, time_frames, feature_dim)

        Returns:
            (batch, output_dim) lighting state vector
        """
        # Conv1d expects (batch, channels, time)
        x = x.transpose(1, 2)
        x = self.conv(x)

        # Global average pooling over time
        x = x.mean(dim=2)

        return self.head(x)


class LSTMModel(nn.Module):
    """Bidirectional LSTM for temporal audio processing."""

    def __init__(self, config: dict):
        super().__init__()
        model_cfg = config["model"]

        input_dim = model_cfg["input_channels"]
        hidden_dim = model_cfg["hidden_dim"]
        num_layers = model_cfg["num_layers"]
        dropout = model_cfg["dropout"]
        output_dim = model_cfg["output_dim"]

        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=True,
            dropout=dropout if num_layers > 1 else 0,
        )

        self.head = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: (batch, time_frames, feature_dim)

        Returns:
            (batch, output_dim) lighting state vector
        """
        output, _ = self.lstm(x)
        # Use the last timestep
        x = output[:, -1, :]
        return self.head(x)


class StreamingGRU(nn.Module):
    """Streaming GRU with persistent hidden state for temporal context.

    Architecture:
        - Conv1d frame encoder (same as TemporalCNN backbone)
        - Unidirectional GRU that carries hidden state across inference calls
        - Three output heads: energy (current), future (multi-horizon), gate (silence detection)
    """

    def __init__(self, config: dict):
        super().__init__()
        model_cfg = config["model"]

        input_channels = model_cfg["input_channels"]
        hidden_dim = model_cfg["hidden_dim"]
        num_layers = model_cfg["num_layers"]
        dropout = model_cfg["dropout"]
        output_dim = model_cfg["output_dim"]
        gru_layers = model_cfg.get("gru_layers", 2)
        self.n_future = model_cfg.get("n_future", 4)
        self.hidden_dim = hidden_dim
        self.gru_layers = gru_layers
        self.output_dim = output_dim

        # Frame encoder: Conv1d stack (same architecture as TemporalCNN, no global pool)
        conv_layers = []
        in_ch = input_channels
        for i in range(num_layers):
            out_ch = hidden_dim
            conv_layers.extend([
                nn.Conv1d(in_ch, out_ch, kernel_size=3, padding=1),
                nn.BatchNorm1d(out_ch),
                nn.GELU(),
                nn.Dropout(dropout),
            ])
            in_ch = out_ch
        self.frame_encoder = nn.Sequential(*conv_layers)

        # GRU: processes encoded frames sequentially
        self.gru = nn.GRU(
            input_size=hidden_dim,
            hidden_size=hidden_dim,
            num_layers=gru_layers,
            batch_first=True,
            dropout=dropout if gru_layers > 1 else 0,
        )

        # Energy head: current stem energies
        self.energy_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.Sigmoid(),
        )

        # Future head: predict energies at n_future horizons
        self.future_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, self.n_future * output_dim),
            nn.Sigmoid(),
        )

        # Gate head: music vs silence probability
        self.gate_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Linear(hidden_dim // 2, 1),
            nn.Sigmoid(),
        )

        # Persistent hidden state for streaming inference
        self._hidden: torch.Tensor | None = None

    def encode_frames(self, x: torch.Tensor) -> torch.Tensor:
        """Encode audio features through Conv1d stack with global pool per window.

        Args:
            x: (batch, time_frames, feature_dim) — single window features

        Returns:
            (batch, hidden_dim) — one vector per window
        """
        # Conv1d expects (batch, channels, time)
        x = x.transpose(1, 2)
        x = self.frame_encoder(x)
        # Global average pool over time → (batch, hidden_dim)
        return x.mean(dim=2)

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """Training forward pass over a sequence of windows.

        Args:
            x: (batch, seq_len, time_frames, feature_dim)

        Returns:
            dict with keys:
                energy: (batch, seq_len, output_dim)
                future: (batch, seq_len, n_future, output_dim)
                gate: (batch, seq_len, 1)
        """
        batch, seq_len, time_frames, feat_dim = x.shape

        # Encode each window: reshape to (batch * seq_len, time_frames, feat_dim)
        x_flat = x.reshape(batch * seq_len, time_frames, feat_dim)
        encoded = self.encode_frames(x_flat)  # (batch * seq_len, hidden_dim)
        encoded = encoded.reshape(batch, seq_len, self.hidden_dim)

        # GRU over sequence (h0 = zeros)
        gru_out, _ = self.gru(encoded)  # (batch, seq_len, hidden_dim)

        # Heads applied to each timestep
        energy = self.energy_head(gru_out)  # (batch, seq_len, output_dim)
        future_flat = self.future_head(gru_out)  # (batch, seq_len, n_future * output_dim)
        future = future_flat.reshape(batch, seq_len, self.n_future, self.output_dim)
        gate = self.gate_head(gru_out)  # (batch, seq_len, 1)

        return {"energy": energy, "future": future, "gate": gate}

    def predict_step(self, x: torch.Tensor, device: torch.device | None = None
                     ) -> dict[str, torch.Tensor]:
        """Single-step streaming inference with persistent hidden state.

        Args:
            x: (1, time_frames, feature_dim) — one window of features

        Returns:
            dict with keys:
                energy: (output_dim,) current predictions
                future: (n_future, output_dim) future predictions
                gate: scalar gate value
        """
        if device is None:
            device = next(self.parameters()).device

        # Encode single window → (1, hidden_dim)
        encoded = self.encode_frames(x)
        # Add seq dim → (1, 1, hidden_dim)
        encoded = encoded.unsqueeze(1)

        # GRU step with persistent hidden state
        if self._hidden is not None:
            self._hidden = self._hidden.to(device)
        gru_out, self._hidden = self.gru(encoded, self._hidden)

        # Squeeze seq dim → (1, hidden_dim)
        h = gru_out.squeeze(1)

        energy = self.energy_head(h).squeeze(0)  # (output_dim,)
        future_flat = self.future_head(h).squeeze(0)  # (n_future * output_dim,)
        future = future_flat.reshape(self.n_future, self.output_dim)
        gate = self.gate_head(h).squeeze()  # scalar

        return {"energy": energy, "future": future, "gate": gate}

    def reset_hidden(self):
        """Reset GRU hidden state (e.g., on song transition)."""
        self._hidden = None


def build_model(config: dict) -> nn.Module:
    """Factory function to build model from config."""
    model_type = config["model"]["type"]
    if model_type == "temporal_cnn":
        return TemporalCNN(config)
    elif model_type == "lstm":
        return LSTMModel(config)
    elif model_type == "streaming_gru":
        return StreamingGRU(config)
    else:
        raise ValueError(f"Unknown model type: {model_type}")
