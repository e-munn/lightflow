# Recording-volume audit and second trained candidate

The preceding turn made concrete progress: a native-frame dataset, trained
checkpoint and verified playable comparison. This turn tests a specific transfer
failure and saves a second trained candidate. The full director goal is still
active. Neither candidate is promoted to the live light output.

## What changed

First hold forecast_v1 weights, labels and musical timing fixed, varying only
constant recording gain across 0.25/0.5/1/2/4. Derive amplitude and band power
analytically and recompute causal attacks, novelty, relative context and rhythm.
Check against actual waveform extraction in two four-second passages, five
gains each: maximum feature error 4.75e-7. This covers unclipped linear gain,
not microphone clipping, compression, EQ, room reverb or arbitrary silence gates.

Then train fresh weights with all five volume variants of the eight training
clips. Original Levity validation selects epoch 3 of 50; Forest remains outside
fitting and is development evaluation. Normalization uses augmented training
inputs only. Priors, labels, masks, evaluation times and all fourteen original
evaluation clips are unchanged. No augmented copy becomes an additional test
example. Five times the training batches per epoch means optimization budgets
are not matched; improvement cannot be attributed solely to invariance.

## Result

Mean pooled four-head Brier score, lower better:

| Candidate/control | Levity validation | Forest development |
|---|---:|---:|
| Original temporal model | .096587 | .332336 |
| Gain-augmented temporal model | .095353 | .319355 |
| Augmented model, 17 s wrong history | .111379 | .318910 |
| Original loudness control | .101225 | .263869 |
| Gain-augmented loudness control | .102031 | .266914 |
| Gain-augmented current-context control | .099692 | .269759 |
| Training prior (unchanged) | .104456 | .270135 |

The second model modestly improves original-audio Forest error, about 3.9%, but
still loses to the simple controls. Overall its correctly timed input is slightly
worse than shifted input. All four within-performance block-bootstrap differences
versus wrong history still include zero. Near brighten/dim AP is .281/.239;
far brighten/dim AP is .570/.502. These results do not support precise transferable
cue timing or human-quality musical direction.

Forest Brier across gain 0.25/0.5/1/2/4:

- Original: .3109/.3208/.3323/.3436/.3532.
- Augmented: .3067/.3134/.3194/.3244/.3277.

The aggregate score varies less with recording gain, but even the most favorable
diagnostic gain does not beat the original loudness control. No gain is selected
or applied to evaluation music. Near-brightening average probability remains
.061 at original gain, against .272 observed positive-window prevalence. Volume
is a nuisance, not a sufficient explanation or fix. Different lighting behavior,
recording timbre, remaining observation differences and ambiguous supervision
remain unresolved; the experiment does not distinguish all those causes.

## Artifacts and checks

`/Volumes/ExtremePro/Code/lightflow/research/native_cues/`:

- `gain_audit_v1`: fixed-weight diagnostic, waveform-transform check.
- `forecast_gain_v1`: new weights, predictions, controls, exact source snapshot,
  run instructions and verification. The prior file-inference runtime accepts
  this model directory without changing its feature or output contract.
- `gain_audit_aug_v1`: identical diagnostic on the second candidate.

Checkpoint/JSON equality, CPU reload parity, independent float64 score
recomputation, unchanged evaluation labels/masks/times and zero prefix/chunk
causality error are verified. All earlier SanDisk files remain preserved.
The earlier playable comparison depicts forecast_v1, not the augmented weights.

Next work must move toward an actual expressive light-behavior output, not treat
another finished probability forecast as a completed light show. Test whether a
learned modulation can add useful musical expression while preserving the fast
scope path, with an explicitly labeled offline comparison before any live
promotion. Maintain strong simple controls and wrong-audio comparisons; physical
timing and human musical-quality review remain required.
