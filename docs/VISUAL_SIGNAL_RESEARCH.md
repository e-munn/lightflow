# Visual signal research

Research branch: `codex/new-research`.

**Before training, read [TRAINING_GOAL.md](TRAINING_GOAL.md).** It records the
current model-output direction and supersedes older output assumptions:
amplitude plus additional interpretable dimensions, mapped by medium-specific
adapters. Preserve rich source behavior even when the first renderer uses only
brightness and color.

**Guiding foundation: stereo scope.** The user considers it the most successful
and reliable program tried so far because it responds finely and sensitively to
detailed musical expression. Preserve that responsiveness as the quality
baseline. The model should build on it with more controlled expression across
media. Judge learned additions by whether they improve control while retaining
detail, sensitivity, and timing; instrument labels are supporting tools rather
than the central objective. See the canonical goal for the evaluation criteria.

## Storage safety

User instruction: NEVER delete anything on SanDisk ExtremePro
(`/Volumes/ExtremePro`). Use additive, copy-only organization; never overwrite
existing files. Preserve Downloads originals and verify copied media with
checksums. Follow the drive's `VIDEO-PROJECTS.md` asset layout and source ledger.
Keep all heavy content for this project on ExtremePro: source videos, full-set
audio, render recordings, datasets, and training artifacts. Small source code,
documentation, and lightweight TouchDesigner project files may remain local.
Use the full Of The Trees live-show audio as input to the visual library.

## Objective

Collect live performances, light choreography, and audio visualizers; extract
clean, time-aligned observations of light and pixel behavior; use those
observations to train an audio-conditioned model. Preserve spatial patterns,
cue timing, holds, blackouts, movement, and transitions rather than reducing
the target to a global brightness curve.

This is a new research direction. Existing Director experiments are baselines,
not evidence that this approach works.

## Source exclusion

Per user direction, exclude RPMC-L2 from this research effort: no source data,
derived features, training labels, or initialization from RPMC-L2-trained
checkpoints. Existing files and experiments remain historical artifacts only.
Build the new corpus from viewable source footage so extracted behavior can
be checked against the actual performance.

## First experiment

Start with a small, manually reviewed corpus spanning all three source types.
Choose representative examples with the user before scaling collection.
Record source URL or local path, creator, source type, acquisition date, usage
terms, content hash, show identity, track identity when known, and timestamps.
Keep original media immutable and all transformations reproducible.

1. Inspect streams and retain original audio/video presentation timestamps.
   Record suspected synchronization offsets and confidence; do not assume
   every light cue should coincide with an audio onset.
2. Segment footage into shots. Mark stage/screen regions, occlusions, overlays,
   camera movement, exposure changes, and unreliable intervals for review.
3. Extract spatial RGB/luminance observations, region masks, temporal changes,
   and candidate motion/cue events. Retain timestamps and confidence alongside
   every target. Preserve the highest useful temporal resolution in the source.
4. Compare source footage and extracted behavior side by side. Check that
   blackouts, flashes, holds, sweeps, and transitions survive processing.
5. Admit reviewed segments to a versioned dataset. Keep rejected segments with
   reasons and uncertain segments out of the initial training set.
6. Train a small causal audio-to-visual-sequence baseline only after the
   extraction passes review. Compare with constant, loudness-only, and
   shuffled-audio baselines on held-out shows and tracks.

## Representation and cleaning hypotheses

User refinement: edited concert footage may teach audiovisual direction even
when clean physical-light recovery is infeasible. Retain a separate editorial
sequence (camera cuts, shot duration, view changes and pacing). A cut invalidates
a continuous lighting measurement across that boundary; it remains a potentially
valuable target for musical attention/pacing. Test cross-task transfer rather
than assuming edit decisions equal lighting decisions. The current corpus is
electronic-first; test unseen artists/shows within that domain and report genre
generalization separately.

The later Jack White download adds a first rock comparison (Pine Knob, date
inferred from filename). It is reserved outside the electronic training pilot.
Sampled frames are monochrome and show edited band/stage/crowd/drummer views;
consider intensity, phrasing and editorial targets with uncertainty, and mask
color as unavailable. This addition does not establish cross-genre performance.

- Use a spatial target (such as a coarse RGB grid plus validity mask) alongside
  interpretable cue/region annotations. Select resolution from pilot evidence.
- Keep concert footage, authored choreography, and procedural visualizers
  identified separately. Their supervision has different uncertainties.
- Video pixels are observations, not calibrated fixture intensities or recovered
  DMX commands. Unknown exposure and occlusion must remain explicit.
- Stabilize or rectify only where correspondence is defensible; exclude cuts
  and unusable regions instead of inventing continuous motion across them.
- Avoid unconditional temporal smoothing or per-frame brightness normalization:
  the pilot must demonstrate that cleaning preserves intended flashes and holds.
- Keep true dark frames distinct from missing or masked observations.
- Store extracted observations separately from inferred cue labels, with an
  extractor version and evidence for each inference.
- Group duplicate uploads and excerpts before splitting; reserve whole shows
  and tracks for evaluation to limit leakage across adjacent clips and sources.

## Pilot deliverables and decision

A source manifest, reproducible extraction command, reviewable source/target
comparisons, accepted/rejected segment manifest, and dataset specification.
Report retention rates, synchronization uncertainty, and reviewed extraction
errors by source type. No model-quality claim follows from cleaner-looking
signals alone: held-out musical behavior and user evaluation decide whether
to scale.

## Decisions still needed

- Initial reference performances, choreography, and visualizer styles.
- First output surface: spatial pixel canvas, physical fixtures, or both.
- Available source files and preferred acquisition sources.

Confirmed goal: live microphone or system audio, causal prediction on unfamiliar
music, precise timing, and human-level musical judgment. Personalization is
deferred. The stereo scope supplies the sensitivity baseline; it is not the
completed director. See TRAINING_GOAL.md for the full success criteria.

## User-selected creator references

- @syncopamusic: https://www.tiktok.com/@syncopamusic/video/7656674050550320415
  User identifies this creator lane as effective song-to-visual mapping.
  Candidate reference only: web retrieval could not access this clip; its
  actual visual content, original visual authorship, and source media remain
  unverified. Review a playable copy before making extraction decisions.
- Evaluate short-form song-to-visual examples as a distinct corpus alongside
  concerts. Review accent timing, sustained motion, sound-to-shape relationships,
  phrase transitions, and repeated motifs; these are proposed review dimensions,
  not observations about the linked clip. Retain creator and track grouping
  for held-out evaluation, and distinguish original visuals from reposted edits.
