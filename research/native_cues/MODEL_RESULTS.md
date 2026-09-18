# Trained native-cue model — 2026-09-16

Training is complete and the saved model is runnable on other audio/video files.
It improves on simple controls on the Levity validation show, but underpredicts
changes on the Of The Trees development performance. It is not promoted to drive
the live browser or TouchDesigner output. The full lighting-director goal remains
active and unmet.

Follow-up: [GAIN_RESULTS.md](GAIN_RESULTS.md) records a waveform-validated volume
audit and second trained candidate. Augmentation modestly reduces Forest error
but does not fix transfer or earn live promotion.

## Dataset and review

`/Volumes/ExtremePro/Code/lightflow/research/native_cues/dataset_v1` contains
fourteen four-minute clips: 56 minutes and 100,688 native source frames. Every
timestamp matches independent ffprobe metadata within 0.334 microseconds of
metadata rounding; this is file-clock consistency, not physical accuracy.
All 6,595 observations in the earlier ten-span pilot regress successfully against
the longer extraction. Fixed energy mapping, quality bounds, disjoint masks,
unknown screen namespaces and geometry masks pass independent array checks.

Nine fixed source/mask frames per clip were visually reviewed (126 total), from
+1 to +239 seconds. These supplement the earlier short source/target replays;
the entire 56 minutes has not been visually reviewed. The new GRiZ/Ravenscoon
fields stay outside recognizable screen interiors in the sampled views. Other
sources retain candidate upper/interior light fields. Geometry masks still leave
only about 40–48% valid adjacent pairs in the Levity clips. Clipping, haze,
foreground obstructions and projected graphics/spill remain possible. Admission
is weak observed light-field appearance, never recovered lighting-desk commands.

## Model and results

Fresh 81-input, seven-layer, 24-wide causal temporal CNN with 25.5 seconds of
past context. Four probabilities at 10 Hz: brighten/dim in (100,300] ms and
(300,1000] ms. Native consecutive-frame edges preserve repeated flashes and
immediate short-flash releases. Unknown geometry or gaps mask the complete
future window; ambiguous smaller edges mask unproven negatives. No hold head.

ALLEYCVT, GRiZ and accepted Ravenscoon clips train; Levity Forest validates.
Forest remains excluded from fitting but is repeatedly inspected development
evaluation, not an untouched test. Jack White is outside fitting. No RPMC-L2.
Select epoch 7 of 50 by equal-clip validation Brier (.100300). The table below
uses pooled per-head Brier, averaged equally across the four heads (lower better),
which differs from the equal-clip selection statistic.

| Method | Levity validation | Forest development |
|---|---:|---:|
| Trained temporal model | .096587 | .332336 |
| Training prior | .104456 | .270135 |
| Loudness control | .101225 | .263869 |
| Current causal audio-context control | .100195 | .266290 |
| Tempo/phase control | .104684 | .270227 |
| Model with 17-second wrong history | .108753 | .333287 |

The failure is substantial underprediction on Forest. Near brightening events
occur in 27.2% of known windows while the model's average probability is 4.75%;
far brightening occurs in 52.5% while prediction averages 11.0%. Near/far dimming
has the same problem. All four model-minus-wrong-history error intervals include
zero. Model error exceeds the prior/loudness/context controls for all four heads.
Bootstrap blocks are 60 seconds within one performance; they are not independent
show-level confidence intervals. Corrected labels did not by themselves solve
cross-show transfer.

Known forecast seconds after context warmup, near brighten/dim then far
brighten/dim: training 1286.7/1300.6/1138.2/1148.9; validation
220.2/221.4/153.3/155.4; Forest 477.2/475.1/430.6/417.0. Missingness can depend on
scene brightness. Do not interpret 56 minutes as 56 minutes of clean labels.

## Saved-model checks

- Twelve synthetic tests pass, including native flash/ramp/gap cases and exact
  open/closed forecast boundaries, ambiguity and full-window masking.
- Identical-prefix and full-versus-chunk inference errors are zero in training
  checks; CPU reload also has zero prefix error.
- Fresh source-file extraction and CPU reload match saved MPS predictions within
  1.37e-7 across a 60-second Forest clip.
- Independent float64 recomputation of every per-clip/control Brier score matches
  within 6.29e-8. An initial float32 column-sum audit differed by up to 3.3e-6 on
  repeated prior values; this was accumulation error, not changed predictions.
- File inference on the reserved 60-second Jack White passage produces 600 finite,
  bounded rows, 346 with full context. This verifies execution, not genre quality.
- A preloaded 255-frame CPU model forward takes .704 ms median / .759 ms p95 over
  100 warm calls. This excludes feature computation, capture, rendering and
  physical latency; it is not end-to-end timing.

## Deliverables

Under `/Volumes/ExtremePro/Code/lightflow/research/native_cues/forecast_v1/`:
`checkpoint.pt`, `model.json`, all fourteen prediction files, baseline weights,
evaluation/history/provenance, verification, `RUN_MODEL.md`, and a hash-verified
runtime copy for file inference. The script refuses existing output directories.
Local entry point: `research/native_cues/predict_audio.py`.

The fixed 31:00–32:00 Forest comparison shows original footage, native observed
energy, the immediate stereo scope, direct procedural lights and separate model,
current-context and loudness probability traces. Learned cues do not drive its
light panel. The first render was stopped after identifying repeated NPZ
decompression inside chart-point loops; its partial output is preserved in
`forecast_replay_v1`. The corrected renderer materializes arrays once and writes
only to `forecast_replay_v2`.

Next investigate whether recording level/timbre and show-specific cue prevalence
drive the transfer failure, using train-only audio augmentation and artist-level
validation. Keep observed lighting behavior distinct from desired light controls.
Any candidate policy must preserve scope sensitivity and earn playable musical
review; a finished training run does not fulfill human-level direction or measured
physical input-to-light timing.
