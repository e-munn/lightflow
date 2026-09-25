# Jev live control, version 2

September 21, 2026. Local preview: http://localhost:3001/scope/jev

The user reported large lag and insufficient variety/creativity. Version 1 imposed a two-second observation average, waited two seconds after every request, held choices for at least two seconds, and crossfaded for 600 ms. Its real-music test returned Snap on every request. The previously reported 155 ms median measured the control request, not recognition-to-visible-change latency. That evidence did not justify a claim of responsive musical direction.

## Revised behavior

The output is still one brightness channel, rooted in the user's circle settings: radius .33, soft inside, expand outside, strength 3.3, no radius adaptation. Local signal extraction and gesture envelopes run every 20 ms. Cloud responses do not fire flashes or delay local attacks.

Jev now chooses three independent dimensions in one request:

- **Gesture:** Trace follows detailed scope movement; Strike accentuates attacks; Bloom retains a trailing glow while preserving the rising edge; Carve briefly subtracts light on attacks; Grain follows changing texture; Space selects separated attacks and leaves darkness.
- **Frequency focus:** full spectrum, low, mid, or high. These are frequency measurements, not isolated instruments. Band novelty affects transient responses; energy share affects continuous body.
- **Contrast:** soft, balanced, or deep. This changes the transfer curve, not the time of an attack.

The 72 combinations are an action vocabulary. Only one is displayed, with a brief transition between choices. Envelopes are computed continuously so selecting a gesture cannot restart an old attack. No random effect rotation, oscillator, or arbitrary extra hits are added. Jev remains a selector of implemented responses; this is not unrestricted choreography generation or a trained Lightflow model.

The model receives a 240 ms current summary, a two-second phrase summary, and older context up to ten seconds total. Code converts comparisons to named observations, following the TypeSafe skill's numerical guidance. Six recent choices are explicitly marked as previous inferences, not evidence about the song. Raw audio and filenames are not sent.

Requests start roughly every 500 ms, with one in flight and at least 250 ms after completion. No backlog is queued. Transitions last 60 ms, with no enforced two-second dwell. Answers more than 900 ms behind current audio are ignored. Each dimension independently requires confidence >= .35 and expires after 2.5 seconds without a usable decision. These are provisional control settings, not calibrated musical-accuracy thresholds. Uncertain dimensions retain their recent value and eventually return to the scope/default mapping.

There is still a cloud control delay: a change must appear in observations, wait for a request, return from TypeSafe, and transition. Request round-trip time alone cannot establish that delay. The immediate local gesture keeps following current sound during the request. This experiment neither knows nor predicts future notes.

## Verification

```sh
node research/jev/test-live.mjs
node research/jev/test.mjs
npx tsc --noEmit
npm run build
node research/jev/api-test.mjs
node research/jev/browser-live.mjs
node --env-file=.env.local research/jev/audit-live.mjs
```

The browser and audit commands use the real TypeSafe API and incur its normal charges; other tests do not. Headless testing opens no visible preview window. The historical v1 `browser-test.mjs` targets the old response/export shape; use `browser-live.mjs` with the current page.

Unit tests check same-frame positive and negative attacks, bloom's immediate attack and longer tail, space between accents, frequency focus, contrast, silence, invalid input, 240 ms context availability, recent-change sensitivity, 60 ms transitions, removal of mandatory dwell, stale/out-of-order rejection, independent uncertainty, expiry, old-hit replay prevention, strict request shapes, and credential isolation.

Five synthetic audio probes went through the real feature extractor and TypeSafe. Results: steady tone was uncertain about gesture, texture selected Grain, separated attacks selected Space, attacks following a quiet section selected Space, and a gradual rise selected Bloom. API round trips were 106–350 ms, median 132 ms. These are unlabeled synthetic probes, not accuracy or preference evidence. Report: [live-audit-1790038314877.json](live-audit-1790038314877.json).

The [three-excerpt browser run](live-browser-1790038441164.json) completed 112 successful real requests, with no HTTP errors, rate limits, or browser exceptions. All returned decisions were fresh enough to apply at least one dimension.

| Excerpt (about 20 seconds each) | Applied gestures | Distinct applied combinations | Median control round trip | Median request spacing |
| --- | --- | --- | --- | --- |
| Calabria | Grain, Space, Trace, Carve | 11 | 173 ms | 517 ms |
| Damn Right | Space, Carve, Trace, Grain | 11 | 159 ms | 517 ms |
| McDonalds | Space, Carve | 8 | 172 ms | 517 ms |

These are familiar development excerpts, not held-out preference tests. More combinations do not prove creativity or improvement. The largest browser request time was 654 ms. Median age of the latest summarized audio at reply was 160–180 ms; that excludes the trailing observation window, time waiting for the next request, and transition. File-playback audio-clock estimates were typically within about 3–18 ms at the point of local drawing; negative startup estimates and unmeasured physical display/input latency prevent treating those numbers as physical end-to-end latency.

Fullscreen viewport fit, A/B keyboard switching, blackout, stop, export, and mobile overflow checks passed. Unit tests and TypeScript passed before unrelated work appeared in the shared checkout. The production bundle compiled, but the full build then failed at an unrelated generic type predicate in `src/lib/pipeline/server.ts:34`, added by concurrent work. This task did not edit those pipeline files. A full production-build pass is therefore not claimed.

## What this does not establish

More distinct choices are not automatically better musical expression. The current descriptions omit much of what a listener hears, and Jev has no access to raw audio here. Preference against the original scope and against a local deterministic controller remains unmeasured. No physical microphone-to-screen, Hue, or DMX latency is measured. Browser audio-clock estimates exclude physical display delay and may be unstable at startup. A useful next listening criterion is whether gesture changes reinforce a passage rather than merely change appearance.

The TypeSafe key remains server-side, and the API remains restricted to local development. All reports here contain small numeric/text data; no SanDisk files were deleted or overwritten. No training claim or production deployment is made.

Official references used for this design: [parallel questions](https://docs.typesafe.ai/patterns/fan-out), [HTTP API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [model capabilities](https://docs.typesafe.ai/models), and [Jev numerical limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13).
