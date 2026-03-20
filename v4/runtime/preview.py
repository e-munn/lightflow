"""Pygame preview window for v4 real-time pipeline.

Shows the 16x8 grid with protocol vector channel visualization,
BPM tracking, section display, and latency metrics.
"""

from __future__ import annotations

import numpy as np
import pygame

NUM_TUBES = 8
PIXELS_PER_TUBE = 16


class PreviewWindow:
    """Real-time preview with protocol vector overlay."""

    PIXEL_W = 40
    PIXEL_H = 24
    GAP_X = 12
    GAP_Y = 1
    CORNER_R = 6
    MARGIN = 40

    HEADER_H = 60
    PROTO_VIS_H = 80  # protocol vector visualization bar
    STATUS_H = 24
    BOTTOM_PAD = 12

    BG = (20, 20, 25)
    DIM_CYAN = (80, 180, 200)
    DIM_GRAY = (100, 100, 110)
    WHITE = (220, 220, 220)

    def __init__(self, title: str = "LightFlow v4"):
        self.title = title
        self._screen: pygame.Surface | None = None
        self._clock = None
        self._fonts: dict[int, pygame.font.Font] = {}
        self._running = False

    @property
    def grid_width(self) -> int:
        return NUM_TUBES * (self.PIXEL_W + self.GAP_X) - self.GAP_X

    @property
    def grid_height(self) -> int:
        return PIXELS_PER_TUBE * (self.PIXEL_H + self.GAP_Y) - self.GAP_Y

    @property
    def width(self) -> int:
        return self.MARGIN * 2 + self.grid_width

    @property
    def height(self) -> int:
        return (self.MARGIN + self.HEADER_H + self.grid_height +
                20 + self.PROTO_VIS_H + self.STATUS_H + self.BOTTOM_PAD)

    def _font(self, size: int) -> pygame.font.Font:
        if size not in self._fonts:
            self._fonts[size] = pygame.font.SysFont("menlo", size)
        return self._fonts[size]

    def open(self):
        pygame.init()
        self._screen = pygame.display.set_mode((self.width, self.height))
        pygame.display.set_caption(self.title)
        self._clock = pygame.time.Clock()
        self._running = True

    def _draw_grid(self, grid: np.ndarray):
        gy = self.MARGIN + self.HEADER_H
        last_row = PIXELS_PER_TUBE - 1
        cr = self.CORNER_R

        for col in range(NUM_TUBES):
            x = self.MARGIN + col * (self.PIXEL_W + self.GAP_X)
            for row in range(PIXELS_PER_TUBE):
                y = gy + row * (self.PIXEL_H + self.GAP_Y)
                r = int(np.clip(grid[row, col, 0], 0, 1) * 255)
                g = int(np.clip(grid[row, col, 1], 0, 1) * 255)
                b = int(np.clip(grid[row, col, 2], 0, 1) * 255)
                rect = (x, y, self.PIXEL_W, self.PIXEL_H)
                if row == 0:
                    pygame.draw.rect(self._screen, (r, g, b), rect,
                                     border_top_left_radius=cr,
                                     border_top_right_radius=cr)
                elif row == last_row:
                    pygame.draw.rect(self._screen, (r, g, b), rect,
                                     border_bottom_left_radius=cr,
                                     border_bottom_right_radius=cr)
                else:
                    pygame.draw.rect(self._screen, (r, g, b), rect)

    def _draw_protocol_bars(self, protocol: np.ndarray | None, y_start: int):
        """Draw protocol vector channels as colored bars."""
        if protocol is None:
            return

        bar_h = 6
        bar_gap = 2
        x0 = self.MARGIN

        # Groups to visualize with colors
        groups = [
            ("stems", slice(0, 6), (100, 200, 100)),
            ("onsets", slice(6, 9), (200, 150, 100)),
            ("spatial", slice(9, 17), (100, 150, 200)),
            ("motion", slice(17, 21), (200, 100, 200)),
            ("texture", slice(21, 27), (200, 200, 100)),
            ("dynamics", slice(31, 35), (200, 100, 100)),
        ]

        font9 = self._font(9)
        y = y_start

        for name, s, color in groups:
            values = protocol[s]
            label = font9.render(name[:6], True, self.DIM_GRAY)
            self._screen.blit(label, (x0, y))

            bar_x = x0 + 55
            max_w = self.grid_width - 55
            bar_w = max_w / len(values)

            for i, v in enumerate(values):
                bx = int(bar_x + i * bar_w)
                bw = max(1, int(bar_w) - 1)
                fill_h = int(v * bar_h)
                # Background
                pygame.draw.rect(self._screen, (40, 40, 45),
                                 (bx, y, bw, bar_h))
                # Fill
                if fill_h > 0:
                    pygame.draw.rect(self._screen, color,
                                     (bx, y + bar_h - fill_h, bw, fill_h))
            y += bar_h + bar_gap

    def update(
        self,
        grid: np.ndarray,
        section: str = "",
        bpm: float = 0.0,
        latency_ms: float = 0.0,
        protocol: np.ndarray | None = None,
        gate: float = 1.0,
    ) -> bool:
        """Update the preview. Returns False if window was closed."""
        if not self._running:
            return False

        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self._running = False
                return False
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                self._running = False
                return False

        self._screen.fill(self.BG)

        # Header
        font14 = self._font(14)
        font11 = self._font(11)

        bpm_str = f"{bpm:.0f} BPM" if bpm > 0 else "-- BPM"
        title = font14.render(f"LightFlow v4  |  {bpm_str}", True, self.WHITE)
        self._screen.blit(title, (self.MARGIN, self.MARGIN))

        if section:
            sec_surf = font11.render(section.upper(), True, self.DIM_CYAN)
            self._screen.blit(sec_surf, (self.MARGIN, self.MARGIN + 24))

        latency_color = (100, 200, 100) if latency_ms < 30 else (200, 200, 100) if latency_ms < 50 else (200, 100, 100)
        lat_surf = font11.render(f"{latency_ms:.1f}ms", True, latency_color)
        self._screen.blit(lat_surf, (self.width - self.MARGIN - lat_surf.get_width(), self.MARGIN))

        if gate < 0.5:
            gate_surf = font11.render("SILENCE", True, (200, 100, 100))
            self._screen.blit(gate_surf, (self.width - self.MARGIN - gate_surf.get_width(), self.MARGIN + 20))

        # Grid
        self._draw_grid(grid)

        # Protocol visualization
        proto_y = self.MARGIN + self.HEADER_H + self.grid_height + 16
        self._draw_protocol_bars(protocol, proto_y)

        # Status
        font9 = self._font(9)
        status_y = self.height - self.STATUS_H - self.BOTTOM_PAD
        hint = "ESC: quit"
        hint_surf = font9.render(hint, True, self.DIM_GRAY)
        self._screen.blit(hint_surf, (self.MARGIN, status_y))

        pygame.display.flip()
        return True

    def close(self):
        self._running = False
        pygame.quit()
