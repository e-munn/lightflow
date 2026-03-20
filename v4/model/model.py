"""Extended StreamingGRU for LightFlow v4.

Takes 151-dim input (143 audio features + 1 BPM + 1 beat_phase + 6 section feedback)
and outputs a 64-dim protocol vector through multiple heads:
  - protocol head: main 35-dim output (stems, onsets, spatial, motion, texture, color, dynamics)
  - section head: 6-class section classification
  - bpm head: 3-dim BPM info (beat_phase, bar_phase, normalized_bpm)
  - gate head: music vs silence
  - future head: 20-dim prediction at +100ms
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .protocol import PROTOCOL_DIM, FUTURE_DIM, NUM_SECTIONS, Slice


# Protocol head outputs dims [0:35] (stems + onsets + spatial + motion + texture + color + dynamics)
PROTOCOL_HEAD_DIM = Slice.SECTION  # 35


class LightFlowGRU(nn.Module):
    """Extended StreamingGRU with multi-head output to protocol vector.

    Architecture:
        - Conv1d frame encoder
        - 3-layer unidirectional GRU with persistent hidden state
        - Five output heads: protocol, section, bpm, gate, future
    """

    def __init__(self, config: dict):
        super().__init__()
        model_cfg = config["model"]

        input_dim = model_cfg["input_channels"]     # 151
        hidden_dim = model_cfg["hidden_dim"]         # 256
        num_conv_layers = model_cfg["num_layers"]    # 4
        gru_layers = model_cfg.get("gru_layers", 3)
        dropout = model_cfg["dropout"]

        self.hidden_dim = hidden_dim
        self.gru_layers = gru_layers

        # Frame encoder: Conv1d stack
        conv_layers = []
        in_ch = input_dim
        for _ in range(num_conv_layers):
            conv_layers.extend([
                nn.Conv1d(in_ch, hidden_dim, kernel_size=3, padding=1),
                nn.BatchNorm1d(hidden_dim),
                nn.GELU(),
                nn.Dropout(dropout),
            ])
            in_ch = hidden_dim
        self.frame_encoder = nn.Sequential(*conv_layers)

        # GRU
        self.gru = nn.GRU(
            input_size=hidden_dim,
            hidden_size=hidden_dim,
            num_layers=gru_layers,
            batch_first=True,
            dropout=dropout if gru_layers > 1 else 0,
        )

        # Protocol head: stems [0:6] + onsets [6:9] + spatial [9:17] +
        #                motion [17:21] + texture [21:27] + color [27:31] + dynamics [31:35]
        self.protocol_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, PROTOCOL_HEAD_DIM),
            nn.Sigmoid(),
        )

        # Section head: 6-class classification
        self.section_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim // 2, NUM_SECTIONS),
            # No activation — raw logits for CrossEntropyLoss, softmax at inference
        )

        # BPM head: beat_phase, bar_phase, normalized_bpm
        self.bpm_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 4),
            nn.GELU(),
            nn.Linear(hidden_dim // 4, 3),
            nn.Sigmoid(),
        )

        # Gate head: music vs silence
        self.gate_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim // 4),
            nn.GELU(),
            nn.Linear(hidden_dim // 4, 1),
            nn.Sigmoid(),
        )

        # Future head: predict +100ms (20-dim subset of protocol)
        self.future_head = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, FUTURE_DIM),
            nn.Sigmoid(),
        )

        # Persistent hidden state for streaming inference
        self._hidden: torch.Tensor | None = None

    def encode_frames(self, x: torch.Tensor) -> torch.Tensor:
        """Encode audio features through Conv1d stack with global pool.

        Args:
            x: (batch, time_frames, feature_dim)
        Returns:
            (batch, hidden_dim)
        """
        x = x.transpose(1, 2)  # (batch, feature_dim, time_frames)
        x = self.frame_encoder(x)
        return x.mean(dim=2)   # global average pool

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        """Training forward pass over a sequence.

        Args:
            x: (batch, seq_len, time_frames, feature_dim)
               For pre-pooled features: time_frames=1

        Returns:
            dict with:
                protocol: (batch, seq_len, 35)
                section_logits: (batch, seq_len, 6)
                bpm: (batch, seq_len, 3)
                gate: (batch, seq_len, 1)
                future: (batch, seq_len, 20)
        """
        batch, seq_len, time_frames, feat_dim = x.shape

        # Encode each window
        x_flat = x.reshape(batch * seq_len, time_frames, feat_dim)
        encoded = self.encode_frames(x_flat)
        encoded = encoded.reshape(batch, seq_len, self.hidden_dim)

        # GRU over sequence
        gru_out, _ = self.gru(encoded)

        return {
            "protocol": self.protocol_head(gru_out),
            "section_logits": self.section_head(gru_out),
            "bpm": self.bpm_head(gru_out),
            "gate": self.gate_head(gru_out),
            "future": self.future_head(gru_out),
        }

    def predict_step(self, x: torch.Tensor, device: torch.device | None = None
                     ) -> dict[str, torch.Tensor]:
        """Single-step streaming inference with persistent hidden state.

        Args:
            x: (1, time_frames, feature_dim) — one window of features

        Returns:
            dict with:
                protocol: (35,) continuous values
                section_probs: (6,) softmax probabilities
                bpm: (3,) beat_phase, bar_phase, normalized_bpm
                gate: scalar
                future: (20,) future prediction
        """
        if device is None:
            device = next(self.parameters()).device

        encoded = self.encode_frames(x)       # (1, hidden_dim)
        encoded = encoded.unsqueeze(1)        # (1, 1, hidden_dim)

        if self._hidden is not None:
            self._hidden = self._hidden.to(device)
        gru_out, self._hidden = self.gru(encoded, self._hidden)

        h = gru_out.squeeze(1)  # (1, hidden_dim)

        protocol = self.protocol_head(h).squeeze(0)
        section_logits = self.section_head(h).squeeze(0)
        section_probs = torch.softmax(section_logits, dim=0)
        bpm = self.bpm_head(h).squeeze(0)
        gate = self.gate_head(h).squeeze()
        future = self.future_head(h).squeeze(0)

        return {
            "protocol": protocol,
            "section_probs": section_probs,
            "bpm": bpm,
            "gate": gate,
            "future": future,
        }

    def assemble_protocol_vector(self, outputs: dict[str, torch.Tensor]) -> torch.Tensor:
        """Assemble full 64-dim protocol vector from head outputs.

        Works for both single-step (no batch dim) and batch outputs.
        """
        protocol = outputs["protocol"]           # [..., 35]
        section = outputs.get("section_probs")
        if section is None:
            section = torch.softmax(outputs["section_logits"], dim=-1)
        bpm = outputs["bpm"]                      # [..., 3]
        future = outputs["future"]                # [..., 20]

        return torch.cat([protocol, section, bpm, future], dim=-1)

    def reset_hidden(self):
        """Reset GRU hidden state (e.g., on song transition)."""
        self._hidden = None


def build_model(config: dict) -> LightFlowGRU:
    """Build model from config."""
    return LightFlowGRU(config)
