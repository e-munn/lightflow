# Does the learned forecast carry useful timing?

The previous turn made progress by delivering and verifying streaming inference.
This audit examines why the trained candidate fails Forest before another fit.
It changes no weights, thresholds, source alignment or deployed behavior.

## Method

Read all fourteen saved original-audio predictions from `forecast_gain_v1`.
For each clip/head, score exactly the same valid interior target rows at each
prediction shift: -20, -17, -10, -5, -2, -1, -.5, -.2, 0, .2, .5, 1, 2, 5, 10,
17 and 20 seconds. No circular wrapping or cross-clip pairing. All prediction
rows have completed the original 25.5-second warm-up. Positive lag uses an older
prediction; negative lag uses future predictions for diagnosis only. Neither
is a proposed source correction or a causal runtime change.

Decompose Brier error exactly into target variance + squared mean bias +
prediction variance - twice covariance. `Centered gain` = twice covariance minus
prediction variance: the improvement over a hindsight per-clip constant if only
the prediction mean were corrected, without clipping. This oracle mean is not
available live and is not a proposed baseline for deployment. Averaging is
within each clip, then equally across heads/clips of a show, so between-clip
prevalence changes cannot masquerade as within-clip timing.

## Observations

| Show | Squared mean bias | Centered gain | Twice covariance at original timing | Twice covariance 17 s late |
|---|---:|---:|---:|---:|
| ALLEYCVT (training) | .00765 | .01488 | .03641 | -.00208 |
| GRiZ (training) | .00414 | .00988 | .02000 | -.00948 |
| Ravenscoon (training) | .00023 | .00675 | .00957 | .00507 |
| Levity (validation) | .00436 | .01031 | .01453 | -.00060 |
| Forest (development) | .10105 | -.00891 | -.00285 | .00297 |

Forest has a large average underprediction, but correcting only that average
would leave harmful fluctuations on this diagnostic support. All four heads
have negative equal-clip centered gain (-.00464, -.00567, -.01148, -.01388).
Their mean within-clip correlations are -.059, -.111, -.021 and -.075. This is
not just a constant gain/bias problem. The loudness control has small positive
centered gain for all four Forest heads (.00018–.00077).

Across the coarse lag grid, Forest's near heads have their largest covariance
at +17 seconds and far heads at -20 seconds. This inconsistent pattern does not
identify a common small AV delay to repair. It must not be used to select a
favorable lag on repeatedly inspected development data. Levity does have useful
within-clip association, but its head-specific peaks also vary: this analysis
does not establish precise anticipatory timing, causation or human quality.

These are descriptive statistics from three Forest and three Levity clips of
one performance each, with serial dependence and known geometry missingness.
No significance or population-generalization claim is made. Different lighting
choices, recording timbre/reverb, residual screen/exposure artifacts and label
semantics remain possible explanations. The audit does not distinguish them.

## Decision

Do not present sensitivity adjustment, output mean calibration or an AV shift
as a solution. Keep the existing candidate explicitly experimental. The next
controlled diagnostic can hold Forest video targets and weights fixed while
using the already matched alternate recording of the same performance. Refine
local content alignment using audio only, inspect its uncertainty, and keep
that uncertainty separate from unknown physical sound-to-light delay. This can
probe recording dependence without inventing new labels or fitting Forest.
Even a successful alternate-recording result would not prove microphone transfer
or better lighting; expressive output comparisons and human evaluation remain
required. Broader supervision for phrasing/holds is still absent.

## Reproduction and evidence

`python3 research/native_cues/timing_specificity.py --model /Volumes/ExtremePro/Code/lightflow/research/native_cues/forecast_gain_v1 --out <NEW_EXTERNAL_DIRECTORY>`

Evidence: `/Volumes/ExtremePro/Code/lightflow/research/native_cues/timing_specificity_v1/report.json`.
Contains all clip/head/method/lag results and input/code SHA256 values. The exact
Brier identity is asserted for every scored array. Perfect, inverted and
constant synthetic predictions passed independent expected-value checks.
No new media, training or SanDisk replacement/deletion occurred.
