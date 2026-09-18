# Spectrogram variation study

2026-09-16. User preferred the spectrogram in the first signal study and requested
variations in timing, metric, dimensions, and sensitivity.

Output: `/Volumes/ExtremePro/Movies/Exports/lightflow_spectrogram_variations_9-16-26/`

Thirty seconds of Of The Trees Ultra Miami 2026, source 10:00–10:30, synchronized
across nine views. Full-show audio stays on ExtremePro. No existing drive files
were deleted or overwritten.

- Row 1: 0.75, 4, and 12 second histories, otherwise identical settings.
- Row 2: +0, +12, and +24 dB display gain, with the same 4 second history and
  fixed -78..0 dB color scale. Panels 02 and 05 intentionally repeat the baseline.
- Row 3: positive spectral change, linear frequency spacing, and radial layout.

All use trailing 4096-sample Hann windows, 48 kHz stereo, 30 updates/sec, 192 bands
from 40 Hz to 16 kHz. Stereo power is averaged before amplitude conversion to
avoid cancellation. Log frequency is used except in panel 08. Radial frequency
increases outward; newest time is at the top, proceeding clockwise toward older
history. These are procedural studies, not trained-model outputs or human cue
labels. Low-frequency interpolation cannot recover detail below FFT resolution.

Verification: 1920x1080, 900 video frames, 30 seconds, audio stream present, preview
inspected. High sensitivity clips about 7.35% of underlying spectrogram cells
versus 0.23% at medium and 0% at low across this excerpt. This quantifies display
saturation, not audio clipping. The manifest on the drive records exact mappings,
provenance, checksum, and probe results. No subjective winner is established.

Before deriving training targets, read `docs/TRAINING_GOAL.md`. Preserve numeric
measurements alongside rendered colors: display gain, history length, and layout
must not silently redefine target semantics. No model training has been run.
