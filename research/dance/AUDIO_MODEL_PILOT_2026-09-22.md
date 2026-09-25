# Dance-supervised audio model: completed first experiment

**Two models were trained and run from audio alone. Neither learned transferable
lighting timing in this pilot. Do not promote either over the stereoscope.**

[Open the audio model study](http://localhost:3001/pipeline/model) in Dia. It
supports held-out excerpts, local audio uploads, microphone input and
screen-filling brightness fields. The stereo-scope file comparison is unchanged.
Microphone processing was checked with synthetic browser capture, not physical
microphone-to-light hardware. System-audio capture and Hue/DMX are not implemented
in this experiment.

## Completed work

- Eight new videos downloaded from the creators' YouTube channels. One additional
  download returned HTTP 403; its metadata/log remain on SanDisk.
- Eleven new extraction runs: 397 seconds and 13,790 decoded frames, including
  fresh passages selected to avoid edits and ambiguous detections.
- Source contact sheets and exact-frame skeleton samples inspected, including
  difficult frames. Reviews remain **sampled**, not full-span identity, anatomical
  accuracy or source A/V certification.
- Seven song groups retained: four training, one validation, two test. There are
  170.08 usable seconds across all splits after masks and audio warmup.
- Two causal audio models, trained RMS-only and constant controls, delayed-audio
  tests and wrong-song tests completed. All heavy artifacts are on SanDisk.
- No existing SanDisk files deleted or overwritten; download intermediates and
  rejected sources/runs were retained.

## New sources and failures

| Video | Passage / disposition | Finding |
| --- | --- | --- |
| [Poppin John — Dub-Step 2012](https://www.youtube.com/watch?v=Q2ExVYPbM9c) | 20–60 s, then 25–60 s; excluded | Sampled blur/edit near source 21.6 s was missed by the coarse cut detector. Removing it still left 67.0% valid movement because turns hide arms. |
| [takeSomeCrime — Booty Swing](https://www.youtube.com/watch?v=jPkH4TMbeVc) | 40–60 s; test | Original 40 s run had duplicate skeleton proposals on the same dancer on 12/1,198 frames, just beyond the fixed 1% ambiguity gate. New later passage has 94.8% pose coverage; gaps stay masked. |
| [takeSomeCrime — Sweet Rascal](https://www.youtube.com/watch?v=lktmx5XhrrY) | 20–42 s; validation | Longer run has edit/flash flags at source 47.51–47.89 s, stopping identity lock. New pre-edit passage: 95.5% pose / 94.0% movement coverage, versus 62.1% pose in the longer run. |
| [takeSomeCrime — Delight](https://www.youtube.com/watch?v=DRZg0lkxLs0) | 20–60 s; excluded | 65.2% pose / 58.3% movement. No cut/multiple-body flags; joint visibility is the limiting gate. |
| [takeSomeCrime — Dirty Stop](https://www.youtube.com/watch?v=IdZfAYaamNk) | 20–60 s; train | 79.0% pose / 70.8% movement. Difficult samples show hidden forearms and missing ankles. Small picture overlay also present. Substantial masks remain. |
| [Poppin John — Move Your Feet](https://www.youtube.com/watch?v=eAJwgHILBbc) | 20–60 s; excluded | 65.8% pose / 61.9% movement despite full-body framing in source samples. |
| [Poppin John — Sphere / Crisp-E](https://www.youtube.com/watch?v=f9les1irrP0) | 20–60 s; train | 84.8% pose / 80.2% movement. Animated background is never used as brightness supervision. Forearm occlusion remains. |
| [Poppin John — You Light Me Up](https://www.youtube.com/watch?v=cDHf-stcRQg) | 20–60 s; test | 87.2% pose / 85.5% movement. Back-facing samples lose forearm confidence; retained major-body overlays appear plausible in samples. |

The other training passages are the existing AI Naafyish 20–50 s and Lost in the
Rhythm 20–40 s runs. Whole source/song groups stay in one split. Performers occur
across splits; performer generalization is not tested. Song metadata and source
audio alignment need stronger review before scaling.

## Method

`experiment-plan-2026-09-22.json` records fixed quality gates and all passage
revisions made **before any model fitting**, based solely on extraction quality.
The first attempted training invocation stopped at eligibility checks. No model
scores influenced passage selection; gates were not weakened.

The models are ridge regressions over nonlinear audio features: eight log
spectral bands, RMS, flux, centroid and zero crossings at eight past lags. Mono
16 kHz input, trailing 32 ms windows, 20 ms updates, 1.312 seconds maximum history.
No future audio, centered audio analysis, per-test-song scaling or video input.

The intermediate model predicts arm speed, leg speed, travel, extension,
deceleration and a hold indicator. It does not reconstruct every skeleton joint.
The fixed authored light rule is `0.10 + 0.45 extension + 0.25 deceleration +
0.10 armSpeed + 0.10 legSpeed`, using training-song scaling and bounded values.
Travel/holding are auxiliary estimates; they do not enter this first projection.
Direct prediction learns precisely the same brightness target. Neither target is
human lighting ground truth. Video-derived labels use future pose evidence;
that is offline supervision, not live input or proof of anticipation.

Hyperparameters are selected on one validation song. Test songs never enter
fitting or selection. One validation song and four training songs are major
limitations. The explicit live silence guard (RMS below 0.0001 → darkness) is
outside the trained regression.

## Held-out result

| Route/control | Mean absolute brightness error on two test songs |
| --- | ---: |
| Constant training brightness, 0.3888 | **0.1273** |
| Audio → brightness | 0.1420 |
| RMS-only trained control | 0.1506 |
| Audio → movement → brightness | 0.1572 |

These are errors against an authored [0,1] proxy, not human lighting quality.
Constant light is a diagnostic, not a recommended light show. Movement narrowly
beat direct prediction on validation (0.11149 vs 0.11157), while RMS-only did
better there (0.09175). There is no robust winner among the dance routes.

Brightness correlations on the two unseen songs are approximately −0.001 / 0.064
for the movement route and −0.039 / −0.019 for the direct route. On Booty Swing,
target standard deviation is 0.131 versus 0.033 for movement prediction and
0.017 for direct prediction. Outputs are too averaged to preserve the detail.

Wrong-song audio slightly improves error in several comparisons. Delaying the
prediction 200 ms–3 s barely changes error and sometimes improves it. Those
controls and weak correlation provide no evidence of accurate learned timing.
They were not used to retune the models.

## Interpretation and next experiment

The observed problem is not primarily runtime speed. Numerical parity and causal
input checks pass. The representation/data are not yielding transferable timing.
Possible explanations, which this small experiment does not separate:

1. Absolute body extension heavily influences the light rule, but exact posture
   is not uniquely determined by music. Training could favor performer/song
   averages over expressive events.
2. Four training songs are insufficient to learn different movement choices over
   similar audio. One validation song selected a heavily averaged response.
3. Skeleton confidence misses fine hand/chest expression and some geometric
   errors; 2D foreshortening, hidden limbs and derivatives further contaminate
   targets. A source can look clean while its extracted motion is unreliable.

Recommended architecture remains **audio → coarse movement phrasing → brightness**
as a hypothesis, not a demonstrated winner. Full skeleton reconstruction adds
ambiguity the one-channel output does not need. Direct brightness remains a
control until there is a musically approved light target.

Next, annotate real arrivals, held poses, connected motion and releases, check
source A/V offsets, and evaluate those events independently of absolute posture
and the final light mapping. Consider limb-specific masks so one hidden wrist
does not invalidate usable foot timing; missing groups must remain missing.
Then add distinct songs/routines selected for those behaviors, with full-span
reviews and multiple validation songs. Keep the preferred stereoscope comparison.

These two test songs are now consumed test evidence. If their results guide the
next design, reserve fresh songs for its final test. Do not keep tuning until
this same pair happens to improve.

## Artifacts and checks

Model directory:
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/audio-model-20260922T030007-16ufobq0`

`model.json`: weights, feature contract, training-only scaling and selection.
`report.json`: every exclusion, per-song/component metric, timing/wrong-song
control and implementation hash. NPZ datasets and per-run prediction JSON are
alongside them. Ignored `training.local.json` points to this directory.

Checks passed: 20 Python tests; Python/JavaScript feature/inference parity
(maximum feature difference <2e−15); future-audio prefix invariance; TypeScript;
headless desktop/mobile playback, browser/offline prediction agreement, local
upload, viewport-filling display, synthetic microphone AudioWorklet, stopped-track
cleanup, and antialiasing when live capture is reduced from 48 to 16 kHz. The
causal 63-tap capture filter adds 31 input samples of group delay at capture
rates above 16 kHz. Desktop/mobile screenshots inspected. No visible browser opened.

Regression-only inference averaged about 0.006 ms/update on this machine. This
excludes capture, FFT, browser scheduling and hardware. Physical end-to-end
latency and perceptual quality remain untested.

```sh
PYTHONDONTWRITEBYTECODE=1 /Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runtime-mzwvx_xc/venv/bin/python -m unittest discover -s research/dance -p 'test_*.py'
node research/dance/test_audio_parity.mjs
npx tsc --noEmit --incremental false
node research/dance/model_browser_smoke.mjs
```
