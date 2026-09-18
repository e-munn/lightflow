# Concert cues: evidence before labels

The user proposes concert video and TouchDesigner as complementary teaching
sources. The full objective remains a causal, musically intelligent live model.

User refinement: the video edit is itself potential supervision. Camera cuts,
shot holds, close-up/wide transitions and overall editing pace can carry musical
judgment. Keep them as a separate editorial stream, even where they disqualify
cross-shot lighting measurements. The current nine-show corpus is electronic;
electronic-first evaluation is the immediate scope, not evidence of broad genre
competence. Exact recovery of lighting-desk commands is not a prerequisite.

Three supervision paths:
1. Known procedural mappings in TouchDesigner/the stereo scope: exact signal
   response and rendering controls, with explicitly synthetic provenance.
2. Concert footage: noisy observations of authored lighting and visuals,
   useful for cue timing, duration, spatial changes, builds, holds and releases
   only after camera/visibility review. Do not equate raw video RGB with DMX.
3. Editorial direction: detected/verified cut times and shot holds; later view
   type and reveals. These are observed/inferred editing decisions, not verified
   individual lighting-engineer choices. Their transfer to lighting is a research
   hypothesis requiring playable comparisons and human evaluation.

Current extraction pilot: four coarse stage regions, observed luminance,
coverage and hue at 30 Hz. Exposure and screen content remain mixed with lighting.
A 12-second review reel overlays source and extraction. The initial four seconds
are provisional; ZERO frames have been admitted as training targets. An initial
edge-change detector missed known cuts: manual shot boundaries are required
until a detector is verified against reviewed footage.

## Sources received

Of The Trees: Ultra Miami 2026 and Electric Forest (earlier batch).
New evening batch: Skrillex at Ultra, Whethan at EDC Las Vegas 2026, and Levity
at Coachella 2026. Titles are inferred from supplied filenames, not independently
verified show metadata. MP4s remain in Downloads; unique verified copies are in:

`/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26-evening/`

Skrillex and Whethan duplicate downloads are byte-identical and preserved. No
incomplete downloads are treated as sources. Model experiment 1 used none of
these new shows. Keep at least one distinct artist/show as a future holdout;
track-disjointness still needs track identification and duplicate audio checks.

## Reviewed still samples

Skrillex: 05:00, 15:00, 30:00, 45:00, five frames per span at 2 s spacing.
Wide views show beam arrays, red washes and spatial stage patterns. Many spans
also contain crowd/DJ shots or view changes. Whethan at those same four offsets
includes large stage graphics and wide lighting views mixed with close-ups,
crowd views and aerial imagery. These stills do not establish stable long shots
or reliable audio/lighting synchronization. Review continuous clips before labels.

Levity at the same offsets: 15:00–15:04 has wide views of beam arrays, followed
by a close view of the stage screen; 45:02–45:08 has a wider crowd/stage view
with a sustained amber look. Both are candidates for continuous review.
05:00 and 30:00 samples have rapid performer/screen changes and are poor
starting points for a single stable mask. The show's measured duration is
65:30.79; Skrillex 77:50.72 and Whethan 59:27.98. All are 1080p stereo.

## Next extraction design

- Annotate camera shot boundaries, wide-stage visibility and stable ROI masks.
- Keep physical beams/washes and LED-screen graphics in separate masks where
  visually defensible. Retain both source types with explicit provenance.
- Use raw within-shot changes and relative region distribution; retain original
  intensity alongside any normalized representation. Never normalize every frame
  independently: that erases real builds, darkness and contrast.
- Flag global exposure ambiguity, clipping, haze/occlusion and camera movement.
  Missing/ambiguous measurements get masks, not invented dark or smooth labels.
- Propose cue intervals with start, end, affected regions and change type.
  Compare synchronized source/cue replays and manually review a small corpus.
