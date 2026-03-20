"""Real-time inference loop: capture -> features -> model -> router -> DMX.

Main loop runs at 30fps:
  1. Capture audio window from ring buffer
  2. Extract v1's 143-dim features (~3ms)
  3. Append BPM + beat_phase + section feedback -> 151-dim input
  4. Model inference (~5ms MPS, ~10ms CPU)
  5. Route protocol vector to fixture grid
  6. Send grid to DMX + preview
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import torch
import yaml

V1_DIR = Path(__file__).resolve().parent.parent.parent / "v1" / "model"
if str(V1_DIR) not in sys.path:
    sys.path.insert(0, str(V1_DIR))

from src.features import AudioFeatureExtractor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from model.model import build_model
from model.protocol import (
    PROTOCOL_DIM, NUM_SECTIONS, Slice, SECTION_LABELS,
    bpm_to_normalized, normalized_to_bpm,
)
from intelligence.bpm_tracker import BPMTracker
from intelligence.section_tracker import SectionTracker
from router.titan_tubes import TitanTubeRouter
from runtime.audio_capture import AudioCapture
from runtime.output import DMXOutput
from runtime.preview import PreviewWindow


class InferenceEngine:
    """Real-time inference pipeline."""

    def __init__(
        self,
        checkpoint_path: str,
        config: dict | None = None,
        dmx_method: str = "dummy",
        sacn_ip: str | None = None,
        usb_port: str | None = None,
        audio_device: int | str | None = None,
        no_preview: bool = False,
        fps: int = 30,
    ):
        self.fps = fps
        self.no_preview = no_preview

        # Load config from checkpoint if not provided
        if config is None:
            ckpt = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
            config = ckpt["config"]
        self.config = config

        # Device
        self.device = torch.device(
            "mps" if torch.backends.mps.is_available()
            else "cuda" if torch.cuda.is_available()
            else "cpu"
        )

        # Load model
        self.model = build_model(config).to(self.device)
        ckpt = torch.load(checkpoint_path, map_location=self.device, weights_only=False)
        self.model.load_state_dict(ckpt["model_state_dict"])
        self.model.eval()
        print(f"Model loaded from {checkpoint_path} (device: {self.device})")

        # Feature extractor (v1)
        audio_cfg = config["audio"]
        self.feature_extractor = AudioFeatureExtractor(config)
        self.sample_rate = audio_cfg["sample_rate"]
        self.window_samples = int(audio_cfg["window_seconds"] * self.sample_rate)

        # Audio capture
        self.capture = AudioCapture(
            sample_rate=self.sample_rate,
            buffer_seconds=10.0,
            device=audio_device,
        )

        # Intelligence
        self.bpm_tracker = BPMTracker(sample_rate=self.sample_rate)
        self.section_tracker = SectionTracker()

        # Router
        self.router = TitanTubeRouter()

        # Output
        self.dmx = DMXOutput(
            method=dmx_method,
            sacn_ip=sacn_ip,
            usb_port=usb_port,
        )

        # Preview
        self.preview = None if no_preview else PreviewWindow()

        # State
        self._prev_section_feedback = np.zeros(NUM_SECTIONS, dtype=np.float32)
        self._current_bpm = 120.0
        self._current_beat_phase = 0.0

    def run(self):
        """Run the real-time inference loop. Blocks until stopped."""
        print(f"\nStarting real-time inference at {self.fps}fps")
        print(f"  Audio device: {self.capture.device or 'default'}")
        print(f"  DMX: {self.dmx._method}")
        print(f"  Press ESC to quit\n")

        self.capture.start()
        self.dmx.open()
        if self.preview:
            self.preview.open()

        frame_interval = 1.0 / self.fps
        start_time = time.time()

        try:
            while True:
                t0 = time.time()
                elapsed = t0 - start_time

                # 1. Capture audio window
                audio_window = self.capture.get_window(self.window_samples)

                # 2. Extract features (~3ms)
                t_feat = time.time()
                features = self.feature_extractor.extract_fast(audio_window)
                feature_vec = self.feature_extractor.concat_features(features)
                feature_vec = feature_vec.mean(axis=0)  # global pool -> (143,)
                feat_ms = (time.time() - t_feat) * 1000

                # 3. Update BPM tracker
                self.bpm_tracker.update(audio_window)
                bpm = self.bpm_tracker.bpm
                if bpm > 0:
                    self._current_bpm = bpm
                self._current_beat_phase = (elapsed * self._current_bpm / 60.0) % 1.0

                # 4. Build 151-dim input
                input_vec = np.zeros(self.config["model"]["input_channels"], dtype=np.float32)
                input_vec[:143] = feature_vec
                input_vec[143] = bpm_to_normalized(self._current_bpm)
                input_vec[144] = self._current_beat_phase
                input_vec[145:151] = self._prev_section_feedback

                # 5. Model inference
                t_model = time.time()
                with torch.no_grad():
                    x = torch.from_numpy(input_vec).float().to(self.device)
                    x = x.unsqueeze(0).unsqueeze(0)  # (1, 1, 151)
                    outputs = self.model.predict_step(x, self.device)
                model_ms = (time.time() - t_model) * 1000

                # 6. Assemble protocol vector
                protocol = self.model.assemble_protocol_vector(outputs)
                protocol_np = protocol.cpu().numpy()

                # Update section feedback for next frame
                section_probs = outputs["section_probs"].cpu().numpy()
                self.section_tracker.update(section_probs)
                self._prev_section_feedback = self.section_tracker.smoothed_probs

                section_label = SECTION_LABELS[self.section_tracker.current_section]
                gate = float(outputs["gate"].cpu())

                # 7. Route to grid
                dt = frame_interval
                grid = self.router.route(protocol_np, elapsed, dt)

                # 8. Output
                total_ms = (time.time() - t0) * 1000
                self.dmx.send_grid(grid)

                if self.preview:
                    if not self.preview.update(
                        grid,
                        section=section_label,
                        bpm=self._current_bpm,
                        latency_ms=total_ms,
                        protocol=protocol_np,
                        gate=gate,
                    ):
                        break

                # Frame rate control
                frame_time = time.time() - t0
                sleep_time = frame_interval - frame_time
                if sleep_time > 0:
                    time.sleep(sleep_time)

        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            self.capture.stop()
            self.dmx.close()
            if self.preview:
                self.preview.close()
            self.model.reset_hidden()

        print("Inference stopped.")
