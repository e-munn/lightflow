# Editorial pilot v1: rejected for deployment

Artifacts: `/Volumes/ExtremePro/Code/lightflow/research/editorial/run_masked_v1/`.
Fresh causal TCN, 25.4 s of past scope features; train Levity/Whethan,
validate REZZ, test Skrillex Chile. Selected epoch 3 using validation Brier.
Identical-prefix/different-future check: maximum prediction difference 0.
Chunked inference also matched whole-sequence inference within 1e-6.
RPMC-L2 was not used. Jack White and all new wide-shot files were excluded.

Labels are selective **weak editorial targets** from TransNet V2. Score >= .9
candidates count as strong unless visual review flagged ambiguity; lower-score
events mask negative claims. Three-frame visual reviews do not establish recall,
exact timing or lighting authorship. Training never receives past/future video
events as input. Artist/show separation does not prove track separation.

## Separate production: Skrillex Chile

| Target | Learned AP | Amplitude-only AP | Prior AP | Learned Brier | Prior Brier |
|---|---:|---:|---:|---:|---:|
| Cut 0.2–1 s ahead | .0785 | .0923 | .0800 | .0774 | .0738 |
| Cut 1–3 s ahead | .2316 | .2480 | .2290 | .2098 | .1767 |
| No cut in next 5 s | .4190 | .4460 | .4230 | .2520 | .2459 |

Higher AP and lower Brier are better. The learned outputs fail to outperform
simple audio amplitude on ranking and fail the average-rate baseline on Brier.
Shifting predictions by 17 s actually improves AP on all three targets. This
is evidence against useful, precisely conditioned editorial prediction here.
For cut probabilities, paired 60-second-block bootstrap intervals put the Brier
disadvantage to the prior above zero: [.00267,.00456] and [.02458,.04129].
Hold differences are inconclusive; there is no demonstrated useful improvement.
Coverage is selective (about 87%, 75%, 64% by head), not every test frame.

Validation ranking was also weak: learned AP .0399/.1298/.4815, versus
amplitude .0523/.1521/.5838. A small Brier improvement on the validation hold
head was mostly calibration, not evidence of better musical ranking, and did
not survive the separate show. Do not promote this model or render its output
as an earned lighting improvement.

## What this changes

This tests a small scope-feature model and noisy detected edits. It does not
disprove the user's broader idea that shot selection, pacing and reveals can
teach useful musical structure. A stronger future test needs reviewed sequences,
better musical context and direct evidence of transfer to light behavior.

Prioritize the new wide-shot lighting path next. The Forest regional replay
already preserves visible dark/bright passages, but clipped color, camera and
audio/light synchronization must remain explicit uncertainties. Train on other
wide-shot shows and keep both matched Forest recordings in the same holdout.
The existing live browser remains the scope/direct/short-forecast comparison;
this rejected editorial checkpoint is not loaded by the app.
