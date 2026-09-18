# Restoration results — 2026-09-17

The current-response restoration experiment produced a real improvement on paired synthetic capture tests. It did **not** establish the full musical-expression goal and is not connected to the default live output.

## What changed

The model predicts current brightness rather than future brightness. It retains an immediate observed-scope residual path and trains with value error plus a first-difference penalty. A temporal MLP consumes nine lagged observations over two seconds, each containing eight scope descriptors and measured scope brightness. There is exactly one output scalar.

v1's ±0.5 correction cap made 46–86% of noisy-mono training targets unreachable in four training clips. v2 expands the correction range to ±1 while the final signal remains bounded to [0,1]. v3 adds two Of The Trees Ultra excerpts to training, a direct-recording Calabria validation clip, and More Lemons/Jetski probes. No probe targets are fitted. Earlier evaluated probes are development evidence, not untouched final tests.

The targets remain the original-recording stereo-scope signal. This supplies a defensible test for capture restoration; it is not supervision for better artistic choices than the original scope.

## Quantitative outcome (v3)

| Case | Direct degraded MSE | Restored MSE | Restored change correlation with reference |
|---|---:|---:|---:|
| Forest 600, noisy mono | .18237 | .00737 | .716 |
| Forest 3000, noisy stereo | .01827 | .00145 | .866 |
| Ratata, noisy stereo | .02367 | .01373 | .911 |
| Where's Your Head At, noisy mono | .29170 | .00758 | .600 |
| Jetski, noisy stereo | .01598 | .01104 | .883 |
| More Lemons, noisy mono | .39579 | .03761 | .783 |

All tested degraded clips passed the predeclared 15% MSE-improvement criterion. The aggregate fitted-control criterion and original-input MAE criterion passed. Variation preservation and fast-change accuracy did not pass for every clip: e.g. Jetski stereo retains only .719 of reference variation and Where's Your Head At mono reaches only .600 change correlation. The raw v3 model also emits .122 on all-zero features. The runtime explicitly returns zero on digital silence, but that guard must not be confused with learning correct silence behavior.

**Decision: not promoted.** The aggregate error improvements are substantial but not sufficient for the required trustworthy detail and musical expression. The fixed augmentation recipe also does not establish robustness to unknown microphones, noise levels or rooms.

## What the temporal context contributes

The v2 history audit preserves the current frame while replacing only older lags. On Forest 3000 noisy mono, correct-history MSE was .00206 versus .00417 with wrong past and .00261 with repeated-present input. Context helps there. On Ratata noisy stereo, repeating the present instead of using history improved MSE (.01547 versus .02171), so memory can also hurt transfer. Do not claim that temporal context is uniformly helpful.

## Why stereo restoration cannot be the entire microphone solution

A controlled pair creates identical mono downmixes (maximum difference 2.78e-17) but different original stereo-scope brightness targets: .0598 and .5230. Any deterministic model of that same mono input must produce the same answer for both; its minimum worst-case absolute error is at least .2316. Missing stereo information is not uniquely recoverable. A model can estimate plausible values from priors, but microphone expression needs an observable, musically useful target rather than a claim to reconstruct unavailable geometry exactly.

Likewise, reproducing the original scope under degraded input cannot demonstrate better artistic accent/hold/build/release choices on an already-good system signal. It addresses input robustness, a component of the full objective. Further training should not silently substitute restoration for musical judgment.

## Runtime and reproducibility

`public/scope-restoration.mjs` implements the saved network with bounded output, two-second warmup, gap reset, invalid-input blackout and digital-silence blackout. It is available for controlled research but is **not imported by the live page**.

21,004 evaluated frames across original, noisy stereo, noisy mono and a probe track match Torch predictions with maximum error below 4.1e-7. Node p95 inference time was below .016 ms in that test; this is not browser end-to-end or physical latency. Source and artifact snapshots are saved on SanDisk.

- Paired datasets: `brightness_restoration_dataset_v1` and `brightness_restoration_dataset_v2`.
- Checkpoints, JSON models and per-case predictions: `brightness_restoration_model_v1`, `v2`, `v3`.
- Context ablation: `brightness_restoration_history_v2/report.json`.
- Export verification: `brightness_restoration_model_v3/runtime_test.json`.
- Mono ambiguity proof: `brightness_restoration_model_v3/mono_ambiguity.json`.

All directories are under `/Volumes/ExtremePro/Code/lightflow/research/`. All output creation was exclusive; prior files remain intact.

## Goal status

Previous turn and this turn made measurable progress. The goal remains active, not complete. Still missing: evidence that the scalar reference itself is musically useful, an improvement in musical expression over that reference on unfamiliar music, and a measured real capture/display path. The existing listening question remains unanswered. A good next training target must be informed by those musical findings; another smooth teacher-copy experiment cannot certify them.
