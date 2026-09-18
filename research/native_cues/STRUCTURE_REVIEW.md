# Sustained-state supervision: candidate review

The previous turn completed a trained recording-augmented model and rejected its
transfer quality. This turn inspected whether the existing native observations
support the missing holds/builds/releases vocabulary. No model was trained and
no new training labels were admitted.

## Scan

Use fourteen existing four-minute clips, eight-second windows every two seconds.
Require full valid geometry, no frame gaps >50 ms, 95th-percentile worst-region
clipped-pixel fraction <=.02, and maximum <=.05. Candidate stable appearance:
energy interdecile range <.08 and mean between .08 and .85. Candidate rising or
falling appearance: end-two-second versus first-two-second median change >.18
in magnitude, with at least six of seven one-second steps moving in the chosen
direction or reversing by no more than .025. These are review heuristics, not
annotations of musical intention. They do not change the original observations.

Of 1,624 overlapping windows: 861 failed geometry/gap checks, 687 failed clipping,
69 passed quality but not the proposed descriptors, and seven matched a candidate
descriptor. No rising candidate survived. These numbers describe this strict
scan, not the prevalence of musical builds in the shows. Overlapping windows are
not independent examples. Four non-overlapping representatives across shows were
rendered as eight-second stereo source clips and 16-frame measured-region sheets.

## Agent visual review

Scope: all 64 sheet images, sampled every .5 seconds, with registered region
boundaries. Full clips were rendered and stream-checked, but continuous playback,
audio listening and human musical-quality review have not been completed.

| Span | Observation in sampled source frames | Training decision |
|---|---|---|
| GRiZ 1949–1957 | Measured upper side regions stay mostly dark while lower stage colors, haze and lights change. Stable regional energy does not mean the lighting system is holding. | Reject as an intentional hold label. Keep only a regional stable-appearance example. |
| ALLEYCVT 1825–1833 | Cyan activity recedes in the measured interior while the bright blue outer structure persists; 78 native appearance edges occur in eight seconds. | Not a smooth release/ramp label. Mixed fast events and declining regional occupancy. |
| Forest 3209–3217 | Interior rows of lights flash, then disappear around the middle of the span while illuminated border graphics remain. Later thin beams appear. | Candidate pattern transition, not an eight-second fade or whole-stage blackout. No admission yet. |
| Ravenscoon 2011–2019 | Red interior activity drops while side areas remain red; blue elements persist and white beams appear near the end. | Candidate partial-field transition, not global release/blackout. No admission yet. |

The sample review establishes a mismatch between proposed state names and the
measured field, not the engineer's intent. The displayed green boundaries are
existing measurement regions; they are not an exhaustive fixture segmentation.

## Consequence

Do not manufacture holds from no edges or ramps from a median trend. A useful
next representation should separate background/persistent field from active
pattern occupancy, fast modulation and spatial redistribution. Sustained-state
labels must refer to a defined region/pattern and retain observability limits.
For transition examples, inspect native-rate sequences and the associated music
before assigning an interval or timing target. Broader scene context is needed
to distinguish a partial-field rest from a full lighting blackout.

This review suggests why adding a hold head to the present labels would be
premature. It does not invalidate every prior weak appearance-edge observation.
The original goal still requires learned phrase-level decisions, unfamiliar-music
comparisons, human review and physical end-to-end timing.

## Artifacts

All new output is in `/Volumes/ExtremePro/Code/lightflow/research/native_cues/structure_review_v1/`:
`candidates.json`, `review_artifacts.json`, four MP4 source excerpts and four
`_sheet.jpg` contact sheets. Each excerpt has stereo audio and verified video
duration within 50 ms of eight seconds. All prior SanDisk assets are preserved.
Reproduce with `structure_candidates.py --out <NEW_DIR>`; rendering currently
uses this review directory explicitly and refuses existing output files.
