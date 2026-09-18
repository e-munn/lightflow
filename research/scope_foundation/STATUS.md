# Scope foundation — status 2026-09-16

The full goal is active and NOT achieved. Canonical requirements are in
../../docs/TRAINING_GOAL.md. Personalization is deferred.

Latest trained candidate: ../native_cues/MODEL_RESULTS.md. Fourteen four-minute
clips now retain all 100,688 source-frame timestamps with separate screen/light
fields and masked geometry; 126 source/mask frames were sampled for review. A
fresh four-head causal model is trained, saved and runnable on other files.
It beats controls on Levity validation but underpredicts Forest changes and fails
its loudness/prior/wrong-history development comparisons. Reload, causality and
file-inference checks pass. The original scope remains the live reference; a separate experimental
streaming comparison is now available (see below). The following sections preserve earlier milestones.

Volume follow-up: ../native_cues/GAIN_RESULTS.md. Constant-gain augmentation
produced a second saved model and reduced Forest Brier from .3323 to .3194,
but simple controls still win and shifted audio remains equally effective.
Recording gain is a nuisance, not a sufficient fix. Both trained candidates and
their verification are preserved; the next comparison must assess actual
expressive modulation, not mistake cue probabilities for a light show.

Actual offline light-output comparison is now available:
../native_cues/MODULATION_RESULTS.md. Two fixed one-minute Forest/Jack White
videos compare direct, learned, simple-context and delayed-model conditions with
the same renderer. The fixed learned adapter changes brightness/spread gently
while preserving the fast direct path; human musical-quality review remains
open. Seventeen tests and frame/audio/export checks pass. No quality promotion.

Latest audit: ../label_audit/RESULTS.md identifies sampling-sensitive flashes,
GRiZ screen-dominated crops, mixed Ravenscoon screen/beam crops, and a 300 ms
contrast definition that timestamps short-flash releases late. The next dataset
must address temporal resolution and target meaning before more cue training.
Existing observations and models remain preserved; nothing new is deployed.

The correction pilot is now implemented: ../native_cues/RESULTS.md. All 6,595
source timestamps match independent metadata; six synthetic edge/timing tests
pass. Nineteen event triptychs and six spatial-mask frames were reviewed. Separate
candidate light/screen fields reduce clipping in three of four sampled spans,
but remain partial weak observations. Longer mask review and a versioned training
dataset are still required before the next model run.

## Implemented and observed

- `/scope`: stereo XY reference, direct lighting adapter, and forecast-assisted
  adapter on identical audio. File playback, microphone and display-audio paths.
- Stereo-preserving trailing 20 ms feature extraction; shared JS between
  training extraction and AudioWorklet. Nothing imports old RPMC-L2 models.
- New MLP trained from scratch on the first 70% of Ultra Miami audio; later
  portion validates after a 10 s purge. Forest and three local tracks test only.
- Two forecast horizons (100/260 ms) for amplitude, spread, texture and attack.
  Exported JS inference matches PyTorch within 7.1e-8 on saved held-out cases.
- Core tests cover phase/mono distinctions, silence, gain-independent spread,
  finite causal history, identical prefixes with different futures, and gating.
- Headless browser: stereo file and inference, all views, blackout/stop, simulated
  microphone, no-audio display capture cleanup, mobile and audio range requests.
  Initial fake microphone carried silence: this tests transport, not onset response.

## Model evidence and important failure

Mean error across eight audio-descriptor targets:

| Held-out source | Learned MSE | Persistence MSE | Training mean MSE |
|---|---:|---:|---:|
| Electric Forest | .01888 | .03098 | .03231 |
| Calabria | .04347 | .07381 | .05095 |
| Damn Right | .04616 | .06767 | .04974 |
| McDonalds | .02977 | .04041 | .05589 |

All sources also beat a 17-second wrong-history shift on aggregate MSE. This
supports synchronized audio conditioning, not human-level musical direction.
At an attack threshold of .2, the 100 ms forecast finds only 5.0% of actual
attack frames on Forest (32.4% precision). Other tracks recall 1.7–8.4%.
The model smooths difficult events. Lower regression error is NOT success at
anticipating accents. Direct measured attacks remain in the render path; the
model only supplies a small bounded amplitude preparation in this experiment.
`accepted_channels` means validation MSE improved by >5%, not quality approval.

