# Waveform recording augmentation: trained candidate, no promotion

The previous turn made progress by measuring recording dependence on matched
Forest audio. This turn executed the predeclared RECORDING_EXPERIMENT.md:
32 waveform-derived training feature sequences, a fresh trained checkpoint,
unchanged evaluation data, independent verification and paired-recording scoring.
The full musical-director goal remains active, not completed.

## What was trained

Eight admitted training clips, each original plus four fixed causal recording
variants: quiet/dark filtering, loud/high-pass filtering, and two stereo echo
patterns. Actual sample waveforms pass through the filters before all scope and
spectral features are recomputed. No hypothetical feature-domain invariance.
Impulse arrival/reflection times, unchanged-prefix behavior and exact chunk
processing equality pass for every profile. All 32 feature CSVs contain 12,000
finite rows at unchanged source timestamps. These synthetic filters do not
establish robustness to real microphones, arbitrary rooms or clipping.

Fresh 24-wide seven-layer TCN, same seed/50 epochs, 40 training sequences and
360 batches per epoch. Original Levity alone selects epoch 6. Training plus
baseline fitting took about 29.6 seconds after feature preparation. Training
sequence count and batch schedule match the gain-augmentation experiment;
this does not isolate which of the four perturbations caused an effect.
No evaluation recording enters fitting. Four appearance-event probability
heads and missingness masks stay unchanged; no new hold/build supervision.

## Results

Pooled four-head Brier, original-audio full 25.5-second warm-up support:

| Candidate | Levity validation | Forest development |
|---|---:|---:|
| Previous gain augmentation | .095353 | .319355 |
| Waveform recording augmentation | .091407 | .324938 |
| New loudness control | .101317 | .258369 |
| New current-context control | .098172 | .289836 |
| New model with wrong history | .110122 | .319624 |
| Training prior | .104456 | .270135 |

Validation improved, but original Forest transfer worsened. Correct input is
worse than wrong history on all four Forest heads; all four paired block
intervals include zero. The trained candidate fails the transfer gate.

On the same paired 42.5-second warm support as ALTERNATE_RECORDING_RESULTS.md:

| Model | Wide audio | Alternate audio |
|---|---:|---:|
| Previous gain model | .340362 | .282814 |
| New waveform model | .346646 | .281583 |
| New loudness control | .271269 | .277309 |
| New context control | .307263 | .279270 |
| New model, 17-second delayed predictions | .337627 | .285986 |

The very small alternate-recording improvement does not compensate for the wide
recording regression, and simple controls still beat the new model. Both audio
sources describe one performance, not two independent test shows. No weights,
recording or lag are selected based on this development evaluation. The browser
keeps its existing explicitly experimental candidate.

## Verification and artifacts

Independent float64 score recomputation max error 6.29e-8; all fourteen original
time/target/mask arrays exactly match the prior run. CPU reload vs saved MPS
predictions max error 3.28e-7; checkpoint/JSON weights equal. Prefix and chunk
causality errors zero. Exact source snapshot and usage instructions preserved.

New directories under `/Volumes/ExtremePro/Code/lightflow/research/native_cues/`:

- `recording_features_v1`: training-only waveform features and hashed manifest.
- `forecast_recording_v1`: saved weights, original and separately named alternate
  predictions, controls, evaluation/verification, source snapshot, RUN_MODEL.md.

All prior SanDisk files remain preserved. This candidate is runnable with the
existing file-inference CLI but is not promoted as better lighting. No physical
capture-to-light timing or human quality evaluation occurred in this experiment.

## Consequence for the next step

Stop treating another small audio robustness tweak as the route to the full
show. Two trained augmentation experiments have not produced transferable
lighting timing. The currently supervised task still asks for short appearance
edges, whereas the goal also needs deliberate holds, builds and phrase changes.
Next inspect representative continuous source/observation/audio spans for those
slower decisions and define which can actually be observed without confusing
camera exposure, clipped washes or missing geometry with intent. Preserve the
fine direct scope response while improving the supervision for musical
structure. No hold label should be inferred merely from absence of an edge.
