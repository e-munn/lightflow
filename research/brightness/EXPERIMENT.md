# Single-channel scope experiment — 2026-09-17

The current user goal is a musically useful learned brightness signal, not spatial fixture control. No model is promoted by this protocol alone.

## Fixed candidate reference

`public/scope-brightness.mjs` is shared between browser and dataset extraction. A trailing 20 ms stereo waveform is drawn into a 256-square canvas with fixed XY gain 1.5, unit 112.64, white line width 1 and black background. Coverage is mean RGB code value / 255; brightness is `1-exp(-40*coverage)`. No excerpt normalization or temporal smoothing. Alpha/raster engine affect the measurement; browser build and renderer are recorded. The live scope shows this exact measured raster. Mono remains mono. Silence must yield zero, nonfinite input must fail closed, and clipping is reported.

Coverage is a hypothesis: it loses position/orientation and can saturate. Establish response to equal-volume changes in stereo geometry and waveform complexity, quantify saturation and mono behavior, and seek listening evidence before calling it a good target. The user has not yet approved it.

## Conditional learned experiment

Learn 40, 100 and 260 ms future scalar coverage brightness from past scope descriptors and brightness history. Rich inputs are retained; each forecast horizon predicts the same scalar, not separate output channels. These are self-supervised scope targets, not lighting-engineer labels or proof of phrase understanding. A forecast is not automatically connected to the output.

Train: ALLEYCVT, GRiZ and Ravenscoon, source intervals 600–720 and 1800–1920. Validate: Levity 900–1020. Evaluate: Forest 600–720 and 3000–3120. All are whole-show separated by the existing corpus split. Forest is a development transfer test previously studied elsewhere, not an untouched final music test. Cross-show track overlap is unknown. Stereo PCM decoded at 48 kHz. Ten seconds of prefix may initialize filter/history; training examples start inside named windows. Do not use video pixels as training targets here.

Freeze split and target before training. Compare persistence, training mean, linear temporal predictor and wrong-history controls. Report amplitude-only ablation to test whether richer inputs matter. Report change preservation, transient precision/recall, flat-output collapse, per-clip results and confidence intervals over multi-second blocks. MSE improvement alone is insufficient. Never turn down the direct scope response merely to make forecasts look smooth.

Live promotion requires useful audible/visible improvement with the same display, not merely smaller prediction error. Physical timing remains a separate unmet measurement requirement. Existing live software timing tools and stop/stale blackout must be preserved.
