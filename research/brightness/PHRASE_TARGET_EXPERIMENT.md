# Establish one expressive target

Demo: http://localhost:3001/scope/phrase

The user found the eleven live interplay recipes too similar. Instead of asking for another recipe choice, this experiment tests whether one deliberately directed phrase improves the preferred scope response. The user has already supplied the direction: restrained Space/Grain before a drop, Snap at an intense arrival. The exact earlier source remains unidentified; Forest is the stated provisional choice, not an inferred identification of that source.

## Comparison

- A is the preferred radial scope response: radius .33, soft inside, expand outside, strength 3.3. Attack 0 ms, release 0 ms and makeup 1 are unobserved defaults, not recovered preferences.
- B is Grain at .45 gain before a marked arrival, then Snap with an 80 ms decay. Quiet level, decay and marker are editable. The gain and marker are hypotheses.
- Both use the exact same 32-second stereo recording, Of The Trees / Electric Forest, original source time 31:22–31:54. An energy/body change near 31:37.66 supplies the provisional marker, 15.66 seconds into the excerpt. This is not a verified musical drop annotation.
- B receives one fixed excerpt-wide gain to match A's mean numeric brightness value. A remains unchanged. The initial gain is about .95377; both means are .23974, no samples saturate, and RMS difference is .17365. B's pre-marker mean is .04471 versus A's .11723; after-marker means are .42619 and .35686. These figures establish measurable contrast, not musical preference or calibrated perceptual equality.

This is a known-recording target prototype. The marked transition and whole-excerpt mean match are deliberately available in advance. They must not be advertised as causal prediction, live drop recognition or generalization. The later live controller must choose its state from received audio and calibrate without future information.

## Reproduction and storage

`prepare_phrase.mjs` decodes a four-second analysis prefix plus the excerpt to stereo PCM16 at 48 kHz. It creates the listening WAV from exactly the analyzed excerpt samples and verifies its decoded PCM byte-for-byte. Scope features, music bands, preferred radial scope and fixed styles are processed at 50 Hz using the shared modules; the analysis prefix is omitted from playback. The audio clip's SHA-256 identifies the exact delivered file.

The initial extraction is preserved at `/Volumes/ExtremePro/Code/lightflow/research/brightness_phrase_target_v1/`. Its separately sought audio differed from the analyzed PCM by up to 13 integer units because the resampler began at a different point. It is not served by the demo. The corrected, verified dataset and audio are in `brightness_phrase_target_v2/` under the same research root. Existing SanDisk artifacts are never overwritten or deleted.

`public/scope-phrase.mjs` builds both brightness arrays deterministically from those frames/settings. `phraseIndex` selects only the latest fully elapsed 20 ms window. The browser uses the audio context's output timestamp for the playback cursor when available, with a graph-clock fallback. This is software alignment of prerecorded playback, not measured input-to-photon latency. Seeking selects the same precomputed signals, independent of rendering frame drops.

The two equal-sized displays can be viewed together. Fullscreen fills the viewport and compares A/B with arrow keys; Space blackouts. Pause, stop and natural end blackout. Changing a target control resets listening eligibility and returns playback to the beginning.

## Feedback and training boundary

The only primary question is whether B phrases the music better while retaining useful detail. Available judgments: A better, B better, no clear improvement, or B loses detail. A source-linked note can identify a particular failure.

`/api/scope-phrase` checks source hash, bounded settings, allowed vote, note length and visible observation indices. Each display must have at least two seconds of distinct observed frames before and after the marker. This is a minimal UI-exposure check, not proof the user listened, independent user identity, unfamiliarity, or a blinded trial. Controls reset this coverage. The initial A/B identity is disclosed.

Saving materializes all 1,600 proposed brightness targets and their underlying audio/scope features alongside the source hash, exact settings, fixed matching gain, vote, note and exposure record. Every save uses a fresh UUID and exclusive file creation in `brightness_feedback/phrase_submitted/`. Automated browser reviews go to `phrase_automated/`. Neither is automatically declared training-ready; all records contain `trainedModel:false`, `trainingReady:false` and `physicalLatencyMeasured:false`.

**Forest is now development material.** Earlier experiments may have called a Forest source a test source. This repeated audition/tuning makes Forest unsuitable as untouched evaluation evidence for a future expressive model. Reserve different, unheard tracks before fitting or selecting a learned controller. A positive result here establishes a candidate behavior, not a successful cross-song model. A negative or unclear result means revise this concrete target before training another teacher-copy model.

## Verification

`test_phrase.mjs` checks baseline preservation, exact numeric mean match, scalar bounds, silence, marker timing, decay control, invalid settings and no future-window lookup.

`phrase_browser_test.mjs` checks real playback against the exact expected arrays, the WAV endpoint, visibility eligibility, saved source/settings/targets, automated provenance, fullscreen, keyboard comparison, blackout, stop/end, seeking, control reset, API rejection and mobile overflow. Browser evidence lives in fresh `brightness_phrase_ui_v*` directories on SanDisk. v1 exposed a same-origin check incorrectly comparing a numeric-loopback request against Next's rewritten localhost URL; the endpoint now compares the actual request authority and still rejects cross-origin requests.

Final evidence: `/Volumes/ExtremePro/Code/lightflow/research/brightness_phrase_ui_v2/report.json`. All listed checks passed, with no browser exceptions. Fullscreen measured 1440 × 1080 for a 1440 × 1080 viewport; desktop and 390-pixel mobile screenshots were inspected. The automated saved review contains all 1,600 proposed targets exactly matching the reference computation, 15.64 seconds of pre-marker exposure and 3.52 seconds after it in each display. Its positive vote is explicitly an automated storage check, not musical approval. TypeScript and the phrase unit checks passed. The exact localhost demo URL returned HTTP 200 after verification.

The broad goal remains incomplete: an accepted expressive target, learned improvement on unfamiliar music, and measured physical live latency are still outstanding.