- Verify audio-video timing and sample precision; a camera cut is not a cue.
- Train only after the labels survive review. Human-level judgment requires
  full musical sequences and held-out rendered evaluations, not isolated flashes.

Use exclusive output destinations. No deletions or overwrites on ExtremePro.

## Further sources added

A further verified batch adds Mochakk (59:33.88), REZZ (55:39.49), Subtronics
(61:33.13), all Coachella references, under `reference/9-16-26-190621/`.
Skrillex at Lollapalooza Chile 2026 (90:45.87, 1080p60 stereo) is under
`reference/9-16-26-190917/`. All nine concert sources total 10.15 hours / 17.21 GB.
Every imported copy is hash-verified; originals and duplicate downloads remain.

REZZ sampled shots show spatial stage geometry and beams mixed with a large LED
screen and performer views. Skrillex Chile samples include repeated horizontal
light rows with less screen coverage in some shots, worth testing for physical
fixture observations. Samples are stills, not accepted temporal supervision.

See SHOT_DETECTION.md: both home-built cut gates failed review. The dedicated
TransNet V2 trial identified four visually confirmed cuts; full-show inspection
is the next dataset preparation step. ZERO concert frames are accepted labels.

## Jack White: first rock reference

User-selected download added and SHA-256 verified in
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/9-16-26-193630/`.
Filename attributes it to Jack White at Pine Knob, July 25, 2026; show identity
and date are not independently verified. Duration 1:55:04.36, 1920×1080 at
24000/1001 fps, stereo AAC at 44.1 kHz, 2.709 GB. Audio and video stream starts
are both 0; this does not prove perceptual synchronization.

Review sheet samples 11:30, 34:30, 63:10 and 92:00 at two-second intervals.
All twenty reviewed frames are monochrome. Band/stage, crowd and drummer views
appear, with cuts within multiple sampled spans. This is a candidate for
brightness/spatial/editorial observations and a first rock audio comparison;
color must be marked unavailable, not inferred as the actual fixture color.
Reserve outside the current electronic training/validation/test pilot as an
exploratory genre holdout. No Jack White training targets have been accepted.
An H.264 reference-frame warning occurred during a seek for still extraction;
the sheet rendered, but a full decode integrity check has not been performed.

The corpus now has ten unique concerts, approximately 12.07 hours / 19.92 GB:
nine electronic references and this first rock reference. Original Downloads
files, all duplicates and all prior SanDisk files remain intact.

## Wide-shot batch and matched alternate recording

Four further completed user-selected downloads were copied with verified hashes
to `reference/9-16-26-194931/`: Ravenscoon (60:05.36), ALLEYCVT (73:24.66),
Levity (79:54.41), and Of The Trees (77:45.98), filename-attributed to Electric
Forest. Four sampled spans in each recording retain wide stage views. They
offer clearer camera coverage than the edited references, although exposure,
screen content, foreground lights/totems, camera movement and crowd sound remain.
Stills alone do not establish continuous full-show stability or audio quality.

Spectral audio matching identifies the new Of The Trees recording as an alternate
view of the existing Forest performance. Seven discriminative 60-second anchors
fit reference time = 0.999961923 × wide-video time − 9.969477 seconds (100 ms
feature grid; maximum fitted-anchor residual 37 ms is not an accuracy guarantee).
A dense 39-window check also finds ambiguous repetitive sections. Do not apply
this mapping indiscriminately to the entire recording or infer physical audio-
to-light timing from it. Audience sound travel and source A/V delay are unresolved.
Both recordings MUST share a split; see `source_groups.json`. The first alignment
run produced invalid NaNs and is preserved with a REJECTED note; v2 uses its 22
finite spectral bands and records the correction.

The corpus has 14 distinct concert video files; at least two depict the same
performance, so file count is not independent-show count. The new fixed-view
extraction pilot covers 42:40–43:40 of Forest, with stage-interior regions and
side graphics measured separately, outside the existing Forest training split.
It remains provisional until continuous visibility and timing are reviewed.
