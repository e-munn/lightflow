# Frozen music-feature cue comparison

Read the canonical TRAINING_GOAL and VISUAL_SIGNAL_RESEARCH before training.
The previous turn made progress: corrected cue labels, a tested event model,
timing/tracking diagnostics, and a feasible past-only music encoder. The full
live director goal remains unmet; this experiment compares input representations.

## Contract and split

Use the reviewed `light_events/labels_v2` rise/release probabilities for an
observed event within +0.2 to +1.0 seconds. No hold head: its current supervision
is inadequate. Outputs are probabilities, not direct dimmer commands. A later
stateful policy would turn reliable cues into accents/releases while preserving
the fast scope signal, using the same intensity controls for browser or DMX.

Same eight train clips (Ravenscoon/ALLEYCVT/GRiZ), three validation clips (Levity
Forest), and three development-test clips (Of The Trees Forest). Both Forest
recordings remain grouped. The test is repeatedly inspected development data;
a fresh performance and track-overlap audit remain necessary for final claims.
No RPMC-L2. Keep MERT frozen; fit fresh small lighting heads only.

## Availability and comparison

MERT windows contain only the preceding five seconds of left-channel audio,
resampled/normalized after slicing. Each window's feature becomes available only
after its recorded processing cost, with a conservative minimum 100 ms allowance.
Simulate a serial inference worker; any backlog delays subsequent availability.
At each 10 Hz prediction tick use the last completed feature, never a future
interpolation. Mask periods before the first available feature. Keep the same
25.4-second warmup and labels for all compared heads.

Fit feature standardization and a 64-component randomized PCA using only unique
training-source MERT windows after warmup. No validation/test observations enter
PCA or normalization. Standardize PCA coordinates and handcrafted features on
training only. Three logistic heads with identical fitting protocol:

1. Signal: existing 81 causal signal/context/rhythm inputs.
2. Music: 64 frozen MERT PCA coordinates held until their successors arrive.
3. Hybrid: both input groups, 145 features.

Use zero weights and train-prior bias at initialization; 200 full-batch Adam
updates per regularization setting. L2 candidates 0.0001, 0.01, 1.0; select epoch
and L2 only on equal-clip mean validation Brier. This is a frozen representation
probe, not a claim that a linear head is the final director architecture.

Primary comparison: hybrid versus signal, prior, and 17-second wrong-history
hybrid. Report all three heads, per-clip and pooled AP, Brier, and paired 60-second
block error intervals. Use the existing validation-only trigger selection: >=65%
precision with >=10 scorable triggers, otherwise abstain. Report unknown-label
triggers separately; missing labels cannot make false-trigger counts look perfect.
Use fixed 250 ms feature-availability sensitivity without refitting. Verify
availability prefix behavior and endpoint inequalities. Musical quality and
physical timing remain separate required evaluations.

Do not modify the live prototype merely because a probability metric improves.
Make a playable diagnostic on the fixed Forest 31:00–32:00 segment after fitting;
show source, fine direct response and learned predictions honestly. If the learned
trigger policy abstains, show probabilities as diagnostics, not invented cues.
