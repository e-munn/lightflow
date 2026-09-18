# Scope-response restoration — frozen before fitting

Hypothesis: the next useful learned task may be preserving the immediate scope response under degraded capture, rather than predicting future values. The previous future-value model flattened detail; a current-frame target allows direct transient information to remain available.

Target: original-recording stereo scope coverage, with the current median-matched soft display curve. Original recordings are not studio-clean or human lighting labels. This experiment cannot establish learned artistic cue choices by itself. It tests whether a temporal model restores a useful reference under gain changes, added noise and mono downmix, without introducing anticipation.

Inputs: eight causal scope features, observed scope brightness, 2 seconds of lag history. Output: exactly one current brightness. No future input or whole-song normalization. Shared browser raster supplies reference and degraded signals. Training-only normalization and fixed, reproducible augmentation. Preserve the original stereo reference; never call mono measurements stereo spread.

Splits: the six ALLEYCVT/GRiZ/Ravenscoon intervals from brightness_dataset_v3 train; Levity 900–1020 validates; Forest 600–720 and 3000–3120 test transfer. Additional `ratata.mp3` and `wheres_your_head_at.m4a` excerpts at 30–90 seconds are probe tracks excluded from fitting. These songs exist in the broader project; do not describe them as untouched across all prior research. Cross-show song overlap remains unknown.

Conditions: original; fixed 0.5 gain plus deterministic independent noise and mild causal echo; mono downmix with the same gain/noise/echo. Added noise/echo is a synthetic capture stressor, not a recording of a room. Prefix initializes feature filters and history. Gain/noise constants are declared in extraction code and saved in the manifest. Do not choose them from held-out errors.

Compare direct degraded scope, persistence of direct degraded scope, amplitude-only fitted model, and full-feature temporal ridge regression. Also report the model on original inputs to detect damage to the good path. Targets include both expressive fast changes and silence; report MAE/MSE, temporal-change variance and delta correlation, rise/fall detection, brightness biases, and silence response. A saved model must not be promoted solely for average error improvement.

For conditional promotion to a listening experiment: at least 15% MSE improvement over direct on each degraded development-transfer clip, no more than 10% MSE disadvantage to the better fitted control on average, variation ratio >= .8, temporal-change ratio >= .7, delta correlation >= .7, and no constant bright output on silence. Original-input error must remain small (MAE <= .05). Failure remains useful evidence; do not secretly loosen criteria after seeing results. Musical usefulness and physical timing still require separate evidence.

## Declared follow-up runs

v2 removes the first residual network's ±0.5 correction cap. That cap made 46–86% of noisy-mono targets unreachable in four training excerpts. The bounded final output remains 0–1, but the residual can now cover the full difference. The acceptance criteria are unchanged.

v3 retains that architecture and adds two original Of The Trees Ultra audio excerpts (600–720 and 1800–1920) to training, with Calabria 30–90 as an additional validation recording. More Lemons and Jetski at 30–90 are additional excluded probe tracks. The earlier Ratata and Where's Your Head At examples have now informed the recording-domain hypothesis; retain their results but do not call them untouched final tests. No probe targets are fitted. The same criteria continue to apply to all validation, transfer and probe cases.

Augmentation limitation: the first datasets use a fixed synthetic capture recipe and deterministic noise seed. This is not evidence of broad robustness to arbitrary rooms, levels or noises. Before live promotion, independently seeded and differently degraded inputs are required. No reconstruction model can uniquely recover true stereo information from mono; estimates can rely on statistical priors. The current goal requires useful expression, not a claim that missing stereo information is physically recoverable.