Initial file-playback browser timing: p50/p95 compute .10/.20 ms; estimated
sample-to-audible-aligned draw offset 9.7/16.4 ms. Audio-clock age was 184/192 ms
because file visuals intentionally wait for estimated audible playback. These
are headless software estimates, not physical microphone-to-photon measurements.
Actual system audio, room microphone, fixture latency and DMX remain unverified.

## Concert footage path

Clean procedural/TouchDesigner mappings can preserve signal sensitivity. Concert
footage can supply weak evidence about authored cue timing and longer musical
phrasing. Keep those target types separate and use confidence/missing-label
masks. Do not train a full-video RGB predictor and call it recovered choreography.

A 40-frame contact sheet samples eight moments in Of The Trees shows. Many
10-second spans switch between wide stage, DJ close-up and distant views.
A 12-second source/region comparison exists for Ultra 10:00–10:12. Only its
first four seconds have a provisional stage mask; ZERO seconds are accepted
training labels. Regional luminance, coverage and hue are raw observations.
Automatic discontinuity detection failed to flag the known shot changes in
this pilot; it is not a usable rejection filter yet. Exposure, screens, moving
beams, occlusion and AV synchronization remain unresolved.

## Next work toward the actual goal

1. Audit whether the current observed event labels mean comparable things across
   shows. Frozen music features failed to transfer, and the event positive rate
   doubles from training to Forest. Separate camera/extraction effects from
   real differences in lighting decisions before another model run.
2. Improve supervision using reviewed cue sequences or clearly identified authored
   demonstrations. Include rests, holds, builds and releases with duration and
   uncertainty. Keep procedural demonstrations distinct from human choices.
3. Require learned additions to beat synchronized simple controls and wrong audio,
   preserve scope detail, and improve complete playable performances under human
   review. Probability scores alone do not establish musical judgment.
4. Reserve a fresh performance and audit track overlap for final evaluation;
   Forest is now repeatedly inspected development data.
5. Exercise actual system/microphone input, measure physical end-to-end timing,
   and adapt the output contract to a calibrated DMX rig.

## Artifact locations

All heavy outputs are on ExtremePro, with exclusive new destinations:
- Code/lightflow/research/scope_foundation/run_2026-09-16_1858/
- Code/lightflow/research/scope_foundation/browser_2026-09-16_1920/
- Code/lightflow/research/concert_cues/shot_review_2026-09-16/
- Code/lightflow/research/concert_cues/extraction_pilot_2026-09-16/

Local active-run.json selects the external model. No source or existing external
artifact was deleted. The preview reads external audio with byte ranges and does
not copy hour-long media to the local project.

## Continuation update

A causal event TCN was trained and evaluated; see ../event_forecast/RESULTS.md.
It increases recall but produces too many false predicted accents and fails
cross-track rhythm/wrong-history controls. Not deployed. The two heuristic
camera-cut gates failed visual review; a dedicated TransNet V2 trial yielded four
visually confirmed cuts. Full scans of Levity, Whethan, REZZ and Skrillex Chile
are complete; see ../concert_cues/SHOT_DETECTION.md. The subsequent editorial
model failed its baselines and remains offline; see ../editorial/RESULTS.md.
These are research advances, not proof of the full director goal.

Non-silent live-path verification is now complete with synthetic signals:
`live_input_2026-09-16_v1/report.json` on the external research drive. Mono
mean spread 0; quadrature stereo mean spread 1; dynamic amplitude .062–.607.
Software sample-to-audio-clock draw age p50 8 ms, p95 14.7 ms mono / 18.7 ms
stereo. No page errors. Stop during pending permission cleans up a later granted
track. Actual hardware mic/system capture and physical latency remain untested.
The UI now omits audible-output-clock offsets for external live sources because
that clock only estimates this app's file playback, not incoming sound.

User refinement: editorial pacing and camera decisions may also teach musical
judgment. Preserve these as distinct targets, separate from lighting observations.
The corpus is electronic-first; do not claim broad genre competence.

The corpus now contains 16 distinct video files, including two matched recordings
of one Forest performance; this is not 16 independent shows. Wide-shot extraction
and its first fresh light-appearance model are complete. The model is too flat
and fails a wrong-audio comparison, so it is not deployed. Three source/target/
baseline/model replays are exported on ExtremePro. See ../wide_lights/RESULTS.md.
The user can leave TouchDesigner closed for current extraction, training and
browser comparisons. TouchDesigner is a later renderer/DMX integration option.

