# First movement-to-light study

Branch goal: use dancers' timing, controlled holds, anticipation, and fluid
transitions to develop a live **audio → one brightness value** model. Dance video
provides development evidence. This study supplies a reviewable intermediate
experiment; no dance-conditioned model was trained.

## Saved studies

| Passage | Analysis ID | Movement coverage | Proposed arrivals | Proposed holds | Proposed transitions |
| --- | --- | ---: | ---: | ---: | ---: |
| Poppin John — AI Naafyish, source 20–50 s | `a535f65d-67e9-43eb-aee9-59928a59fd7c` | 97.1% | 15 | 13 | 4 |
| takeSomeCrime — Lost in the Rhythm, source 20–40 s | `f1424a9e-157e-4636-8f89-6ae6977d6c33` | 93.7% | 21 | 0 | 10 |

Movement coverage counts frames with valid speed derivatives after strict pose
masking and segment-edge exclusion. It is not identity accuracy or an artistic
quality score. Differences in cue counts describe these rules, not the dancers'
actual intention. A clip with no detected holds may still contain subtle holds.

Each study lives in a new JSON under the associated run's `analyses/` directory:
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs/`.
Original media, poses, previous runs and review records were preserved.

- [Review Poppin John](http://localhost:3001/pipeline?run=86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6)
- [Review takeSomeCrime](http://localhost:3001/pipeline?run=4dfc1567-13d2-4127-b6fe-741fad199982)

## What can be judged now

Play the passage once while looking at the skeleton and the compact lights below
it. In **Movement → light**, switch between **Accents + held poses** and
**Extension + motion**. Compare both with the existing stereo-scope brightness
reduction and the RMS reference on the same source audio. Scrub the aligned
feature traces and inspect each proposed cue, recording evidence for keeping or
rejecting it. Paused brightness is frozen for inspection.

Review whether a proposed arrival is a real controlled stop, whether a hold has
intentional stillness, and whether continuous movement survives the projection.
Check whether the resulting light is musically useful, not simply correlated with
the skeleton. Neither mapping is selected as a target by this implementation.

## Timing and representation

Features use aspect-corrected image-plane coordinates, a torso-relative center,
and a fixed median torso scale. Center travel is measured separately. Local line
fits in ±60 ms windows preserve constant-velocity motion on irregular PTS; a test
caught the timing bias of a simple sample mean before the saved studies were run.
Central speed derivatives use elapsed timestamps. No derivatives cross gaps,
cuts, missing joints, or track changes. No gap gets a synthetic darkness target.

Observed feature lookahead was 83.4 ms for AI Naafyish and 66.7 ms for Lost in the
Rhythm. Cue rules and within-passage percentiles use more future context. These
figures therefore do not describe end-to-end latency or a causal live model.

Audio comparisons use trailing 20 ms windows at 50 Hz, from the extracted audio
decoded at 48 kHz. Scope code was reused unchanged, exposure 40, soft curve on.
RMS mapping uses fixed gain, not a per-clip fit. Source perceptual A/V alignment
has not been independently certified.

## Verification and limits

Fifteen Python tests cover identity association, visibility, stationary holds,
translation separation, scale invariance, uneven timestamps, missing observations,
and segment isolation. TypeScript passes. Headless browser checks exercised saved
analyses, source-audio comparisons, exact displayed-frame projection values,
mapping switches, missing boundary handling, cue review persistence, exclusion of
automated reviews, invalid-cue rejection, playback, frame stepping, and responsive
layout. Desktop/mobile screenshots were inspected.

The candidate cues remain unreviewed. Existing visual reviews are sampled checks,
not continuous identity certification. Browser QA records are labeled automated.
Do not treat any of these outputs as verified human lighting labels.

Next experiment: continuously review the selected material, evaluate/correct cue
suggestions, and compare the two authored mappings against the unchanged audio
references. Then expand to the proposed six passages with separate development
and held-out tracks before considering a frozen projection or model training.
