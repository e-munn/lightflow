# The next lighting targets need better timing and separate visual sources

This audit found two concrete weaknesses in the supervision: sampling-sensitive
flash events and mixing screen graphics with beam/fixture observations. Changing
the brightness mapping alone does not explain the failed music-feature probe.
No new model was trained and no old dataset, label, checkpoint or export changed.

## Timing evidence

Ten fixed 20-second spans across five performances were re-extracted at 30 Hz,
close to the recordings' native frame rate, using the same registration transforms,
regions, validity masks and brightness mapping. These diagnostic spans are not
a random sample or fresh final test. Both rates still have camera/exposure errors;
30 Hz is a comparison reference, not ground truth.

| Event | 30 Hz count | Original 10 Hz count | Matched within 100 ms | Agreement F1 |
|---|---:|---:|---:|---:|
| Rise | 59 | 47 | 40 | .755 |
| Release | 62 | 51 | 45 | .796 |

Changing which one of three 30 Hz frames survives 10 Hz decimation yields only
.624–.653 rise agreement and .598–.673 release agreement between phases. This
is substantial sampling sensitivity. Some spans have no events; empty/empty
agreement is left undefined rather than counted as a perfect result.

In Forest 31:00–31:20, 30 Hz finds 18 rises and the old 10 Hz extraction finds
12, with only seven matching within 100 ms. Source/curve review shows rapid
flashes among longer dark/bright intervals. Forest 33:00–33:20 has much better
agreement (12 of 12 rises matched). The problem depends on the passage.

There is also a target-definition problem independent of sampling. The current
300 ms difference measures contrast against an earlier frame. It does not locate
the moment a short flash ends. A synthetic one-frame flash at 0.5 seconds turns
off at .6 seconds at 10 Hz, but receives a release event at .8 seconds: 200 ms
late. At 30 Hz the same construction is 266.7 ms late. A long clean step is
timed correctly. Adjacent differences locate the short-flash edge in these
synthetic cases, but have not yet been admitted as reliable concert labels.

Therefore, simply extracting faster and retraining the same event definition
would retain a systematic semantic timing error. Historical results remain
valid measurements of their declared 300 ms contrast target; they do not prove
accurate prediction of actual flash-off times.

## Cross-show observations

Across fourteen admitted clips, the rise-positive rate ranges from .025 in
Ravenscoon 50:00 to .655 in Forest 30:00. Validation retains only 105.9 rise and
100.3 release forecast seconds across three four-minute clips after warmup and
masking. This remains a major limitation on model/threshold selection.

Clipping affects many tracked frames: the fraction with over 5% clipped pixels
in any measured region is .72–.88 for ALLEYCVT clips, .84 for GRiZ 30:00, and
.16–.27 for Forest. This does not prove that every brightness event is false,
but limits intensity/color recovery and weakens cross-camera comparability.

Changing our exponential luma mapping gain by +/-20%, with everything else
fixed, preserves pooled event agreement of .931–.947. Most individual clips
also remain above .90. The large show differences persist. This test changes
post-capture processing; it does not simulate physical exposure or recover
unclipped pixels. No alternate gain was adopted.

Enlarged registered source crops reveal different kinds of visual evidence:

- GRiZ 31:00 and 33:00: the current crop is dominated by animated LED graphics
  (hearts, a boombox, other imagery). Low rise/release counts do not mean the
  whole lighting system is holding still. Preserve these as screen-appearance
  observations; do not pool them as equivalent beam/fixture targets.
- Ravenscoon 51:00 and 53:00: beams and lit structures mix with large rear-screen
  graphics. The small center exclusion does not remove the full screen. At
  53:00 the bright frame around the screen appears sustained across sampled
  images while its content changes. This is mixed evidence, not a clean dimmer.
- ALLEYCVT 31:00, Levity Forest 36:00 and Forest 31:00: sampled crops emphasize
  beams, haze and visible light sources, with clipping/occlusion still present.
  Registration becomes unavailable in some sampled ALLEYCVT/Levity frames.

These are agent-reviewed sample observations, not human musical-quality approval
or a complete annotation of every frame. Exact desk commands remain unknown.
See region_review.json for the evidence scope and future-use distinctions.

## Decision for the next dataset

1. Preserve source frame timestamps and near-native temporal resolution before
   deriving event labels. Do not decimate fast flashes to 10 Hz first.
2. Give screen graphics and beam/fixture fields separate masks and provenance.
   Keep mixed or uncertain pixels explicitly identified. In particular, revise
   the GRiZ and Ravenscoon region choices before treating them as beam targets.
3. Separate short flash on/off events from slower brightness changes. Test flash,
   sustained step, ramp and repetitive strobe cases before admitting event labels.
   A 300 ms contrast can remain a descriptor, with its actual meaning stated.
4. Keep the direct 20 ms stereo response. Learned slower cue decisions should
   add holds/builds/transitions without replacing fine detail with coarse updates.
5. Review source/target timing and semantic comparability before another model
   fit. Higher frame rate alone does not establish clean targets or musical judgment.

## Reproducibility and artifacts

Under `/Volumes/ExtremePro/Code/lightflow/research/label_audit/`:

- `profile_v1/`: fourteen-clip brightness, clipping, coverage and gain audit.
- `sampling_v1/`: stopped before analysis; preserved. A frame-count assertion
  caught timestamp-padding behavior in the first extraction command.
- `sampling_v2/`: corrected extraction, ten 660-frame arrays (20-second analysis
  plus a second of context at each end), source sheets, event comparisons and
  the synthetic timing counterexample.
- `figures_v1/`: cross-show profile and per-span sampling figures.
- `replay_v1/`: a 20-second Forest source/observation comparison with original
  audio. Grayscale panels use identical fixed intensity mapping at both rates.

Verified user-facing copy:
`/Volumes/ExtremePro/Movies/Exports/lightflow_sampling_audit_forest_31m_9-16-26.mp4`.
The export decodes to 600 frames at 30 fps, 1440 × 900, with 20 seconds of
finite, non-silent stereo audio. Two rendered frames were inspected. The export
SHA-256 matches the research render; details are in replay_v1/validation.json.

The failing real-source trim emitted 2,430 frames; explicit timestamp reset and
passthrough emit the expected 660. All ten corrected arrays pass frame-count,
timestamp spacing and finite-value checks. At mapping gain 6, the independent
label recomputation exactly reproduces labels_v2 rise/release targets and masks.
The unmodified 300 ms target passes long-step timing but fails the short-flash
interpretation described above. No result from the stopped extraction is used.

The full goal remains active: useful learned cue policy, holds/builds/transitions,
fresh unfamiliar-song comparisons, physical end-to-end timing and human musical
evaluation are not yet demonstrated.
