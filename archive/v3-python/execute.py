"""Show executor: syncs audio playback with frame rendering.

Plays the audio file via sounddevice and renders effects at 30fps,
driving both the pygame preview and DMX output.
"""

from __future__ import annotations

import math
import time

import numpy as np
import sounddevice as sd
import soundfile as sf

from dmx import DMXOutput
from effects import EffectContext, LiveInput, apply_glow, render_section_frame, reset_smoothing
from preview import PreviewWindow
from schemas import (
    NUM_TUBES, PIXELS_PER_TUBE,
    AnalysisResult, ShowPlan, StemFrame, TransitionType,
)


class ShowExecutor:
    """Plays audio and renders the show plan in real-time."""

    def __init__(
        self,
        analysis: AnalysisResult,
        show: ShowPlan,
        audio_path: str | None = None,
        dmx_port: str | None = None,
        no_dmx: bool = False,
        fps: int = 30,
        visual_offset: float = -0.05,
    ):
        self.analysis = analysis
        self.show = show
        self.audio_path = audio_path
        self.fps = fps
        self.visual_offset = visual_offset  # seconds, negative = delay visual

        self.preview = PreviewWindow(
            title=f"LightFlow v3 — {show.song}",
            show=show,
            duration=analysis.duration,
        )

        self.dmx = None
        if not no_dmx:
            self.dmx = DMXOutput(port=dmx_port)

        # Pre-index frames by time for fast lookup
        self._frame_times = np.array([f.time for f in analysis.frames])

        # Live keyboard input state
        self.live = LiveInput()

        # Audio data (loaded on run)
        self._audio_data: np.ndarray | None = None
        self._audio_sr: int | None = None
        self._audio_device: int | None = None  # pin output device

        # Playback state
        self._paused: bool = False
        self._playback_offset: float = 0.0  # logical time when paused/seeked
        self._wall_ref: float = 0.0  # wall clock reference

    def _current_time(self) -> float:
        """Get current logical playback time."""
        if self._paused:
            return self._playback_offset
        return self._playback_offset + (time.time() - self._wall_ref)

    def _seek_to(self, target: float):
        """Seek to a specific time. Restarts audio from that point."""
        target = max(0.0, min(target, self.analysis.duration - 0.1))
        self._playback_offset = target
        self._wall_ref = time.time()
        reset_smoothing()

        # Restart audio from new position
        if self._audio_data is not None:
            sd.stop()
            sample_offset = int(target * self._audio_sr)
            sample_offset = min(sample_offset, len(self._audio_data) - 1)
            if not self._paused:
                sd.play(self._audio_data[sample_offset:], self._audio_sr,
                        device=self._audio_device)

    def _toggle_pause(self):
        """Toggle pause/resume."""
        if self._paused:
            # Resume
            self._paused = False
            self._wall_ref = time.time()
            if self._audio_data is not None:
                sample_offset = int(self._playback_offset * self._audio_sr)
                sample_offset = min(sample_offset, len(self._audio_data) - 1)
                sd.play(self._audio_data[sample_offset:], self._audio_sr,
                        device=self._audio_device)
        else:
            # Pause
            self._playback_offset = self._current_time()
            self._paused = True
            if self._audio_data is not None:
                sd.stop()

    def _process_actions(self):
        """Drain and process pending actions from the preview window."""
        for action in self.preview.drain_actions():
            kind = action.get("type")
            if kind == "toggle_pause":
                self._toggle_pause()
            elif kind == "seek_relative":
                self._seek_to(self._current_time() + action["delta"])
            elif kind == "seek_absolute":
                self._seek_to(action["time"])

    def _get_frame_at(self, t: float) -> StemFrame:
        """Look up full StemFrame at time t via nearest frame."""
        idx = np.searchsorted(self._frame_times, t)
        idx = min(idx, len(self.analysis.frames) - 1)
        return self.analysis.frames[idx]

    def _get_section_at(self, t: float) -> int | None:
        """Find which show section index contains time t."""
        for i, sp in enumerate(self.show.sections):
            if sp.start <= t < sp.end:
                return i
        return None

    def _get_section_color(self, section_idx: int | None):
        """Get the primary color from the first effect of the current section."""
        if section_idx is None:
            return None
        section = self.show.sections[section_idx]
        if section.effects:
            return section.effects[0].color
        return None

    def _render_frame(self, t: float, dt: float) -> tuple[np.ndarray, str]:
        """Render the composite frame at time t. Returns (grid, section_label)."""
        # Decay one-shot timers
        self.live.tick(dt)

        frame = self._get_frame_at(t)
        ctx = EffectContext(frame=frame, time=t, bpm=self.show.bpm, dt=dt,
                            live=self.live)

        section_idx = self._get_section_at(t)
        if section_idx is None:
            return np.zeros((PIXELS_PER_TUBE, NUM_TUBES, 3), dtype=np.float32), ""

        section = self.show.sections[section_idx]

        # Render current section's effects
        grid = render_section_frame(section.effects, ctx)

        # Handle crossfade transitions
        if section.transition_in == TransitionType.CROSSFADE and section.transition_duration > 0:
            elapsed = t - section.start
            if elapsed < section.transition_duration and section_idx > 0:
                prev_section = self.show.sections[section_idx - 1]
                fade = elapsed / section.transition_duration  # 0->1
                prev_grid = render_section_frame(prev_section.effects, ctx)
                grid = prev_grid * (1 - fade) + grid * fade

        # Glow post-processing: subtle pixel bleed
        grid = apply_glow(grid, amount=0.3)

        # --- One-shot overlays (post-composite) ---

        # Blackout: highest priority, zeros everything
        if self.live.blackout_held:
            grid[:] = 0.0
            return np.clip(grid, 0, 1), section.section_label

        # White flash: additive, linear decay
        if self.live.flash_remaining > 0:
            flash_intensity = self.live.flash_remaining / 0.15  # 1.0 -> 0.0
            grid += flash_intensity

        # Strobe burst: 20Hz toggle with fade tail
        if self.live.strobe_remaining > 0:
            strobe_phase = int(t * 20) % 2  # 20Hz on/off
            fade = self.live.strobe_remaining / 0.5
            if strobe_phase:
                grid += fade

        # Color burst: expanding ring from center, section's primary color
        if self.live.color_burst_remaining > 0:
            color = self._get_section_color(section_idx)
            if color:
                progress = 1.0 - (self.live.color_burst_remaining / 0.4)  # 0->1
                radius = progress * max(NUM_TUBES, PIXELS_PER_TUBE) * 0.7
                intensity = self.live.color_burst_remaining / 0.4
                cx, cy = NUM_TUBES / 2, PIXELS_PER_TUBE / 2
                ring_width = 2.5
                for row in range(PIXELS_PER_TUBE):
                    for col in range(NUM_TUBES):
                        dist = math.sqrt((col - cx) ** 2 + (row - cy) ** 2)
                        ring_val = max(0.0, 1.0 - abs(dist - radius) / ring_width)
                        val = ring_val * intensity
                        grid[row, col, 0] += val * color.r
                        grid[row, col, 1] += val * color.g
                        grid[row, col, 2] += val * color.b

        return np.clip(grid, 0, 1), section.section_label

    def _print_legend(self):
        """Print keyboard control legend."""
        print("  Live controls:")
        print("    1-6 (hold): Boost stem  1=bass 2=kick 3=snare 4=hat 5=vocals 6=other")
        print("    7   (tap):  White flash")
        print("    8   (tap):  Strobe burst")
        print("    9   (tap):  Color burst")
        print("    0   (hold): Blackout")
        print("    SPACE:      Play / Pause")
        print("    LEFT/RIGHT: Seek ±5s")
        print("    Click:      Seek on timeline")
        print("    ESC:        Quit")
        print()

    def run(self):
        """Run the show. Blocks until audio ends or window is closed."""
        print(f"\nStarting show: {self.show.song}")
        print(f"  Duration: {self.analysis.duration:.1f}s")
        print(f"  BPM: {self.show.bpm}")
        print(f"  Sections: {len(self.show.sections)}")
        print(f"  FPS: {self.fps}")
        print()
        self._print_legend()

        reset_smoothing()
        self.preview.open()

        if self.dmx:
            self.dmx.open()

        # Load and play audio
        if self.audio_path:
            self._audio_data, self._audio_sr = sf.read(self.audio_path, dtype="float32")
            self._audio_device = sd.default.device[1]  # pin current output device
            print(f"  Playing audio: {self.audio_path}")
            print(f"  Output device: {sd.query_devices(self._audio_device)['name']}")
            sd.play(self._audio_data, self._audio_sr, device=self._audio_device)

        frame_interval = 1.0 / self.fps
        self._wall_ref = time.time()
        self._playback_offset = 0.0
        self._paused = False
        prev_time = 0.0

        try:
            while True:
                frame_start = time.time()

                # Process transport actions (seek/pause) from preview
                self._process_actions()

                t = self._current_time()
                dt = t - prev_time
                # Clamp dt after seeks to prevent effect explosions
                dt = max(0.0, min(dt, 0.1))
                prev_time = t

                if t >= self.analysis.duration and not self._paused:
                    break

                # Apply visual offset: shift render time to compensate for audio latency
                render_t = t + self.visual_offset
                render_t = max(0.0, render_t)
                grid, section_label = self._render_frame(render_t, dt)

                # Use real t for timeline display
                if not self.preview.update(grid, t, section_label, live=self.live,
                                           paused=self._paused):
                    break  # Window closed

                # Send to DMX
                if self.dmx:
                    self.dmx.send_grid(grid)

                # Frame rate control
                elapsed = time.time() - frame_start
                sleep_time = frame_interval - elapsed
                if sleep_time > 0:
                    time.sleep(sleep_time)

        except KeyboardInterrupt:
            print("\nStopping...")
        finally:
            if self._audio_data is not None:
                sd.stop()
            if self.dmx:
                self.dmx.close()
            self.preview.close()

        print("Show complete.")
