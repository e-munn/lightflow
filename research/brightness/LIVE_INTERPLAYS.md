# Live interplay comparison

The user's “show me” request is implemented at **http://localhost:3001/scope/interplay**. Choose Forest, a local audio file, mic or system input, then select one of eleven recipes. The first is the user's Space / Grain → Snap direction. The remaining ten correspond to `DYNAMIC_INTERPLAY_OPTIONS.md`. Each has two controls, a small output preview and trace, and a live mode label. Fullscreen displays one scalar brightness across the viewport; arrows select recipes and Space blackouts.

The existing fixed-mode page remains at `/scope/styles`. Both pages use the minimal dark styling developed from the production branch's visual cues. No production-model data or RPMC-L2 output is used. The preferred circle remains radius .33, soft inside, expanded outside, strength 3.3, with adaptation disabled.

## Runtime

`public/scope-interplay.mjs` adds a causal recent-signal context and eleven independent routers after the existing running `AttitudeBank`. Band powers, onset history, signal continuity, stereo widening and roughness guide mode selection. An eight-second rolling reference adapts contrast measurements; only earlier received frames inform that reference. Observed onset regularity is not a beat tracker, source separation or prediction of the next beat.

The first recipe gives an immediate provisional Snap response when an attack coincides with a relative body/energy arrival. It then checks 320 ms of continuing evidence; insufficient support releases Snap. A confirmed arrival stays for at least one second and continues only while supported. Once that arrival ends, a new attack is required to enter it again. This can still mistake an accent for a drop; the first flash cannot be retroactively removed by later rejection. There is no claim that the unidentified user excerpt or its exact drop has been recognized.

Passage recipes use persistence, separate entry/exit thresholds and dwell. Gesture recipes deliberately allow fast attack/body/reply changes. Transitions use the two running mode outputs; an interrupted transition starts from its current blended value to avoid a discontinuity. Short silent rests retain routing context while forcing zero output. Invalid or stale input and stopping reset the controller and blackout. No recipe sums all ten modes.

`RECIPES` is the source of truth for controls/defaults. Numeric thresholds, fixed-style defaults and restrained/intense gains are provisional experiment settings, not settings chosen by the user. The first recipe's quiet gain starts at .55 and is adjustable. Switching changes timing/shape as well as gain, but gain confounds still need a controlled listening comparison.

## Captures and verification

`test_interplay.mjs` exercises all eleven route conditions, immediate/provisional and confirmed arrivals, rejected isolated accents, expiration without spontaneous re-entry, high-roll rejection, reply absence, mono fallback, interrupted fades, deterministic causal prefixes and silence/invalid-input blackout. TypeScript is checked with `npx tsc --noEmit`.

`interplay_browser_test.mjs` plays actual Forest audio in isolated, muted headless Chrome. It checks all selectable controls, bounded outputs, real transitions, fullscreen dimensions, keyboard wrap/blackout, stop blackout, mobile overflow, browser errors and source-linked choice export. It replays the exported signal/style frames through a fresh router and requires identical modes and brightness to numerical precision. Browser tests are automated observations, not listening judgments. Compute timings exclude audio capture, worklet processing, display and physical light latency.

Fresh evidence directories on SanDisk preserve earlier runs:

- `/Volumes/ExtremePro/Code/lightflow/research/brightness_interplay_ui_v1/`: initial tested implementation, before adding arrival-expiration regression protection.
- `/Volumes/ExtremePro/Code/lightflow/research/brightness_interplay_ui_v2/`: final regression verification, with `report.json`, exported frames and desktop/mobile images.

The final run passed with 703 exported frames and exactly zero replay error. Eight recipes switched during this short sample; Texture opens, Hit ↔ rebound and Low-end reveal stayed in one mode. Their trigger conditions are separately exercised by unit tests. The measured field occupied the full 1440 × 1060 viewport. No browser exceptions or mobile overflow occurred. Main-thread frame compute p95 was approximately 1.3 ms; this is not an end-to-end latency measurement. The initial run's different route counts are preserved as observed, not treated as musical evidence.

The UI's Export includes source identity/position, settings, all recipe outputs, actual modes/transitions, routing cues, underlying style outputs, RMS/band inputs, display state and selected moments. The review buffer is the most recent 1,500 frames (about 30 seconds). A late export or a five-second saved moment may lack preceding router history; it is not automatically a complete deterministic replay. The browser parity test exports the complete initial prefix before this buffer rolls. Exports are explicitly marked untrained and automated when appropriate; they do not contain raw microphone recordings.

## What remains to learn

This is a listening surface for comparing automatic mode choices. It does not complete the trained-model goal. The next useful evidence is a source-linked passage where the user identifies a correct or incorrect switch and a preferred alternative. Compare best fixed style, loudness-only routing, the same gain envelope on a fixed style, constant-gain routing and a manually marked route before promoting a controller. Cross-song preferences and physical live timing remain unmeasured.
