# Native-clock edges and separate screen/light-field measurements

The timing correction is implemented and the first spatial-mask comparison is
complete. This improves the observation pipeline, not the trained director yet.
No live model changed and no existing ExtremePro file was deleted or replaced.

Update: the longer fourteen-clip dataset and a fresh trained model are now
complete. See [MODEL_RESULTS.md](MODEL_RESULTS.md) for the 126-frame review,
saved runnable model, controls and transfer failure. The pilot results below
remain the historical evidence leading to that run.

## What is verified

The pilot decodes every available source frame without an fps filter. Across ten
fixed 20-second spans plus one second of context at each end, all 6,595 decoded
timestamps match independent ffprobe presentation timestamps within 0.334
microseconds (metadata rounding). That is a file-clock consistency check, not
physical timing accuracy. These spans contain no source gaps over 50 ms; gaps
are nevertheless explicitly masked and tested, rather than filled in.

One metadata-query boundary check initially failed: ffprobe stopped packet
reading before two reordered tail frames were emitted. Its 657-frame prefix
matched; reading an extra second and filtering by presentation time matched all
659 frames. The stopped pilot_v1 is preserved; pilot_v2 uses the corrected
independent query and retains the exact requested interval.

Candidate brightening/dimming edges now compare consecutive valid frames. Their
timestamp is the first frame displaying the changed value; the actual switching
time is bounded by the previous/current source frame. Six tests cover short
flashes, sustained steps, ramps, repetitive strobes, missing/unknown frames and
unchanged prefixes. The synthetic short-flash dimming label now lands on the
first dark sample instead of 200–267 ms late. Ramps remain separate slower
changes, and adjacent strobes are no longer merged by 300 ms suppression.

Nineteen sampled before/event/after triptychs across six spans were visually
checked. Forest and ALLEYCVT samples show visible brightness edges at the marked
frame. GRiZ and Ravenscoon samples also confirm that some old-crop events are
screen-content changes. The observations remain vulnerable to exposure, light
spill, occlusion and camera errors; these are weak appearance events, not desk
commands or human musical-quality approval.

## Spatial separation

New disjoint mask proposals isolate screen interiors and candidate upper/side
light fields for GRiZ and Ravenscoon. Six registered source frames were inspected,
then both types were measured over the same four fixed 20-second spans. Every
timestamp exactly matches the native-clock pilot. Each type retains four
horizontal regional controls, peak, coverage, energy, color and quality masks.

| Span | Light-field energy std | Screen energy std | Light-field clipped-frame fraction | Screen clipped-frame fraction |
|---|---:|---:|---:|---:|
| GRiZ 31:00–31:20 | .0958 | .0728 | .142 | .948 |
| GRiZ 33:00–33:20 | .0626 | .0937 | .000 | .803 |
| Ravenscoon 51:00–51:20 | .1472 | .0703 | .194 | .982 |
| Ravenscoon 53:00–53:20 | .0075 | .0015 | 1.000 | 1.000 |

Clipped-frame fraction means that at least one measured region contains over
5% clipped pixels. The separated fields retain variation with much less clipping
in three spans. The fourth remains clipped throughout, so its apparent steadiness
cannot establish a clean physical intensity hold. Different mask areas measure
different parts of the scene; reduced clipping is not proof of complete fixture
isolation or improved musical quality.

The proposals remove recognizable screen interiors in the sampled views, while
background graphics, projected scenery or screen spill may remain in the candidate
light fields. These masks cover only part of a performance. An empty measured
field must not be labeled as a whole-rig blackout.

## Admission and next work

Admit this as a reviewed **measurement pilot**. Keep region types separate.
GRiZ's old crop stays screen-dominated; Ravenscoon's old crop stays mixed. The
new masks are candidates for weak light-field observations, not clean physical
lighting targets or a complete training corpus. Continuous source/mask replays
are generated for review. Existing geometry masks remain unchanged and Levity's
low observation coverage is still a validation limitation.

Next, verify these region choices over the longer source clips, then construct
the next versioned dataset and explicitly define the predictive outputs before
training. Use edge timing for short accents and dimming, and separate longer
descriptors/states for activity, builds, holds and transitions. Do not interpret
an absence of strong edges as a hold. Preserve the direct 20 ms scope response.
Any learned policy still needs synchronized baselines, wrong-history controls,
playable unfamiliar-song comparisons, human review and physical latency tests.

## Artifacts

Under `/Volumes/ExtremePro/Code/lightflow/research/native_cues/`:

- `pilot_v1/`: stopped before admission, preserved with reason.
- `pilot_v2/`: native observations, PTS, quality/geometry masks, edge/slow-contrast
  descriptors, event triptychs, source audit and code hashes.
- `mask_review_v1/`: sampled overlays for the two spatial proposals.
- `region_comparison_v1/`: disjoint field/screen observations and numerical checks.
- `region_replay_v1/`: short source-and-region comparisons with original audio.

Verified user exports:

- `/Volumes/ExtremePro/Movies/Exports/lightflow_separate_regions_griz_9-16-26.mp4`
- `/Volumes/ExtremePro/Movies/Exports/lightflow_separate_regions_ravenscoon_9-16-26.mp4`

Each decodes to 600 frames at 30 fps, 1440 × 900, with 20 seconds of finite,
non-silent stereo audio. SHA-256 matches the research render. Display sampling
uses only the latest available native source frame (maximum age 33.34 ms), not
a future frame. Representative render frames were inspected; the exports remain
available for continuous review. These checks do not measure physical latency.

Early decoder shutdown initially stalled both renders after frame generation.
Only their confirmed decoder children were stopped so the parent and encoders
could finish normally; all 600 output frames were verified. The reader now closes
its pipe before terminating, with bounded cleanup, and the early-close regression
finishes in .218 seconds. The exact decoder source used for the completed pilot
is preserved at pilot_v2/native_frames_at_run.py and matches its manifest hash.

No model-quality improvement is claimed from these extraction changes alone.
The full project goal remains active and unmet.
