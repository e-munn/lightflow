# Wide-shot light behavior pilot

Read ../../docs/TRAINING_GOAL.md and VISUAL_SIGNAL_RESEARCH.md before training.
Goal remains causal, musically intelligent light direction with the scope's
fine response; this experiment is a learned component, not a redefinition.

## Data and splits

Candidate train shows: Ravenscoon, ALLEYCVT, GRiZ Electric Forest recordings.
Validation: Levity Electric Forest. Test: Of The Trees Electric Forest, keeping
both alternate recordings together. Jack White remains an exploratory rock
comparison, not training. Fresh weights; no rejected editorial checkpoint or
RPMC-L2 data/weights. Track reuse across DJ sets is not yet fully resolved.
Before admitting observations, inspect per-source masks and source/target replays.
Keep video-derived appearance distinct from recovered physical fixture commands.

## Representation under comparison

Compare on identical frames and boxes:
1. Existing brightest-2%-pixel RGB (sensitive to small lights, but clips and
   can give a tiny point the same brightness as a broad illuminated region).
2. Area-aware mean RGB with a fixed display gain (retains amount of lit area).
3. Area-aware intensity plus color estimated only from sufficiently bright,
   unsaturated pixels, with explicit missing-color/confidence flags.

Choose from visibility and preservation evidence, not held-out model scores.
Keep raw means, quantiles, coverage, clipping and image-coordinate masks so
the choice is reproducible. A brighter-looking replay is not automatically a
better target. No unconditional frame-by-frame gain normalization or arbitrary
hue reconstruction. Screens and stage-light regions stay separately attributed.

Selected pilot channels: four regional peak luminances (99th percentile, 0–1),
four lit-area fractions (luminance > .1, 0–1), four regional energies
(1-exp(-6*mean luminance), 0–1), and global RGB chromaticity (three nonnegative
values summing to one). Keep the 15 channels separate: tiny bright accents and
broad washes must not collapse into one value. Pixels are gamma-encoded observed
RGB, not physical radiance. Change/hold behavior uses valid adjacent observations.
Geometry failure masks all channels; insufficient unclipped color masks only
chromaticity. Missing color is not a white target. The global color summarizes
valid regions, not the whole rig's palette; moving beams and screen content
remain mixed appearance evidence.

The common preview maps energy to each region's background brightness, peak to
a narrow accent bar, coverage to its width, and chromaticity to RGB hue. A single
browser screen can consume mean energy and chromaticity. A conceptual DMX adapter
maps energy to group dimmers and chromaticity to RGB; coverage can choose how
many fixtures participate and peak can drive a separate accent group. These are
appearance controls, not calibrated pan/tilt/DMX values.

## Fresh baseline run, specified before results

Use causal mean/max pooling of 24 audio features over each past 100 ms (48 inputs).
Eight scope features plus eight stereo band powers and eight positive band-power
changes; these bands are not isolated instruments. Pair a window ending at t with
video at t, never with the earlier video frame. No source audio substitution.
Predict current recorded appearance first; do not call this verified anticipation.
Train normalization uses only training shows. Each clip has independent history.
Discard the first 25.4 seconds from losses and evaluation for DSP/model warmup.

Fresh seven-layer causal TCN, width 32, dilations 1..64, 25.5-second context,
sigmoid for the first 12 channels and softmax for chromaticity. Train 50 epochs;
select checkpoint on validation only. Loss and checkpoint score: mean of the
four masked channel-group squared errors plus 0.2 times their adjacent-change
errors. No test-set tuning. Compare with train mean, amplitude polynomial ridge,
instantaneous 48-feature ridge, and the scope-derived procedural signal mapped
into the same display contract. Ridge regularization chosen on validation only.

Report per-clip and held-out pooled errors, within-clip correlation, variation
and frame-change ratios, 17-second wrong-history control, and fixed +/-0.2,
0.5,1-second evaluation shifts. Shifts are diagnostic, never applied to improve
the deployed model. Paired 60-second block bootstrap intervals are descriptive
within this one test performance, not population-level uncertainty. Check prefix
causality and chunk/whole parity. Save same-renderer comparisons regardless of
whether this baseline succeeds. A regression that collapses to an average or
fails meaningful audio conditioning is not promoted to the live prototype.

## Timing and quality

Retain video observations at 10 Hz for this pilot and source media at original
rate. The immediate scope path stays at 50 Hz. Audience recordings may include
acoustic delay and source A/V offsets, so precise predictive timing cannot be
claimed from their uncorrected timestamps. First test broad observed behavior
and delay sensitivity; preserve exact fast accents through the direct path.
This is an intermediate component toward the full timing goal, not a substitute
for measuring capture-to-light latency and evaluating unfamiliar songs.

Compare fresh learned output with train mean, current-amplitude regression,
direct scope mapping and mismatched audio. Report variation, transitions,
holds, clipping/coverage, temporal offsets and missing-label rates alongside
numeric fit. Same-renderer playable comparisons and human assessment are required
before claiming an improvement in musical judgment. Current pixel-preview user
feedback is positive but lacks a comparator; do not treat it as model evaluation.
