# Causal event forecasting, v1

Requirement: anticipate musical accents from received audio without weakening
immediate stereo-scope response. This experiment tests AUDIO EVENT prediction,
not learned human lighting choreography. No RPMC-L2 inputs or initialization.

Target definition fixed before training: local peaks of the existing positive
amplitude-rise descriptor, height ≥ .2, rise ≥ .08 over the preceding 80 ms
trough, separated by ≥80 ms (larger peaks retained when too close).
These are acoustic attack candidates, not verified kicks/snares or lighting cues.
Forecast whether an event will occur 80–120 ms after the last received sample.
Train with binary cross-entropy on a ±20 ms window around the 100 ms horizon.
For evaluation schedule threshold crossings at forecast time +100 ms with a
100 ms refractory period; match one-to-one within ±40 ms. Report precision,
recall, F1, timing error and false scheduled accents per minute. Thresholds are
selected on validation only. Wrong-history and repeating-rhythm comparators.

Model: fresh causal temporal convolution stack, seven kernel-3 layers with
16 channels, dilations 1–64 (255 frames / 5.1 s receptive field). Each layer
uses left padding only. Last linear projection outputs one onset logit. No
future window normalization, bidirectional processing or future beat estimates.
Input: the eight existing causal stereo-scope features. Scaling fit on train.

Split: first 70% of Ultra Miami trains, later Ultra after 10 s purge validates.
Forest and existing three demo tracks are held out from weight/threshold
selection but were previously inspected in the descriptor experiment. New
concert sources will provide fresh artist-separated tests later. Track-level
separation is not established for live-show uploads.

Training/evaluation chunks include 254 warmup frames whose outputs are ignored.
Runtime parity must compare whole sequences to a sample-by-sample causal replay.
Prefix invariance must hold with a changed future. Treat the new model as a
candidate until event quality AND rendered behavior improve. A failed model is
recorded rather than silently promoted to the app.
