"""Base router interface: protocol vector -> fixture commands.

Routers translate the ML model's 64-dim protocol vector into
specific fixture control commands (pixel grids, DMX channels, etc).
"""

from __future__ import annotations

from abc import ABC, abstractmethod

import numpy as np

from model.protocol import ProtocolVector, PROTOCOL_DIM


class Router(ABC):
    """Abstract base for fixture routers."""

    @abstractmethod
    def route(self, protocol: np.ndarray, time: float, dt: float) -> np.ndarray:
        """Convert a protocol vector to fixture output.

        Args:
            protocol: (64,) protocol vector
            time: current playback time in seconds
            dt: time since last frame

        Returns:
            Fixture-specific output array
        """
        ...

    @abstractmethod
    def reset(self):
        """Reset internal state (e.g., on song change)."""
        ...
