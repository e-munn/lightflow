# Frozen music features: no reliable lighting cues yet

The frozen MERT comparison is complete. **Do not promote any of these heads to
live lighting.** None of the signal-only, music-only or combined heads found a
validation threshold with at least 65% precision and ten scorable triggers.
Their cue policies therefore abstain. Zero false triggers from abstention is not
successful prediction.

All fourteen feature files have 470 finite, 3,072-dimensional windows, ending
every half second. Extraction completed in 350.7 seconds. Training and PCA used
only the eight training clips; validation selected regularization and epoch.
The 64 PCA components retain 63.65% of standardized training-feature variance.
The pretrained encoder remained frozen. See PROBE_EXPERIMENT.md for the protocol.

## Development-test evidence

Pooled results on three Of The Trees Forest clips; lower Brier is better, higher
average precision (AP) is better. Positive prevalence is .5871/.5882 for
rise/release. Both recordings of this performance remain in the same split.

| Input/control | Rise Brier | Release Brier | Rise AP | Release AP |
|---|---:|---:|---:|---:|
| Signal features | .3302 | .3388 | .6470 | .6338 |
| Music features | .4116 | .4094 | .6529 | .6638 |
| Combined features | .3343 | .3429 | .6418 | .6402 |
| Constant training prior | .3243 | .3268 | .5871 | .5882 |
| Combined, 17-second wrong history | .3339 | .3428 | .6804 | .6584 |
| Combined, 250 ms minimum feature delay | .3342 | .3430 | .6427 | .6381 |

The primary combined head performs worse than the signal head and the constant
prior on Brier. It does not outperform wrong history: combined-minus-wrong Brier
is +.00036 for rise (95% interval [-.00441, .00574]) and +.00011 for release
([-.00508, .00583]). The paired 60-second block intervals describe these three
clips of one performance, not uncertainty across independent shows.

Music-only features improved validation Brier (.1972/.1899 versus signal
.2086/.2097), but this did not transfer to Forest. They predicted about .175
probability when the observed positive rate was about .588. In training, the
positive rate was about .30. This is substantial miscalibration under a show
change. Differing camera/light observations, event-label thresholds, actual
directing choices and audio distribution are plausible contributors; the result
does not isolate which is responsible. More encoder capacity alone is not an
evidence-backed remedy.

## Timing and output interpretation

Predictions use only the most recent completed embedding, accounting for measured
processing costs with a 100 ms minimum and serial-worker backlog. Increasing
that minimum to 250 ms does not rescue the result. Changing later features and
processing costs leaves earlier delivered features unchanged (maximum error 0).
These are offline availability checks, not physical microphone-to-light timing.

The fixed 31:00–32:00 Forest diagnostic displays source footage, a fixed-gain
20 ms stereo XY scope, the direct procedural light adapter, and the three
probability traces. Learned probabilities do not control the displayed lights.
The direct adapter uses the browser's intensity/color/spatial mapping. The
export is 30 fps, using the latest completed 50 Hz scope frame and 10 Hz model
prediction; its charts show trailing history only on a fixed 0–1 scale.

Artifacts on ExtremePro:

- `Code/lightflow/research/music_encoder/features_v1/`
- `Code/lightflow/research/music_encoder/probe_v1/` — predictions, transforms,
  fresh heads, full histories, evaluation and hashes.
- `Code/lightflow/research/music_encoder/diagnostic_v1/` — fixed-minute replay
  and rendering provenance.
- `Movies/Exports/lightflow_music_probe_forest_31m_9-16-26.mp4` — user-facing
  copy, SHA-256 verified against the research render.

Verification: the export decodes to 1,800 frames at 30 fps, 1440 × 980, with
60 seconds of stereo audio. Three representative frames were visually checked.
Direct adapter values match the browser implementation on three numerical cases
(maximum error 0). All fourteen prediction files passed finite/bounds and
availability checks; independently recomputed per-clip Brier values agree within
1e-7. Audio is finite and non-silent; no human musical-quality approval or
physical timing measurement is implied. Details are in diagnostic_v1/validation.json.

## Next decision

The subsequent audit is complete: [label audit](../label_audit/RESULTS.md).
It found flash sampling sensitivity, mixed screen/fixture target semantics and
short-flash release timestamps delayed by the 300 ms contrast definition.
Those concrete issues take priority over another encoder/head comparison.

Audit event prevalence and retained observations by show before another model
run. Determine whether the current targets describe comparable decisions across
different cameras and performances. Preserve raw observations and add any revised
labels as a new version. A small reviewed cue set or authored demonstrations may
provide cleaner supervision; procedural demonstrations must remain identified as
such and cannot establish human-level direction.

Forest is repeatedly inspected development data. A fresh performance, track
overlap audit, full playable comparisons, real capture/display timing and human
musical evaluation remain required. Reliable holds, builds and transitions are
still absent. The full project goal remains active and unmet.
