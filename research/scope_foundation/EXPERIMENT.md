# Causal scope foundation, experiment 1

Goal authority: ../../docs/TRAINING_GOAL.md. No RPMC-L2 data or checkpoints.

This experiment supplies the missing stereo-preserving live path and tests one
learned ingredient of anticipation. It does not claim to learn human lighting
judgment from audio alone. Personalization is out of scope.

## Contract fixed before training

At 50 Hz, eight causal observations from trailing 20 ms windows: amplitude
(1-exp(-6*stereo RMS)), covariance minor/major axis ratio (spread), normalized
XY sample step (texture), right-minus-left energy balance, low-pass 180 Hz
energy fraction, high-pass 2.5 kHz energy fraction, positive amplitude difference
scaled by four (attack), and L/R correlation. Values are 0–1 except balance and
correlation (-1–1). Quiet windows suppress unstable normalized descriptors.
The simple filter fractions are descriptors, not separated instruments.

Input lags: 0, 1, 2, 4, 8, 16, 25, 50, 100 frames. Exactly 2 s of causal history.
Forecast targets: amplitude, spread, texture, attack at +100 ms and +260 ms.
Targets are computed audio descriptors, not human cues or observed fixture
outputs. No missing target imputation. Exclude endpoints without full history
and horizon. Whole-source scaling is prohibited; normalization fitted on train.

Fresh small MLP: 72 → 64 → 32 → 8, ReLU hidden and sigmoid outputs.
Compare persistence, training-set mean, and wrong-history predictions. Select
checkpoint on a later Ultra Miami validation interval separated by a 10 s gap.
Electric Forest and three existing demo songs remain held-out evaluation.
Different shows can share tracks: track-disjoint generalization is UNVERIFIED.

## Rendering and interpretation

Left: fixed-gain stereo XY scope, equal axes, trailing 20 ms, no persistence.
Right: direct four-signal adapter or experimental forecast-assisted adapter.
Intensity uses amplitude plus a small transient accent; spread and texture
remain distinct. Color uses a fixed bass/air mapping. Forecast-assisted mode
allows a bounded preparatory intensity lift only if that forecast channel beats
persistence on validation. This adapter is procedural, not learned human taste.
A single screen consumes intensity/color; an eight-zone strip additionally
uses spread, texture and balance. Fixture-specific DMX adaptation remains next.

Do not smooth away the immediate signal path to make a forecast look better.
Compare identical audio and mappings. Report held-out channel errors, attack
false positives/misses, forecast variation, and causality checks. Better MSE
alone does not justify promoting this to the final director.

## Timing and live input

Preserve stereo. Mono microphone input legitimately has no stereo spread;
never manufacture a stereo measurement. Shared JS DSP avoids train/live formula
drift. Mic and browser display audio are initiated only by user gestures. Stop
all tracks on stop, cancellation, errors, and ended capture.

Timestamp every frame with its final PCM sample in the AudioContext clock.
Report sample-to-draw scheduling separately from model compute time. For file
playback use AudioContext.getOutputTimestamp to align with estimated audible
output. These clocks cannot establish physical mic-to-photon latency without
external measurement. Browser display-audio availability depends on the chosen
source, browser and OS; reject streams without audio with an actionable message.

API references:
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
- https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp
- https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame

## Storage

Heavy artifacts and feature tables go in a new exclusive run directory under
/Volumes/ExtremePro/Code/lightflow/research/scope_foundation/. All outputs use
exclusive creation. Existing external files are never overwritten or deleted.
Local active-run.json is a small pointer to the selected external run.
