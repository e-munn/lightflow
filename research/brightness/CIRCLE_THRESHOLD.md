# Circular threshold experiment

User direction: put a circular threshold around the stereo scope; test cutting or changing the response inside, expansion/compression outside, and a dynamic threshold or dynamics strength. This supplies a concrete next experiment after the earlier missing-target impasse. It does not establish that the new projection is musically preferable or complete the model goal.

Demo: http://localhost:3001/scope/threshold

## What is being tested

The original fixed 256×256 stereo raster is preserved. Its illuminated pixels are weighted by distance from the center. The circle is drawn only on a separate display canvas, so its own pixels cannot enter the brightness measurement. Original and candidate use equal-size uniform gray displays, the same source frame, and the same final soft brightness curve. The audio itself is unchanged. Each is an alternative value for the same single output channel.

Inside choices: unchanged, gradual downward weighting, or a hard cut. Outside choices: unchanged, attenuation of larger excursions, or emphasis of larger excursions. These are visual dynamics inspired by expansion/compression, not a dB-domain audio compressor, and the circle is not a frequency band or instrument detector. Small central movement can be musically meaningful; radius alone does not identify noise.

For pixel radius r and threshold T, with strength R in [1,4]: gradual inside weight is (r/T)^(R−1); outside compression weight is (r/T)^(1/R−1); outside expansion weight is min(4,(r/T)^(R−1)). Unchanged weight is 1; cut-inside weight is 0. Sum weighted illuminated pixels, then use the existing bounded soft brightness curve. Defaults: T=.35 half-widths, inside gradual, outside unchanged, R=2, fixed circle, attack/release zero, output gain 1.

Adaptive mode slowly tracks the radius containing 60% of current trace light, using an exponential time constant (default 3 seconds). The current frame uses the estimate from preceding frames; only afterward does this frame update the tracker. The tracker freezes on a black raster and resets on stop, stale data, source/config change, invalid input or timestamp discontinuity. Adaptation can suppress long builds or reveal weak detail depending on the passage; that is a hypothesis to compare, not automatically a benefit.

Attack and release optionally smooth the final scalar, with zero defaults to retain immediate detail. Digital silence/stop clears output immediately even with a nonzero release. This is not yet a calibrated room-noise gate. Strength remains fixed initially: simultaneous adaptation of radius and strength would obscure which change helps. A learned controller for these parameters is a possible later experiment only after an expressive benefit is established.

## Comparison sequence

1. Use one repeatable passage containing sharp attacks, sustained texture, a quiet section and a release. Start at defaults; change only circle size. The original scope remains visible.
2. Compare gradual inside reduction with a hard cut while keeping outside unchanged. Reject settings that erase meaningful quiet details or stay dark through a sustained musical part.
3. Use “Match average brightness,” which fits one constant exposure multiplier to the preceding five seconds and freezes it. Replay the same audio and judge articulation rather than overall intensity. Recalibrate after changing the spatial response; the UI resets gain on those changes. Calibration bounds or all-dark candidates can prevent a full match and are reported. With response smoothing enabled, matching the unsmoothed mean is approximate. It is a control, not a proof against every brightness-related perceptual bias.
4. Keep the selected static response fixed and enable slow adaptation (3 seconds initially). Compare whether quieter sections regain detail without the threshold chasing attacks or cancelling builds. Test faster tracking only if a specific failure calls for it.
5. Then vary outside response or release one at a time. Dynamic strength is deferred until a fixed-strength benefit is evident.
6. Replay the favored settings on unfamiliar electronic music, separately through stereo and mono input, before using the projection or controller as a training target. Current Forest passage is development material, not an unfamiliar final test.

The page records “Clearer detail,” “Lost detail,” and “No meaningful difference” as five-second reaction windows with source identity, approximate source time and exact settings. “Export trial” retains the marks and recent samples as `lightflow-circle-trial.json`. Marks otherwise last only this page visit. This experimental export is distinct from the earlier baseline's validated server intake. Automated trials are explicitly flagged and are not human preferences or numeric training labels. No raw microphone/system audio is recorded.

## Verification

- `node research/brightness/test_threshold.mjs`: bypass identity, independent below/above effects, threshold monotonicity, bounded response, prior-context adaptation, silence/gap/invalid reset, identical-prefix determinism and fixed mean matching.
- `npx tsc --noEmit`: passed.
- `node research/brightness/threshold_browser_test.mjs <fresh-external-directory>`: runs an isolated muted Chrome session. Validates exact bypass agreement with the original raster; distinct responses to the same synthetic stereo signal; actual Forest playback with nonidentical outputs; fixed-gain calibration; source-linked automated export; moving circle; stop blackout; mobile overflow and browser errors.
- Evidence: `/Volumes/ExtremePro/Code/lightflow/research/brightness_threshold_ui_v1/`. Desktop screenshot inspected. Measured p95 raster-plus-threshold compute .60 ms on one synthetic browser run. This excludes real physical capture/display latency and is not musical evaluation.

No prior SanDisk artifact was overwritten or deleted. The original baseline and saved models remain available. No new model has been trained or promoted by this experiment.

Terminology references: [FabFilter dynamics modes](https://www.fabfilter.com/help/pro-mb/using/basicbandcontrols), [Web Audio compressor](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode).
