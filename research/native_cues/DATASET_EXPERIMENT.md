# Native-frame observation dataset and predictive comparison

Read docs/TRAINING_GOAL.md and docs/VISUAL_SIGNAL_RESEARCH.md before fitting.
This extends the ten-span measurement pilot to the same fourteen accepted
four-minute clips. All earlier files remain immutable. No RPMC-L2 is used.

## Observation extension, specified before extraction

Keep exact source PTS and verify every frame against ffprobe. Hold the existing
registration transforms on that clock and reuse its geometry/jump exclusions;
this does not improve tracking. Never substitute missing observations with a
blackout label. Do not resample or smooth away repeated flashes.

Use the previously proposed disjoint GRiZ/Ravenscoon light-field and screen
masks in registered reference coordinates. Other shows retain their candidate
light-field regions. Their screen namespace is unavailable, with false validity,
not an observed dark screen. Keep peak, coverage, fixed energy mapping, chroma,
raw luma, clipping and color support. The fields remain partial scene appearance.

Review nine fixed source/mask samples per clip, spread from +1 to +239 seconds,
before admission. Record uncertain or rejected clips explicitly. Existing short
source/measurement replays supplement these stills but do not amount to continuous
review of all fourteen clips. Mask drift, exposure changes and remaining screen
spill are limitations even if samples pass. No physical desk-command labels.

## Planned forecast contract, fixed before fitting

Four probability outputs in [0,1] at 10 Hz:

1. At least one strong observed light-field brightening edge in (now+.1, now+.3].
2. At least one strong observed light-field dimming edge in (now+.1, now+.3].
3. At least one strong observed light-field brightening edge in (now+.3, now+1.0].
4. At least one strong observed light-field dimming edge in (now+.3, now+1.0].

An edge means >=.25 signed change in the four-region mean mapped energy between
consecutive source frames <=50 ms apart. These probabilities concern recorded
appearance, not desired calibrated intensity or the exact physical switch time.
Use every native edge, including consecutive strobes; no 300 ms suppression.
The horizon's complete native support must have valid geometry and no missing
frames for either positive or negative admission. Require the frame preceding
its lower bound and one at/after the upper bound to verify coverage. A possible
.12–.25 edge masks a negative; a strong edge proves the positive if geometry is
known throughout. Preserve clipping separately: clipped absence of edges is not
a physical hold. Slower one-second contrast stays a separate stored descriptor;
do not train a hold/build head without a reviewed definition.

These outputs could prepare an accent/release envelope shared by browser dimmer
and DMX dimmer adapters. The predicted interval is not a precise scheduling
command. This experiment will only show probability traces unless a later
explicit policy earns validation; the immediate 20 ms scope remains unchanged.

## Model and evaluation

Use causal 50 Hz audio features pooled by trailing five-frame blocks, causal
relative-band context and rhythm features, as in the previous 81-input model.
No video state, source identity or future audio in the model input. Fresh weights:
24-wide, seven-layer causal dilated TCN, 25.5 s context. Train 50 epochs using
masked binary cross entropy; select on equal-clip mean validation Brier score.
Retain training prior, amplitude-only, tempo/phase and current causal-context
logistic controls. Train each control up to 200 steps and select on validation.
Use a 17 s wrong-history shift as a diagnostic, never as a deployed causal path.

Existing artist/show groups stay fixed: ALLEYCVT, GRiZ and accepted Ravenscoon
clips train; Levity Forest validates; Of The Trees Forest evaluates development
transfer. Both Forest recordings share a group. Repeated prior inspection means
Forest is no longer an untouched test, even where old metadata says test.
Jack White and unused performances remain outside fitting.

Report per-head Brier, average precision, target/prediction prevalence, per-clip
results, and 60 s block-bootstrap error differences versus controls. Blocks are
within a single Forest performance, not independent-show confidence. Verify
unchanged-prefix causality, full-versus-chunk inference and exact horizon cases.
No live promotion from scalar metrics. Render the same fixed Forest passage with
source observations, scope, direct lights and separate near/far probability
traces. Human musical-quality review and physical input-to-photon timing remain
outstanding parts of the full goal.
