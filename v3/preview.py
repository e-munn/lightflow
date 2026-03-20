"""Pygame preview window for the 8x16 Titan Tube grid.

Features: glow rendering, clickable timeline with section markers,
transport controls (pause/seek), header + status bars.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
import pygame

from effects import STEM_NAMES, LiveInput
from schemas import NUM_TUBES, PIXELS_PER_TUBE

if TYPE_CHECKING:
    from schemas import ShowPlan

# Key-to-stem mapping: number keys 1-6
_KEY_STEM_MAP = {
    pygame.K_1: "bass",
    pygame.K_2: "kick",
    pygame.K_3: "snare",
    pygame.K_4: "hat",
    pygame.K_5: "vocals",
    pygame.K_6: "other",
}


class PreviewWindow:
    """Renders an 8x16 pixel grid with glow, timeline, and transport controls.

    Layout mirrors physical Titan Tubes:
    - 8 columns (tubes), 16 rows (pixels per tube)
    - Pixel (0,0) = top-left
    """

    # Grid pixel dimensions
    PIXEL_W = 40
    PIXEL_H = 24
    GAP_X = 12     # gap between tubes
    GAP_Y = 1      # subtle gap between pixels within a tube
    CORNER_R = 6
    MARGIN = 40

    # Layout vertical spacing
    HEADER_H = 50      # song name + section label
    TIMELINE_H = 24
    TIMELINE_GAP = 16  # gap between grid and timeline
    STATUS_H = 20
    HINT_H = 16
    BOTTOM_PAD = 12

    # Colors
    BG = (20, 20, 25)
    TIMELINE_BG = (35, 35, 40)
    TIMELINE_FILL = (45, 90, 140)
    TIMELINE_HEAD = (255, 255, 255)
    DIM_CYAN = (80, 180, 200)
    DIM_GRAY = (100, 100, 110)
    WHITE = (220, 220, 220)

    # Glow settings
    GLOW_THRESHOLD = 0.15
    GLOW_EXPAND = 3  # px larger on each side

    def __init__(self, title: str = "LightFlow v3",
                 show: ShowPlan | None = None,
                 duration: float = 0.0):
        self.title = title
        self.show = show
        self.duration = duration

        self._screen: pygame.Surface | None = None
        self._glow_surface: pygame.Surface | None = None
        self._clock = None
        self._fonts: dict[int, pygame.font.Font] = {}
        self._running = False
        self._pending_actions: list[dict] = []

        # Computed layout positions (set in open())
        self._grid_y = 0
        self._timeline_rect = pygame.Rect(0, 0, 0, 0)

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
        return (self.MARGIN  # top margin
                + self.HEADER_H
                + self.grid_height
                + self.TIMELINE_GAP
                + self.TIMELINE_H
                + 20  # section labels below timeline
                + self.STATUS_H
                + self.HINT_H
                + self.BOTTOM_PAD)

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

        # Pre-create glow surface (SRCALPHA for per-pixel alpha)
        self._glow_surface = pygame.Surface(
            (self.grid_width + self.GLOW_EXPAND * 2,
             self.grid_height + self.GLOW_EXPAND * 2),
            pygame.SRCALPHA,
        )

        # Compute layout y-positions
        self._grid_y = self.MARGIN + self.HEADER_H
        tl_y = self._grid_y + self.grid_height + self.TIMELINE_GAP
        self._timeline_rect = pygame.Rect(
            self.MARGIN, tl_y, self.grid_width, self.TIMELINE_H
        )

    def drain_actions(self) -> list[dict]:
        """Return and clear pending transport actions."""
        actions = self._pending_actions
        self._pending_actions = []
        return actions

    def _handle_events(self, live: LiveInput | None):
        """Process pygame events. Populates live state and queues transport actions."""
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                self._running = False
                return
            if event.type == pygame.KEYDOWN and event.key == pygame.K_ESCAPE:
                self._running = False
                return

            # Transport controls
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_SPACE:
                    self._pending_actions.append({"type": "toggle_pause"})
                elif event.key == pygame.K_LEFT:
                    self._pending_actions.append({"type": "seek_relative", "delta": -5.0})
                elif event.key == pygame.K_RIGHT:
                    self._pending_actions.append({"type": "seek_relative", "delta": 5.0})

            # Timeline click
            if event.type == pygame.MOUSEBUTTONDOWN and event.button == 1:
                if self._timeline_rect.collidepoint(event.pos):
                    frac = (event.pos[0] - self._timeline_rect.x) / self._timeline_rect.width
                    frac = max(0.0, min(1.0, frac))
                    self._pending_actions.append({
                        "type": "seek_absolute",
                        "time": frac * self.duration,
                    })

            # Live controls (stem boosts, one-shots, blackout)
            if live is not None:
                if event.type == pygame.KEYDOWN:
                    if event.key in _KEY_STEM_MAP:
                        live.stem_boosts[_KEY_STEM_MAP[event.key]] = True
                    elif event.key == pygame.K_7:
                        live.flash_remaining = 0.15
                    elif event.key == pygame.K_8:
                        live.strobe_remaining = 0.5
                    elif event.key == pygame.K_9:
                        live.color_burst_remaining = 0.4
                    elif event.key == pygame.K_0:
                        live.blackout_held = True
                elif event.type == pygame.KEYUP:
                    if event.key in _KEY_STEM_MAP:
                        live.stem_boosts[_KEY_STEM_MAP[event.key]] = False
                    elif event.key == pygame.K_0:
                        live.blackout_held = False

    def _draw_header(self, time_s: float, section: str):
        """Draw song name + BPM header and current section label."""
        font14 = self._font(14)
        font11 = self._font(11)

        # Song name + BPM
        bpm_str = f" — {int(self.show.bpm)} BPM" if self.show else ""
        song_name = self.show.song if self.show else ""
        title_surf = font14.render(f"{song_name}{bpm_str}", True, self.WHITE)
        self._screen.blit(title_surf, (self.MARGIN, self.MARGIN))

        # Section label
        if section:
            sec_surf = font11.render(section.upper(), True, self.DIM_CYAN)
            self._screen.blit(sec_surf, (self.MARGIN, self.MARGIN + 24))

    def _draw_grid(self, grid: np.ndarray):
        """Draw the 8x16 pixel grid with rounded tube ends."""
        last_row = PIXELS_PER_TUBE - 1
        cr = self.CORNER_R
        gy = self._grid_y

        for col in range(NUM_TUBES):
            x = self.MARGIN + col * (self.PIXEL_W + self.GAP_X)
            for row in range(PIXELS_PER_TUBE):
                y = gy + row * (self.PIXEL_H + self.GAP_Y)
                r = int(np.clip(grid[row, col, 0], 0, 1) * 255)
                g = int(np.clip(grid[row, col, 1], 0, 1) * 255)
                b = int(np.clip(grid[row, col, 2], 0, 1) * 255)
                color = (r, g, b)
                rect = (x, y, self.PIXEL_W, self.PIXEL_H)
                if row == 0:
                    pygame.draw.rect(self._screen, color, rect,
                                     border_top_left_radius=cr,
                                     border_top_right_radius=cr)
                elif row == last_row:
                    pygame.draw.rect(self._screen, color, rect,
                                     border_bottom_left_radius=cr,
                                     border_bottom_right_radius=cr)
                else:
                    pygame.draw.rect(self._screen, color, rect)

    def _draw_glow(self, grid: np.ndarray):
        """Draw soft glow halos around bright pixels."""
        self._glow_surface.fill((0, 0, 0, 0))
        exp = self.GLOW_EXPAND
        gy = self._grid_y

        for col in range(NUM_TUBES):
            gx = col * (self.PIXEL_W + self.GAP_X)
            for row in range(PIXELS_PER_TUBE):
                brightness = float(np.max(grid[row, col]))
                if brightness < self.GLOW_THRESHOLD:
                    continue
                r = int(np.clip(grid[row, col, 0], 0, 1) * 255)
                g = int(np.clip(grid[row, col, 1], 0, 1) * 255)
                b = int(np.clip(grid[row, col, 2], 0, 1) * 255)
                alpha = int(min(brightness * 120, 100))
                ry = row * (self.PIXEL_H + self.GAP_Y)
                glow_rect = (gx + exp - exp, ry + exp - exp,
                             self.PIXEL_W + exp * 2, self.PIXEL_H + exp * 2)
                pygame.draw.rect(self._glow_surface, (r, g, b, alpha), glow_rect,
                                 border_radius=exp + 2)

        # Blit with additive blending
        self._screen.blit(
            self._glow_surface,
            (self.MARGIN - exp, gy - exp),
            special_flags=pygame.BLEND_RGB_ADD,
        )

    def _draw_timeline(self, time_s: float):
        """Draw the timeline bar with playhead and section markers."""
        rect = self._timeline_rect
        font9 = self._font(9)

        # Background
        pygame.draw.rect(self._screen, self.TIMELINE_BG, rect, border_radius=4)

        if self.duration <= 0:
            return

        frac = min(time_s / self.duration, 1.0)

        # Elapsed fill
        fill_w = int(rect.width * frac)
        if fill_w > 0:
            fill_rect = pygame.Rect(rect.x, rect.y, fill_w, rect.height)
            pygame.draw.rect(self._screen, self.TIMELINE_FILL, fill_rect, border_radius=4)

        # Section boundary ticks + labels
        if self.show:
            for sp in self.show.sections:
                sx = rect.x + int((sp.start / self.duration) * rect.width)
                # Tick mark
                pygame.draw.line(self._screen, (80, 80, 90),
                                 (sx, rect.y), (sx, rect.y + rect.height))
                # Label below timeline
                label = font9.render(sp.section_label.lower(), True, self.DIM_GRAY)
                # Center label on section span
                sec_mid = rect.x + int(((sp.start + sp.end) / 2 / self.duration) * rect.width)
                lx = sec_mid - label.get_width() // 2
                lx = max(rect.x, min(lx, rect.x + rect.width - label.get_width()))
                self._screen.blit(label, (lx, rect.y + rect.height + 3))

        # Playhead line
        head_x = rect.x + int(rect.width * frac)
        pygame.draw.line(self._screen, self.TIMELINE_HEAD,
                         (head_x, rect.y - 2), (head_x, rect.y + rect.height + 2), 2)

    def _draw_status(self, time_s: float, section: str, live: LiveInput | None,
                     paused: bool):
        """Draw time, boost indicators, and hint text."""
        font11 = self._font(11)
        font9 = self._font(9)

        # Status y-position: below timeline + section labels
        status_y = self._timeline_rect.y + self.TIMELINE_H + 22

        # Time display
        m_cur, s_cur = divmod(int(time_s), 60)
        m_tot, s_tot = divmod(int(self.duration), 60)
        status = f"{m_cur}:{s_cur:02d} / {m_tot}:{s_tot:02d}"

        if paused:
            status += "  PAUSED"

        # Live control indicators
        if live is not None:
            boosted = [name.upper() for name in STEM_NAMES if live.stem_boosts.get(name)]
            if boosted:
                status += f"  BOOST: [{' '.join(boosted)}]"
            if live.flash_remaining > 0:
                status += "  *FLASH*"
            if live.strobe_remaining > 0:
                status += "  *STROBE*"
            if live.color_burst_remaining > 0:
                status += "  *BURST*"
            if live.blackout_held:
                status += "  [BLACKOUT]"

        text = font11.render(status, True, (180, 180, 180))
        self._screen.blit(text, (self.MARGIN, status_y))

        # Hint line
        hint = "SPACE:play/pause  \u2190/\u2192:\u00b15s  click:seek  1-6:boost  7:flash  8:strobe  9:burst  0:blackout"
        hint_surf = font9.render(hint, True, self.DIM_GRAY)
        self._screen.blit(hint_surf, (self.MARGIN, status_y + self.STATUS_H))

    def update(self, grid: np.ndarray, time_s: float = 0.0, section: str = "",
               live: LiveInput | None = None, paused: bool = False):
        """Draw the full UI. grid shape: (16, 8, 3) float 0-1.

        Returns False if window was closed.
        """
        if not self._running:
            return False

        self._handle_events(live)
        if not self._running:
            return False

        self._screen.fill(self.BG)

        self._draw_header(time_s, section)
        self._draw_glow(grid)
        self._draw_grid(grid)
        self._draw_timeline(time_s)
        self._draw_status(time_s, section, live, paused)

        pygame.display.flip()
        return True

    @property
    def running(self) -> bool:
        return self._running

    def close(self):
        self._running = False
        pygame.quit()