The subsequent relative-event experiment improves probability ranking but did not
find reliable learned trigger thresholds on validation; it remains offline.
See ../light_events/RESULTS.md. A pinned MERT music encoder passed a short causal
window and MPS speed feasibility check (~50 ms warm inference, 500 ms proposed
context cadence). It is a research-only feature candidate, not a lighting model
or a deployed improvement. Feature extraction and fresh lighting probes are now
complete: none passed the validation cue threshold, and combined features failed
signal/prior/wrong-history comparisons. See ../music_encoder/PROBE_RESULTS.md.
The fixed-minute diagnostic preserves direct scope response and shows learned
probabilities without inventing successful cues. Full physical latency, musical
directing quality, holds/builds and fresh final evaluation remain open.

Streaming comparison: ../native_cues/STREAMING_RESULTS.md. The trained candidate
is now runnable at http://localhost:3001/scope/modulation with file or granted
live input. Streaming parity, synthetic capture, cleanup, timing and browser
regression checks pass. No real microphone recording or physical latency test
was performed. Musical superiority remains unproven; the full goal stays open.

Timing-specificity audit: ../native_cues/TIMING_SPECIFICITY.md. Forest failure
includes harmful within-clip fluctuations after removing mean bias; Levity has
useful association. No consistent small prediction shift repairs Forest in this
descriptive audit. Next diagnostic: fixed-weight alternate-recording comparison
with audio-only local alignment, not more sensitivity tuning.

Alternate recording diagnostic complete: ../native_cues/ALTERNATE_RECORDING_RESULTS.md.
Fixed-model paired Forest error .34036→.28281 on common 42.5s-warm support;
simple context .25985 remains better. One clip worsens, all aggregate paired
block intervals include zero. Recording dependence is substantial; no source
substitution, training leakage or deployment promotion.

Waveform recording augmentation completed: ../native_cues/RECORDING_RESULTS.md.
A third saved native-cue candidate improves validation (.09141) but worsens
Forest (.32494); simple/wrong-history controls still fail. It is not promoted.
Next work should address supervision for musical structure/holds/builds, with
continuous source review and uncertainty, rather than another small audio tweak.

Sustained-state review: ../native_cues/STRUCTURE_REVIEW.md. Strict eight-second
scan produces only seven overlapping candidates; four source examples reviewed
in 64 sampled frames. Stable field does not imply intentional hold, declining
median can mix flashes and partial-field transitions. No new hold/build labels
admitted. Four stereo source excerpts are ready for continuous listening review.

Spatial persistence review: ../native_cues/SPATIAL_PERSISTENCE_RESULTS.md.
960 native frames decomposed into persistent appearance and residuals, with
spatial change/occupancy/centroid and separate scene context. This explains
quiet-region versus whole-stage ambiguity; it is offline observation, not
fixture segmentation or new admitted labels. First-frame change is masked.

Human listening review is ready at http://localhost:3001/scope/review. Randomized
A/B identities, full-context warm-up, minimum comparison duration, four musical
judgments, local persistence and export are browser-tested. No actual human
ratings yet; automated test submissions do not count. See
../native_cues/BLIND_REVIEW_PROTOCOL.md.

Review evidence safeguards verified: comparison duration counts only with both
panels visible; exports explicitly mark automated browser runs. A conservative
audit excludes invalid playback, legacy provenance, automated tests and duplicate
exports. Both existing automated exports yield zero eligible human trials.
Actual musical review and physical latency remain outstanding.

Fixture dry-run adapter complete: ../native_cues/FIXTURE_ADAPTER.md. Named
intensity/hue/spread/texture/balance outputs map through existing rig profiles;
no transport imported or hardware connected. 1,500 replay frames and browser
blackout/stop/no-bridge checks pass. Physical timing and fixture validation remain
open, as does model musical quality.

Physical timing kit prepared: ../physical_timing/README.md. New probe WAV and
interval/clock-calibration analyzer pass seven synthetic tests. No real capture,
sensor extractor or physical latency result exists. Available capture setup and
actual human musical feedback have been requested; independent work can continue.

Shared audio freshness fix verified: ../native_cues/AUDIO_FRESHNESS.md.
Recently delivered stale audio no longer qualifies as fresh; suspended contexts
produce no frame. Both views pass suspension/resume tests and full streaming
regression passes. Expiry is software behavior, not physical blackout timing.
