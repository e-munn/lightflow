# Corrected direction: stereo scope

2026-09-16: The user clarified that the preferred view was the stereo scope,
not the spectrogram. The earlier spectrogram study remains an exploratory
artifact and must not be interpreted as the user's selected visual direction.

The corrected study uses the same Of The Trees Ultra Miami 2026 excerpt,
10:00–10:30, with nine synchronized views:

1. Baseline: left/right, 20 ms window, 1.5x gain.
2. Short window: 5 ms.
3. Long window: 80 ms.
4. Low sensitivity: 0.5x gain.
5. High sensitivity: 3x gain.
6. Short persistence: 120 ms exponential decay.
7. Long persistence: 400 ms exponential decay.
8. Mid/side: X=(L-R)/2; Y=(L+R)/2.
9. Delayed mono: X=mono now; Y=mono 1 ms earlier. This is not a stereo meter.

Only the named setting changes from baseline. All PCM samples in each trailing
window are drawn, with equal coordinate scaling and fixed gain. There is no
per-frame normalization. Brightness persistence is max-composited with an
exponentially decaying prior trace. At high gain the trace can leave the plot.

Heavy outputs are under
`/Volumes/ExtremePro/Movies/Exports/lightflow_stereo_scope_variations_9-16-26/`.
Existing drive content is never deleted or overwritten. Source audio remains
in the project's Assets/audio folder on ExtremePro.

These are procedural NumPy/Pillow renders, encoded with FFmpeg; they are not
TouchDesigner exports or trained-model outputs. Before treating generated
examples as training supervision, read `docs/TRAINING_GOAL.md` and retain the
mapping settings and procedural provenance alongside numeric signals.
