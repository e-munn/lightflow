# Dance as a teacher for lighting

Branch: `codex/dance-choreography`.

## Direction

Use dance choreography, rather than recorded concert lighting, as the new
experimental source of human musical expression. Extract the dancers' skeletons
and learn how their movement articulates music: precise arrivals, controlled
holds, fluid transitions, anticipation and release.

Keep the current output contract: audio in, one continuous brightness value in
[0, 1] out. Skeletons are training/review evidence; dancers and a camera should
not be required at inference. The first causal audio models are now trained,
but failed the held-out transfer checks; no dance-to-light mapping is validated.

## Current result

Higher-quality extraction trial: [original versus RTMW/Heavy](http://localhost:3001/pipeline/pose-quality).
Three passages have been reprocessed with each candidate on identical source
frames. RTMW recovers more usable limb observations and includes native hand
points, but introduces furniture false detections in Crave You. Full remains the
default until positional accuracy, association and jitter are checked more
broadly. See [the pose-quality report](POSE_QUALITY_2026-09-23.md).

The active view is now [music + raw movement](http://localhost:3001/pipeline/live).
Play original source music with its recorded skeleton, either alone or over the
video. This is synchronized playback of observed movement, not live pose capture
or audio-to-motion prediction. `/pipeline/model` redirects to this view.

The presentation follows origin's `9f14325`: black fullscreen stage, mint joints,
compact icon controls that fade during playback, and details behind a panel.
The viewport fills the screen while source proportions stay intact. Scrubbing,
frame stepping, playback speed, looping, and passage selection share the source
video's clock. Joints below 0.5 confidence or outside the frame are omitted;
unassigned poses and tracking gaps stay empty. The Movement panel now offers
display-only adaptive smoothing: **Steadiness**, **Fast movement response**, and
a gray raw comparison trace. Switch smoothing off for exact raw coordinates.
Settings persist locally; source data stays unchanged. Pose interpolation and
predictive model output are not used. The authored brightness studies described
below are separate from the recorded skeleton and can be turned off.

The current expansion and proposed brightness measures are documented in
[the 23-passage expansion report](SOLO_EXPANSION_2026-09-22.md) and
[Brightness from movement](BRIGHTNESS_FROM_MOVEMENT_2026-09-22.md). Keep this
separate from validated musical or lighting labels.

See [the completed audio-model experiment](AUDIO_MODEL_PILOT_2026-09-22.md).
Eight new creator videos were acquired, eleven new extraction runs audited,
and two audio-only routes compared against RMS and constant controls. Models,
datasets and full evaluations are retained on SanDisk. The previous predictive
UI is retained in `src/app/pipeline/model/ModelStudy.tsx` but is not the active
route. Neither model learned transferable timing. Keep the stereoscope as the
reference.

The immediate research task is improving the movement-phrasing targets and their
review, rather than predicting every skeleton coordinate or collecting footage
without checking extraction. This first test set is consumed evidence; reserve
fresh songs after revising the design.

## First experiment

1. Use a user-selected short dance passage with its original audio. Prefer a
   fixed camera and one fully visible dancer for the initial extraction check.
   Keep source URL, source timestamps, provenance, and any A/V offset together.
   Store video, model assets and derived data in a new, exclusive directory
   under `/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/`.
2. Extract timestamped joint coordinates and per-joint confidence. A candidate
   is MediaPipe Pose Landmarker, which supports video timestamps and multiple
   poses. Multi-person detections still need explicit identity association;
   detection order must not be treated as a persistent dancer ID.
3. Review video plus skeleton overlay before deriving movement targets. Mark
   cuts, occlusion, identity uncertainty and tracking failures as missing data.
   Missing poses are not stillness. Retain source presentation timestamps and
   audio alignment; frame index divided by nominal FPS is insufficient for
   variable-frame-rate sources.
4. Derive body-relative movement and retain global travel separately. Normalize
   scale using a stable body reference. Avoid interpreting camera movement as
   dancer movement. Inspect velocity, acceleration, stops, extension/contraction
   and changes in direction at several time scales. Confidence masking and
   filtering are essential before derivatives; filtering delay must be recorded.
5. Build a synchronized review: source video, skeleton, movement traces and a
   single light field with its brightness trace. Compare candidate mappings on
   exactly the same music, alongside the existing stereo-scope reference.
6. Choose a mapping only after listening and watching. Then investigate an
   audio-conditioned temporal model that learns movement phrasing as auxiliary
   supervision and produces the reviewed brightness behavior.

## What might transfer

These are hypotheses to audition, not observed lighting labels or fixed rules.

| Dance evidence | Possible lighting interpretation | What must survive |
| --- | --- | --- |
| Sharp arrival or controlled stop | Accent with a shaped attack and decay | Arrival timing and contrast |
| Sustained pose | Held light level | Intentional stillness rather than automatic darkness |
| Continuous curved movement | Continuous rise/fall | Fluid progression rather than a blurred energy meter |
| Expansion and contraction | Build and release | Phrase shape, including quiet movement |
| Preparation before an accent | Anticipatory ramp | Preparation-to-arrival timing |
| Repeated motif with variation | Related light gestures with variation | Structure across several beats |

Speed alone is not the target. Smoothness is not simply low acceleration: a
precise sharp stop may be expressive, and excessive smoothing can erase it.
The representation should preserve both continuity and articulation. Joint
trajectories alone cannot establish artistic quality or intent.

## Learning and evaluation

Retain three distinct layers: estimated human pose, inferred movement features,
and authored dance-to-brightness hypotheses. Do not describe a hand-designed
mapping as learned lighting judgment. A useful intermediate objective is to
predict movement phrasing from audio; success there does not establish that its
translation to brightness is musically useful.

Before training, freeze feature definitions, timing, confidence masks and the
chosen projection. Split by track, performance and choreographer/dancer where
possible; duplicates and alternate views belong in the same split. Start small
enough to inspect every source passage before collecting a large corpus.

Compare against loudness-only brightness and the user-preferred stereo scope.
Use shuffled/wrong-audio controls to test whether the model listens. Evaluate
held-out phrases for accent timing, holds, fluid transitions, subtle detail and
musical usefulness. Check causal inference, measured latency and darkness on
audio stop. Offline pose processing can use future video for teacher labels;
the live audio model cannot use future audio. Document any teacher filter delay
and deliberate anticipation separately from synchronization error.

## Current status

Research direction captured. The user selected `tVMHNNho9H8` as the pilot and
endorsed the DanceMillennium channel as a source pool; see `sources.json`.
Both supplied videos and audio have been downloaded to SanDisk with source
metadata and retained original streams. DanceMillennium and @kylabullings are
user-endorsed source pools. `/pipeline` now runs local pose extraction and review
on selected 2–60 second passages. Completed solo runs can now produce an offline
movement study with two authored brightness hypotheses, source-audio comparisons,
and candidate cue review. The initial audio models are trained but did not pass
transfer checks; a validated mapping remains pending. Current work prioritizes
listening to the music with the raw movement before revising those targets.

## Pipeline workspace

Run the existing Next.js development server and open `http://localhost:3001/pipeline`.
Select a source, start time, and passage length, then **Process passage**. Each run
gets a new UUID directory under the dance root's `runs/` folder on SanDisk. The
page polls real processing events and progressively loads pose chunks. Scrub the
audio waveform, step decoded frame timestamps, slow playback, hide other bodies,
or isolate the skeleton. Notes are saved as new timestamped JSON files per run.

`setup_runtime.py` installs a new isolated Python environment and official model
bundle on SanDisk. It updates only `runtime.local.json` in this workspace; that
machine-local pointer is gitignored. Earlier runtimes, failed runs, and original
media remain intact. Requirements pin MediaPipe 0.10.35 after observing a native
initialization abort with 1.0.1's default delegate on this Apple Silicon host.

The worker makes an H.264/AAC review clip and extracts its source-audio waveform.
Both playback and pose timestamps use that clip's timebase; frame PTS come from
PyAV, not a nominal frame-rate calculation. Audio plays through the video element
so no independent audio clock can drift. This preserves source alignment; it does
not establish that the original recording itself is perceptually synchronized.

The pose model estimates up to six bodies with 33 landmarks per body. New runs
use a strict solo gate: exactly one detected body is required. A separate
position/proportion association heuristic follows that body, and a cut flag or
more than one second of lost association stops assignment for the rest of the
run. A reviewer must start a new passage; the worker does not silently reacquire
someone else. Older group runs remain available with their original behavior.
Exactly one detection still does not establish correct identity. Whole-frame-change
cut flags are provisional and need review.

The page distinguishes primary assignment, usable-pose coverage (all 12 major
torso/limb joints in frame with visibility/presence >= 0.5), model confidence,
multiple-body frames, and visual identity review. Identity checks are immutable
records with interval, sampled/continuous method, outcome, and reviewer. Samples
never imply full-span review; automated QA never certifies identity. Flagged
issues remain visible. Identity correctness and joint-location accuracy are
different questions, neither established by confidence alone.

In supported browsers, skeleton selection uses the actual presented frame's
`requestVideoFrameCallback` media timestamp. The overlay is cleared during seeks
until that frame arrives; it does not jump ahead of the video. Audio remains on
the video's clock. A run can be opened with `/pipeline?run=<UUID>`.

The frame readout includes confidence, number of bodies, primary-track identifier
and the worker's unfiltered diagnostic speed. The separate **Movement → light**
study computes filtered movement features with the method below. Logs contain
actual processing/selection events and cue explanations, with the raw worker log
available for failures. They are not a language model's private chain of thought.

### Movement and light study

Choose **Analyze movement** on a completed solo run. `analyze.py` creates a new
UUID JSON in that run's `analyses/` directory. Reanalysis retains previous files.
The analysis stores source offsets, actual frame timestamps, settings, algorithm
version, and SHA-256 hashes of the input poses, audio, and implementation.

The method corrects x/y aspect ratio, subtracts the torso center, and uses a
fixed median torso length for scale. A local line fit over ±60 ms reduces jitter
while respecting uneven timestamps. Relative joint speed and global center travel
stay separate. Gaps, cuts, track changes, and incomplete joint observations split
segments. Derivatives at segment edges remain missing; missing values never
become stillness, darkness, or interpolated labels.

Arrival candidates come from peaks in deceleration after movement. Hold candidates
require low relative speed and low center travel for at least 240 ms. Transition
candidates require at least 500 ms of uninterrupted movement. These definitions
do not establish intent, elegance, musical timing, or joint accuracy.

Two selectable design hypotheses are available:

- **Accents + held poses:** body extension sets the base level, proposed arrivals
  add an exponential-decay pulse, and detected holds retain the base level.
- **Extension + motion:** body extension and relative movement combine continuously.

Both use whole-passage calibration and future video. Feature lookahead is measured
and recorded, but cue detection and normalization use additional future information.
These are offline teacher experiments, not causal audio controllers. Held-pose
brightness is not validated as a useful artistic choice.

The browser decodes the same extracted audio at 48 kHz without playing a second
audio stream. It computes trailing 20 ms comparisons at 50 Hz: the unchanged
`public/scope-brightness.mjs` projection (exposure 40, soft curve enabled) and an
RMS-only reference, `1 - exp(-4 * RMS)`. Comparisons follow the presented video frame,
support scrubbing, and remain frozen for paused inspection. Hatched fields mean
missing evidence. Compact light fields also sit directly under the video.
Audio references are recomputed in browser memory; they are not persisted targets.

Cue reviews are new JSON files in `cue-reviews/`, tied to the precise analysis and
cue IDs. Latest non-automated review is displayed; history remains visible.
Keeping a movement cue does not certify identity or approve a brightness mapping.
Automated QA records never count as a human judgment. Full identity review,
source audio alignment, and musical usefulness still need assessment.

Local API routes accept only registered source IDs and fixed run asset names.
Processing and notes require same-origin requests. Media supports byte ranges.
Cancellation is cooperative: preparation finishes, then the worker stops at a
frame boundary and retains partial results. Abrupt worker exits are surfaced as
errors or interrupted runs. The page is local-only, not a cloud worker service.

Verification:

`/pipeline/live` now includes seven movement-to-brightness buttons and Off. They
drive one white field covering the entire viewport behind the optional skeleton.
Motion uses the stronger limb group; Arms and Legs isolate their respective
speeds; Snap accents increases; Stops accents confirmed slowdowns; Hold lights
relative stillness after activity; Open maps pose extension. Keys 1–8 select
these mappings without pausing. Sensitivity scales the level; Fade sets the
exponential release time. Turn Skeleton off to judge the light alone.

This is a recorded teacher-signal audition, not a learned audio response.
`movement-brightness.ts` uses hip-relative coordinates, a median torso scale,
fixed 35 ms coordinate and 45 ms speed filters, and clip-wide 95th-percentile
speed calibration. Open uses the passage's 5th–95th percentile extension; Hold
uses its lower-quartile activity with bounded thresholds. Calibration sees the
whole passage. Event timing itself uses past/current observations, with 60 ms
slowdown confirmation and 100 ms quiet confirmation. Arm/leg evidence is masked
separately; event modes require all eight limb joints. Missing observations
clear light state rather than generating stops or holds. Display smoothing never
changes these metrics. Translation cancellation does not reject camera zoom,
rotation, perspective, or confidently wrong poses; event detections still need
visual/musical review. Compare the same passage before choosing a teacher target.

The `/pipeline/study` index preserves V0 (original gain 1.3/fade 160 ms), V1
(automatic defaults), V2 (rejected recent-audio support gate), and V3 (strong
audio accents with Open controlling their amplitude). V3 is a listening candidate,
not an approved mapping. Its constant-amplitude control has the identical event
clock and can be matched for average brightness. All ten evaluation passages have
direct links. See `V2_RESULTS.md` and `V3_RESULTS.md` for evidence and limitations.
See `BRIGHTNESS_STUDY.md` for the user's acceptance criteria, source-separated
development/reserved manifest and overnight iteration log. V1 Auto derives gain
from strong movement; fade uses approximate audio BPM and low-level texture when
available, falling back to movement spacing. This changes an envelope's duration,
not beat phase/alignment. The parameters stay fixed for each excerpt. Manual
adjustments are per mapping; Auto restores the suggestions. Audio is decoded
silently, and source-video playback remains the only audible source.

```sh
python3 -m unittest discover -s research/dance -p 'test_*.py'
npx tsc --noEmit --incremental false
node research/dance/browser_smoke.mjs
node research/dance/test_reviews.mjs
node research/dance/solo_browser_smoke.mjs
node research/dance/movement_browser_smoke.mjs
node research/dance/raw_browser_smoke.mjs
node research/dance/test_smoothing.mjs
node research/dance/test_brightness.mjs
node research/dance/brightness_browser_smoke.mjs
node research/dance/test_music_defaults.mjs
node research/dance/test_timing.mjs
node research/dance/test_phrase.mjs
node research/dance/timing_browser_smoke.mjs
node research/dance/phrase_browser_smoke.mjs
```

Evaluation scripts and their timestamped reports are retained separately. The
V3 reserved evaluation has already been consumed once with frozen code; do not
rerun it as a tuning loop.

The raw-player browser check requires completed solo runs, writes only temporary
local screenshots, and checks timestamp alignment, controls, responsive layout,
absence of predictive requests, and API recovery. Older pipeline review checks
also save clearly labeled automated QA notes to their runs. All run headlessly.
`model_browser_smoke.mjs` describes the archived predictive view and no longer
applies to the redirected route.

Official extraction references:

- https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerOptions
- https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker
