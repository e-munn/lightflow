# Pose quality: model comparisons, September 23

The user asked for higher-quality skeleton mapping. The active extractor uses
MediaPipe Pose Landmarker Full, 33 landmarks, on a 1280-pixel-wide H.264 review
copy. The model sees a 256x256 body crop internally. Browser smoothing changes
only display coordinates; it cannot correct an incorrectly placed joint.

## Full versus Heavy — completed

Reprocessed three entire 30-second clips with the official Heavy model. Video,
audio and waveform bytes, every frame timestamp, confidence thresholds and
strict solo tracking were preserved. No extra smoothing or interpolation.
Existing run files were hashed before and after, and remained identical.

| Passage | Full whole-body coverage | Heavy coverage | Heavy processing time |
| --- | ---: | ---: | ---: |
| Beat Killer | 99.6% | 98.2% | 53 s |
| Crave You | 60.3% | 43.8% | 131 s |
| Feel the Way I Feel | 87.8% | 77.7% | 132 s |

Coverage requires all 12 major limb/torso joints with confidence >=0.5 inside the
frame and a reliable primary assignment. It is NOT a measure of joint-location
accuracy. Losses are largely arms: Crave You arm coverage falls from 60.8% to
44.3%, while leg coverage stays above 99%. Heavy is not a clear library-wide
upgrade and has not replaced Full.

Sampled review: four uniformly spaced frames per passage, plus four diagnostic
frames selected to expose recovered observations or large disagreements. In the
inspected Crave You uniform frames, Heavy still suppresses partly obscured arm
joints around 6 and 24 seconds. In Feel the Way I Feel at 20.204 seconds, Full
proposes two overlapping bodies and the solo gate blanks the pose; Heavy proposes
one plausible body. At 22.823 seconds Heavy recovers an arm that Full marks weak.
These selected recoveries do not outweigh the unmeasured losses elsewhere, and
are not proof of full-span anatomical accuracy. Beat Killer uniform poses are
mostly similar, with some changes in torso and arm placement.

Comparison page: http://localhost:3001/pipeline/pose-quality

- One source-video clock; switch original/candidate or overlay both.
- Raw extraction, no display smoothing; missing tracking remains missing.
- Frame stepping, seeking, fullscreen and source-video toggle.
- Heavy comparison browser checks passed on desktop/mobile, including shared
  timestamps, passage switching and original audio. No visible browser opened.
- The extraction worker now supports an explicit alternate model and byte-for-byte
  media replay into a NEW run. Normal pipeline defaults remain Full.

Reports: `pose-quality-benchmark-20260923T234729.json` and
`pose-quality-study-2026-09-23.json`. Model and review images:
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/pose-quality-20260923-rh_67oxv/`.

## Stronger independent candidate — RTMW, completed

Tested RTMW-l at 384x288 with a YOLOX human detector, through the authors'
rtmlib ONNX implementation. It estimates 133 body/face/hand/foot points. Its native
2D points are retained; exact shared body landmarks are mapped for comparison.
Unmapped MediaPipe landmarks remain missing, and placeholder z=0 must never be
interpreted as measured depth. Confidence scales differ between model families;
coverage at a shared numeric threshold cannot establish relative accuracy.

Full-body detection runs every frame, and no-person detection explicitly yields
missing data (the pose library's whole-frame fallback is disabled). The strict
solo identity policy remains. The experiment uses a fresh isolated SanDisk
runtime, with official model URLs, checksums and installed versions recorded.

| Passage | Full body coverage | RTMW body coverage | RTMW processing time |
| --- | ---: | ---: | ---: |
| Crave You | 60.3% | 93.7% | 95 s |
| Beat Killer | 99.6% | 100.0% | 37 s |
| Feel the Way I Feel | 87.8% | 100.0% | 92 s |

All 4,318 source frames were processed. These are 12-joint usability rates,
not positional-accuracy scores. Model confidence scales differ. Times cover
frame extraction, exclude model initialization/compilation, and are offline
processing times for 30-second clips, not evidence of live real-time throughput.

Inspected another 24 paired frames: four uniformly spaced and four deliberately
selected recovery/disagreement cases per passage. RTMW gives plausible wrist and
elbow locations where Full suppresses them in Crave You (7.257, 14.031, 23.674,
27.561 seconds). Feel the Way I Feel shows plausible recovered arms at 14.431,
22.806 and 27.928 seconds, and one body rather than Full's two overlapping
proposals at 20.187 seconds. Beat Killer is mostly similar; at 10.844 seconds,
RTMW puts the hip/torso connection higher, closer to the visible pelvis. This is
qualitative sampled review, not ground-truth annotation or full-span accuracy.

**New failure:** Crave You has 114 multiple-detection frames (6.3% of the clip),
versus none for Full. At the inspected 6.006-second frame the additional body is
a false detection on the furniture. The strict solo policy correctly leaves the
frame unassigned, but that creates a new tracking gap. Leg availability therefore
falls from 99.1% to 93.7%, despite the higher whole-body coverage. No detector
threshold was lowered, phantom body silently dropped, or missing pose filled in.

Recommendation: RTMW is the more promising candidate for recovering detailed
body/hand observations on this sample. Keep it selectable for review, with the
Full originals intact. Do not yet replace the entire library: the next extraction
improvement is reliable dancer association or a reviewed subject region, tested
on the false detections and genuine multi-person footage. Then quantify joint
placement on manually annotated frames and check temporal jitter before deriving
movement features. More confident points alone must not become better labels.

The comparison page now defaults to RTMW and includes all three passages for
each candidate. Original/candidate/both share a single video clock. Native hand
detail can be toggled. Seeking, frame stepping, hand visibility, original audio,
tracking gaps, same-source candidate switching, fullscreen and mobile layout
passed headless browser checks; TypeScript and 12 relevant unit tests passed.
The global pipeline extractor remains Full; no brightness algorithm was changed.

Reports: `rtmw-quality-benchmark-20260924T000613.json`,
`rtmw-quality-study-2026-09-23.json`, `rtmw-backend-parity-2026-09-23.json`.
New comparison images are in
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/rtmw-quality-qwnbxewf/review-62cm4z84/`.
The original run hashes, review-video bytes, audio bytes, waveform bytes and
frame presentation timestamps were verified unchanged.

## References

- Google model bundles/input shapes: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- Google legacy dance benchmark (motivation, not our measured accuracy): https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md
- Official RTMW models: https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose
- Lightweight inference implementation: https://github.com/Tau-J/rtmlib

## Runtime notes

The RTMW model archive downloaded slowly. The interrupted prefix was retained;
the remaining bytes were fetched with checked HTTP ranges into new files, then
assembled into a new archive and validated with ZIP CRCs. All model files and
partial transfers remain on SanDisk. No existing runtime was modified.

A CPU run was retained as a partial numerical reference, then cancelled before
new accelerated runs. On one fixed frame, CoreML/CPU raw output differences
were below 0.00005 for both models. Warm inference was about 25 ms per model.
The standalone CoreML test completed its predictions and report but aborted at
interpreter shutdown with a native mutex error. The isolated extraction worker
therefore closes/flushed output files and explicitly exits after successful
completion, skipping that native shutdown path. This is an offline worker
workaround, not evidence that a long-lived live CoreML service is production-ready.
Each run uses a new cache directory; earlier caches are never cleared or overwritten.

Decoded-output parity was also checked on the 480 frames retained from the CPU
run (7.99 seconds). Person counts, primary assignments and confidence-threshold
decisions matched. Among 78,869 mutually visible native points, median and 95th
percentile coordinate differences were zero after stored rounding; maximum
difference was 2.43 pixels at 1280x720. Maximum score difference was 0.0049.
This checks backend consistency on that prefix, not anatomical correctness.
