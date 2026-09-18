# Relative light-event experiment

Read docs/TRAINING_GOAL.md and docs/VISUAL_SIGNAL_RESEARCH.md. The full goal is
unchanged: a live causal director with human musical judgment, scope sensitivity,
timing evidence and unfamiliar-song human comparisons. This is one proposed
learned control layer, not the completed director.

Previous goal turn: progress. It produced a fresh stage-appearance model,
held-out comparisons, and evidence of averaged output and weak audio conditioning.
No model from that run was promoted. This experiment asks a different question:
can audio history predict relative changes and sustained energy states?

## Observations and targets

Use the same reviewed wide-shot observations and show split. No new training
data, no RPMC-L2, no inherited weights. Forest was inspected in prior experiments
and is a development holdout, not a pristine final benchmark. A fresh untouched
performance will be required before a final generalization claim. Track overlap
across DJ sets remains unresolved.

Targets are weak inferred **stage-energy** events, not fixture commands or human
intent annotations. Use mean energy across the four measured regions at 10 Hz.
Strong rise/fall: change of at least +/-0.25 over 0.3 seconds. Suppress same-sign
candidates within 0.3 seconds by strength. Changes of 0.12–0.25 are uncertain.
These thresholds were chosen from training-source change distributions and will
not be tuned on test model results. Do not infer color choice from these labels.

Ignore geometry failures and +/-0.3 seconds around registration updates that move
any reference-image corner by more than two pixels. Both positive and negative
forecast labels need the full look-ahead interval valid, avoiding preferential
retention of positives near gaps. Negative labels additionally require no
uncertain candidate. Missing is never a blackout or hold.

Three candidate probability targets in [0,1], observed at 10 Hz:
- A strong observed rise within +0.2 to +1.0 seconds.
- A strong observed release within +0.2 to +1.0 seconds.
- An energy hold over the next two seconds: every region's energy range < .12.
  A range >= .22 establishes non-hold; intermediate ranges are masked. Every
  frame in the hold window also needs all regional clipped-pixel fractions < .05
  and mapped energies < .95; saturation can conceal real changes.

The initial v1 label audit was rejected before fitting: it preferentially kept
positive forecasts near missing frames, and saturation caused misleading holds.
`labels_v2` applies the stricter mask above. Review images now use the extractor's
exact fps-filter sequence, because independent seeks could select adjacent frames
during a strobe. v1 files are preserved; they are not used for training.

The v2 audit left only about 3–6% hold-label coverage in most training clips,
and one validation clip has no valid hold labels. Before fitting, the hold head
was deferred for lack of support. This run trains only rise and release. Learning
holds, builds and full musical direction remains required for the full goal.

All target look-ahead is training/evaluation only. Original recording audio stays
paired with original video timestamps. These horizons do not establish physical
anticipation: audience sound travel, recording offsets and detector resolution
remain uncertain. Plot audio/video association across fixed offsets as a
diagnostic; do not select offsets on the test set to improve model scores.

## Review and model protocol

Inspect sampled before/event/after frames from training sources before fitting.
Document inferred event counts, masks and sampled mistakes. Hold means energy
hold only: beams, video screens or hue may still move. Preserve raw source data.

Audio: existing 48 pooled causal features, causal differences from .5/2/8-second
running means for eight band powers and amplitude, plus the existing six-feature
past-only rhythm comparator. No clip-wide audio normalization. Normalize final
features using training clips only. Fresh width-24 seven-layer residual TCN,
25.5-second context, two probability heads; 50 epochs, unweighted masked BCE.
Select checkpoint by mean validation Brier score. Compare with training priors,
amplitude-only logistic regression, instantaneous all-feature logistic regression,
tempo/phase-only logistic regression and 17-second wrong-audio history.

Evaluate AP versus prevalence, Brier, one-to-one event precision/recall and false
triggers/minute. Select trigger thresholds and a 0.5-second refractory period on
validation only. Report precision-constrained choices; if precision >= .65 is
unavailable, abstain rather than silently choosing an unreliable trigger. Prefix
causality must hold. Temporal intervals use paired 60-second blocks and support
only a within-performance interpretation. Do not deploy a model merely because
its AP or loss improves; it must improve actual timing and musical expression.

## Output mapping if justified

Keep the immediate scope control at 50 Hz. Learned probabilities could control
small preparatory lifts, deliberate releases, and hold duration in a stateful
policy. Browser brightness consumes intensity; a DMX group dimmer consumes the
same signal. Probability is not itself a dimmer command. The stateful policy and
its bounds must be explicit and compared through the same renderer before live
promotion. Fine details must remain audible/visible even in a held lighting state.
