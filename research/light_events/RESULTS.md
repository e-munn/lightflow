# Relative stage-energy events — offline only

The event formulation improves probability ranking but does not yet produce
reliable timed triggers. Keep this model out of the live lighting path. The
full goal still requires holds, builds, musical judgment, unfamiliar-song human
comparisons and measured microphone/system-input-to-light timing.

Subsequent [label audit](../label_audit/RESULTS.md): these 300 ms contrast events
must not be interpreted as instantaneous flash edges. The audit found sampling
sensitivity, screen/fixture mixtures and synthetic flash-off labels 200–267 ms
late. Preserve these historical results; revise target semantics and observation
sampling before further cue training.

## What changed

Reviewed 30 sampled before/event/after triptychs across five shows. The first
label version exposed false holds caused by clipped white flashes, and positive
forecast examples were preferentially retained near missing frames. The corrected
version masks clipping for holds and requires full observed windows for both
positive and negative event forecasts. Audit frames now use the same fps filter
as extraction, avoiding adjacent-frame mistakes when seeking into a strobe.

Rise and release labels use a +/-0.25 mean regional energy change over 0.3 seconds,
with same-sign duplicate suppression. Camera-registration jumps mask surrounding
frames. Smaller ambiguous changes mask negative claims. Screen changes and haze
remain mixed with fixture behavior; this is weak stage-appearance supervision.

After strict masking, hold labels cover only a few percent of most training
clips and are nearly absent in two validation clips. The hold head was deferred
before model fitting. It remains an unsolved part of the project, not a removed
requirement. Rise/release validation supplies just 105.9/100.3 scorable seconds
after warmup. This is a substantial data-quality bottleneck.

Fresh 25.5-second causal TCN, 81 signal/context/rhythm inputs, two probability
heads for observed events within +0.2 to +1.0 seconds. Epoch 2 selected on
validation Brier score. Training sources and splits match the prior wide-shot
pilot; no RPMC-L2 or reused checkpoints. Forest is now a development holdout
because repeated experiments have inspected it; final validation needs an
untouched performance and a track-overlap audit.

## Held-out probabilities

Pooled across the three Forest clips. AP is ranking quality; Brier is probability
error. Neither is a human judgment of the resulting light show.

| Method | Rise AP | Release AP | Rise Brier | Release Brier |
|---|---:|---:|---:|---:|
| Learned TCN | .666 | .683 | .266 | .273 |
| Same model, audio shifted 17 seconds | .634 | .654 | .270 | .275 |
| Training prior | .587 | .588 | .324 | .327 |
| Amplitude-only logistic | .586 | .611 | .325 | .283 |
| Instantaneous context logistic | .616 | .653 | .247 | .268 |
| Tempo/phase logistic | .588 | .562 | .280 | .291 |

The learned model improves over static, amplitude and tempo controls in several
metrics. Its paired Brier improvement over wrong history is small and the
60-second block intervals include zero for both targets. The context-only
baseline has better probability error. This is insufficient evidence for
precisely synchronized anticipation.

Neither learned head found a validation threshold with >=65% event precision
and at least ten scorable triggers. Its policy therefore abstains. Reported zero
triggers/false triggers must not be misread as successful prediction. A logistic
rise baseline met the validation gate but fell to 60.4% precision and 8.2% recall
on Forest. Matching used the broad forecast window, not precise physical timing.
Only windows with known labels are scored; unobservable periods remain unknown.

Tested future-prefix and chunk/whole inference errors were both zero. Checks for
future-window placement, geometry-jump masking, missing observations, clipped
holds, and causal trigger rearming passed. These establish implementation
properties, not the full real-world latency or quality goal.

## Timing and tracking diagnostics

Cross-correlations between positive band novelty and observed energy rises are
weak and often periodic. Several clips peak near zero; others peak at different
beat-spaced lags. A max-over-offset shifted-audio null shows that many apparent
peaks are not persuasive evidence of a unique offset. No estimated offset was
applied. Physical audience sound travel and source A/V timing remain unresolved.

A strict local optical-flow bridge experiment on Levity 15:00–17:00 recovered
only 0.9 seconds beyond its same-run reference-matching baseline. Recovered
geometry required a subsequent reference anchor to agree within two pixels.
This small gain does not justify regenerating the dataset with this method.
Neither the original masks nor any existing drive artifact was overwritten.

## Artifacts and next experiment

All artifacts are under `/Volumes/ExtremePro/Code/lightflow/research/`:
- `light_events/labels_v1`: rejected initial labels, preserved.
- `light_events/labels_v2`: corrected candidate labels and sampled review sheets.
- `light_events/run_v1`: fresh model, predictions, baselines and evaluation.
- `light_events/association_v1`: offset curves and shuffled-time diagnostics.
- `wide_lights/tracking_audit_v1`: optical-flow recovery audit, not adopted.

Next investigate richer musical representations as an explicit comparison to
handcrafted band/level features, while separately improving reliable observation
coverage. A pretrained music encoder is a candidate feature source, not a
lighting policy. Feed only a trailing received-audio window; verify prefix
causality, checkpoint compatibility and real processing time before training
with it. Preserve the immediate stereo path and reserve an untouched show for
the eventual final test. Do not turn a probability-ranking improvement into a
claim of human-level directing.
