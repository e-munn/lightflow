# Training-only waveform recording perturbations

Read TRAINING_GOAL.md and the prior alternate-recording diagnostic before fitting.
Fresh 24-wide seven-layer causal TCN; same four native appearance-event heads,
81 features, horizons, missing-label masks and browser/DMX interpretation as
DATASET_EXPERIMENT.md and MODEL_RESULTS.md. These are weak cue probabilities,
not calibrated fixture commands, holds or completed musical direction.

For each of eight admitted training clips, retain original audio features and
add four waveform-derived versions at 48 kHz. Deterministic causal effects:

- dark_quiet: gain .5; mix .25 direct + .75 one-pole lowpass at 1800 Hz.
- thin_loud: gain 2; subtract one-pole lowpass at 120 Hz.
- room_short: .8 direct + .15 same-channel 37 ms echo + .05 cross-channel 53 ms echo.
- room_long: .7 direct + .2 cross-channel 83 ms echo + .1 same-channel 131 ms echo.

One-pole coefficient 1-exp(-2*pi*cutoff/sampleRate). Zero initial state at clip
start; 25.5-second model warm-up excludes startup from scoring. No zero-phase
filter, lookahead normalization, clipping, source time warp or label shift.
Echoes retain direct arrival. These are synthetic recording variations, not
validated measurements of venues or a claim to cover arbitrary microphones.
All 24 scope/music features are recalculated from altered waveforms, then 81
causal features are rebuilt. Stereo breadth and transient shapes may change.

Original plus four variants yields 40 training sequences, matching the number
and optimizer batches of the earlier five-gain experiment. Same seed, 50 epochs,
original Levity validation selecting epoch; fit normalizers on training only.
No validation, Forest, alternate Forest or Jack White audio enters fitting.
All fourteen original clips remain the evaluation set, not augmented variants.
Evaluate alternate Forest with its previously fixed audio-only alignment after
model selection, without selecting weights on either Forest recording.

Promotion still requires simple-control and wrong-history comparisons, rendered
musical review and physical timing. No automatic browser model replacement.
Heavy outputs use new SanDisk directories; no existing artifacts replaced.
