# First strict-solo extraction results

Four new runs, 110 source seconds, 3,539 decoded frames. All earlier SanDisk
media and runs were preserved. Source start times below are seconds in the
original upload; review-page timestamps start at zero for each passage.

| Passage | Source interval | Frames | Primary assignment | All required joints usable | Multiple-body detections |
| --- | --- | ---: | ---: | ---: | ---: |
| Poppin John — Poppers Anthem | 20–50 s | 720 | 720 / 720 | 475 / 720 (66.0%) | 0 |
| Poppin John — AI Naafyish | 20–50 s | 720 | 720 / 720 | 710 / 720 (98.6%) | 0 |
| takeSomeCrime — Catgroove | 20–50 s | 900 | 782 / 900 | 561 / 900 (62.3%) | 118 |
| takeSomeCrime — Lost in the Rhythm | 20–40 s | 1,199 | 1,199 / 1,199 | 1,153 / 1,199 (96.2%) | 0 |

“Usable” here is a confidence/visibility rule, not verified anatomical accuracy:
all 12 major torso/limb landmarks must be inside the image and have
min(visibility, presence) >= 0.5. No identity-accuracy percentage is claimed.
There were no automatic cut flags or sustained-loss lockouts in these runs.

## Visual observations

Twelve skeleton-overlay stills per run were inspected, distributed across each
passage. These are explicitly **sampled** reviews, saved through the pipeline API
with reviewer `assistant`. They do not certify uninspected frames or A/V alignment.

- **AI Naafyish:** all sampled primary overlays remain on the sole dancer;
  coarse limb alignment looks plausible. This is the strongest next review clip.
- **Lost in the Rhythm:** all sampled primary overlays remain on the solo dancer;
  some crossed/raised limbs have missing points. This selected interval precedes
  the background reversal previously seen between 40 and 60 seconds of the source.
- **Poppers Anthem:** identity looks stable in the samples, but turns hide limbs;
  this explains why assignment coverage is much higher than required-joint coverage.
- **Catgroove:** the detector mistakes clothing/furniture at the right edge for a
  second body at sampled clip times around 3 and 23 seconds. The strict solo gate
  withholds assignment rather than choosing among those detections. Retain as a
  difficult extraction example; a clean solo video does not guarantee clean poses.

## Open in the local pipeline

- [AI Naafyish](http://localhost:3001/pipeline?run=86dab5e0-9793-4cb4-8a1a-5c9c7f0c04f6)
- [Lost in the Rhythm](http://localhost:3001/pipeline?run=4dfc1567-13d2-4127-b6fe-741fad199982)
- [Poppers Anthem](http://localhost:3001/pipeline?run=96a6261e-136b-4c4b-87ca-9d425079cf90)
- [Catgroove](http://localhost:3001/pipeline?run=2d98c61d-d130-4235-95a1-af2f38796e0a)

All run folders live under:
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs/`.

The page now includes separate quality metrics, append-only identity checks,
automatic source/run switching, run deep links, and skeleton timing tied to the
browser's presented video frame. The visual check caught and corrected a seek
race that briefly placed a new skeleton on the previous decoded video frame.

Validation: nine Python tracking/visibility tests, TypeScript check, identity
review unit cases, and headless browser checks for source selection, seeking,
overlays, review persistence, automated-review exclusion and responsive layout.
Saved QA review records are labeled `automated`, not visual judgments.

## What remains

These four clips are the first extraction pilot, not the six-passage hypothesis
comparison proposed in the source deliberation. Next: continuously inspect the
two strongest spans, mark visible arrivals/holds/transitions, then compare explicit
brightness projections against the unchanged stereo-scope baseline. No new
brightness mapping or trained audio-to-light model is claimed here.
