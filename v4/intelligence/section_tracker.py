"""Section tracking state machine with hysteresis.

Smooths the model's section predictions and enforces transition
constraints to prevent rapid section switching.

Transition rules:
  - Minimum 15 frames (~0.5s) before allowing section change
  - Transition requires sustained confidence > threshold
  - Valid transitions: intro->verse, verse->buildup, buildup->drop,
    drop->breakdown, breakdown->buildup, breakdown->verse, any->outro
"""

from __future__ import annotations

import numpy as np

from model.protocol import SECTION_LABELS, NUM_SECTIONS

# Valid section transitions (from -> allowed_to)
VALID_TRANSITIONS: dict[str, set[str]] = {
    "intro": {"verse", "buildup", "drop"},
    "verse": {"buildup", "breakdown", "drop", "outro"},
    "buildup": {"drop", "verse"},
    "drop": {"breakdown", "verse", "outro"},
    "breakdown": {"buildup", "verse", "drop", "outro"},
    "outro": set(),  # outro is terminal
}


class SectionTracker:
    """State machine for section tracking with hysteresis.

    Smooths model section predictions and prevents rapid switching.
    """

    def __init__(
        self,
        min_hold_frames: int = 15,
        transition_threshold: float = 0.6,
        smoothing_alpha: float = 0.15,
    ):
        self.min_hold_frames = min_hold_frames
        self.transition_threshold = transition_threshold
        self.smoothing_alpha = smoothing_alpha

        self._current_section = 0  # index into SECTION_LABELS
        self._frames_in_section = 0
        self._smoothed_probs = np.zeros(NUM_SECTIONS, dtype=np.float32)
        self._smoothed_probs[0] = 1.0  # start as intro

    @property
    def current_section(self) -> int:
        """Current section index."""
        return self._current_section

    @property
    def current_label(self) -> str:
        """Current section label string."""
        return SECTION_LABELS[self._current_section]

    @property
    def smoothed_probs(self) -> np.ndarray:
        """Smoothed section probability vector (6,)."""
        return self._smoothed_probs.copy()

    def update(self, raw_probs: np.ndarray):
        """Update with new section predictions from model.

        Args:
            raw_probs: (6,) softmax probabilities from section head
        """
        # EMA smoothing
        self._smoothed_probs = (
            (1 - self.smoothing_alpha) * self._smoothed_probs +
            self.smoothing_alpha * raw_probs
        )

        self._frames_in_section += 1

        # Check for transition
        if self._frames_in_section < self.min_hold_frames:
            return

        candidate = int(np.argmax(self._smoothed_probs))
        if candidate == self._current_section:
            return

        # Check confidence threshold
        if self._smoothed_probs[candidate] < self.transition_threshold:
            return

        # Check valid transition
        current_label = SECTION_LABELS[self._current_section]
        candidate_label = SECTION_LABELS[candidate]

        if candidate_label in VALID_TRANSITIONS.get(current_label, set()):
            self._current_section = candidate
            self._frames_in_section = 0

    def reset(self):
        """Reset to initial state."""
        self._current_section = 0
        self._frames_in_section = 0
        self._smoothed_probs = np.zeros(NUM_SECTIONS, dtype=np.float32)
        self._smoothed_probs[0] = 1.0

    def force_section(self, label: str):
        """Force a specific section (e.g., from song ID alignment)."""
        if label in SECTION_LABELS:
            self._current_section = SECTION_LABELS.index(label)
            self._frames_in_section = 0
            self._smoothed_probs = np.zeros(NUM_SECTIONS, dtype=np.float32)
            self._smoothed_probs[self._current_section] = 1.0
