# Solo source screening and training-task deliberation

Date: September 21, 2026 (Los Angeles).

User request: find reliable solo dance channels, then deliberate with the
`lightflow - train` task. That task shared the user's newer preference for
Poppin John and Catgroove over Pumped Up Kicks. This screening follows that
preference and complements `YOUTUBE_SOURCE_MAP.md` without changing its history.

## Recommendation

Start with **Poppin John SBK** and **takeSomeCrime**. Both have promising solo,
full-body examples in the sampled material and match the user's preferred
expression. Channel membership never approves an entire upload for training.
Jardy Santiago remains an artist/source lead, but the sampled stage recording
is a poor first extraction reference. Lisa Rhee is at most a technical control;
the sampled upload contains a composited multi-person section.

## Evidence and limits

Public YouTube metadata verified the titles, uploaders and channel identities.
Seven videos were downloaded at up to 720p for screening, exclusively into:

`/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/source-audit-20260922T012338-m5g9vd4e/`

Source streams and metadata were retained. No existing SanDisk files were deleted
or overwritten. Each video has its own directory. Contact sheets are named
`screening-sheet.jpg` within those directories.

Visual judgments below come from **eight still samples per video**, not continuous
playback, verified A/V alignment, or a pose-quality audit. Typical sample times:
20, 25, 30, 35, 40, 60, 90, 120 seconds. Jardy's shorter clip uses 5–40 seconds
in five-second increments. The Marquese upload was downloaded before the other
task supplied the latest taste correction; it was retained but not promoted.
No new clip has been admitted as training targets or added to the processing
source registry by this screening.

| Channel / original upload | Observed in samples | Screening decision |
| --- | --- | --- |
| [Poppin John SBK](https://www.youtube.com/channel/UCKrOk6z473TunIzyYw0CUQw) — [Poppers Anthem / Egyptian Lover](https://www.youtube.com/watch?v=FVyUxo7VQqQ) | One dancer; head, hands and feet visible in sampled positions; bright clothing against colored vertical poles; broadly consistent composition. | Strongest next candidate. Continuously inspect a 30–45 s passage and run skeleton QA. |
| Poppin John — [AI Naafyish / Old School Electro 2023](https://www.youtube.com/watch?v=2EnI4bnVxP0) | One fully visible dancer; broadly consistent nighttime outdoor composition; lighting/exposure changes across samples. | Strong second candidate; monitor pose quality through lighting changes. |
| [takeSomeCrime](https://www.youtube.com/channel/UC9LsVV4g_5e_ImaW3W8ay-g) — [Catgroove](https://www.youtube.com/watch?v=twqM56f_cVo) | One dancer in a room; full body visible in samples; stable-looking background; older, softer image and dark clothes reduce joint detail. | Strong taste anchor and next extraction candidate; visibility does not guarantee accurate joints. |
| takeSomeCrime — [Lost in the Rhythm](https://www.youtube.com/watch?v=IJmhRuuEmnw) | One fully visible dancer in a room. Background reverses between the 40 s and 60 s samples, consistent with a mirror edit/cut. | Candidate 20–40 s span only pending continuous inspection. Locate and split at the actual edit; do not bridge it as movement. |
| [Jardy Santiago](https://www.youtube.com/channel/UCiNdC0nUvtSTW1GPWluuJJA) — [Hip Hop Dancefest 2009](https://www.youtube.com/watch?v=8DN_Afsctn4) | Dark stage; another person is visible behind the main dancer; low detail; travel reaches the frame edge. | Defer this particular recording. Seek brighter, empty-room solo freestyle from this channel. |
| [imlisarhee](https://www.youtube.com/channel/UCIda6ijXAcziDMH1saI-3dg) — [NewJeans Ditto cover](https://www.youtube.com/watch?v=hhu5YMzAZFQ) | Bright room, full body and clear solo framing initially; at 120 s two composited dancers are visible. | Technical control only, selected solo spans; not a new artistic anchor and not whole-video approval. |
| [MARQUESE SCOTT](https://www.youtube.com/channel/UCSiO9HSviL3d9WOCHcY8F-Q) — [Pumped Up Kicks](https://www.youtube.com/watch?v=LXO-jKksQkM) | Download and metadata available; no additional acceptance claimed. | Deprioritized under the user's newer taste correction. |

## Deliberation with “lightflow - train”

The other task reviewed the current tracker and source evidence without editing
files or switching the shared checkout. Its critique and our conclusion:

1. **Select one visible intended person, not merely one active dancer.**
   Spectators, mirrors and composites can produce additional detections. Use a
   manually selected fixed crop only where it keeps the intended person's full
   body and travel visible. Missing/ambiguous tracking must not silently reacquire
   another person or become a stillness label.
2. **Separate tracking coverage from correctness.** The existing Kyla run's
   417/480 coverage is not identity accuracy. The user observed identity failures.
   Proposed page readouts: required-landmark coverage, model confidence,
   human identity review (not audited / sampled / whole span), identity switches,
   and timing/edit flags. These are recommendations, not implemented changes in
   this source-research turn.
3. **Preserve expression beyond speed.** Inspect torso, arm and leg articulation
   separately from global travel before projecting to brightness. Mean speed can
   erase a held pose or hide small isolations; acceleration can amplify jitter.
   Avoid training a new volume meter or forcing every dance into beat flashes.
4. **Smallest useful experiment:** screen six 30–45 s passages, three each from
   Poppin John and takeSomeCrime with distinct tracks/routines where possible.
   Audit the entire selected spans and skeletons; mark visible arrivals, stops,
   holds and transitions. Try two explicitly authored brightness hypotheses on
   two development spans, freeze them, and compare on four untouched spans
   against the preferred stereo scope and loudness-only baseline. Use shifted or
   wrong-audio controls. Six excerpts test feasibility, not generalization.
5. **Expand based on behaviors, not channel quotas.** Add groove, quiet
   articulation, connected waves, accents with holds and phrase transitions.
   Jardy, Slim Boogie, Hoan and Boogie Frantick are complementary search leads.
   A clean clip in a different genre need not be an artistic teacher.

## Research references raised in the discussion

- [Follow the Music: Dance Motion Synthesis Corresponding to Arbitrary Music](https://www.cs.ubc.ca/~rozentil/data/music2dance.pdf),
  section 4.1, describes collecting nearly fixed-camera, single-dancer, full-body
  videos from Poppin John and Marquese Scott. This supports acquisition
  feasibility. Its motion generation followed by music warping is not evidence
  for causal audio-to-light judgment; do not copy its coarse subsampling for
  precise attack timing.
- The training task suggested [AIST++](https://google.github.io/aistplusplus_dataset/factsfigures.html)
  as a technical motion/pose reference, separate from the user's aesthetic
  anchors. No dataset files were fetched or validated in this screening.

Next action is continuous passage and skeleton review on the two priority
channels. No model training or brightness-ground-truth claim follows from this
discovery pass.
