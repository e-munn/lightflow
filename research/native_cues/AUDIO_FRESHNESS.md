# Suppress stale audio output

Previous turn prepared the physical timing kit, a concrete advance but not a
physical measurement. This turn found and corrected an independent live-path
failure: checking only a frame's recent main-thread receipt could admit old
audio delivered late by a worklet.

The shared ScopeAudio.frame() now requires a running AudioContext and checks
both receipt age and audio-sample age against 250 ms. File playback compares
sample time with its estimated audible output clock; external capture uses the
input graph clock. This distinction preserves valid file frames when the output
device buffers audio. Nonfinite/reversed observation time is rejected. Queue
selection still leaves future frames pending. Stop clears state as before.

The change applies to the original scope, trained comparison, blinded review
and fixture preview through their shared audio class. Missing fresh frames cause
renderers to clear their output. No model weights, feature values or target labels
change, and no physical transport is introduced.

This is an on-render software expiry rule, not a guaranteed physical blackout
deadline: a frozen main thread or display cannot be forced to refresh by this
check. Actual input-to-photon and fixture timing remain unmeasured.

## Verification

`node research/native_cues/test_audio_freshness.mjs` checks the actual transpiled
class with explicit clock fixtures: fresh external/file samples, recently delivered
old audio, frozen clocks, suspended/closed contexts, invalid/reversed time, queued
future samples and Stop. A long file-output buffer is not mislabeled as stale.
TypeScript passes.

Muted headless browsers verified both `/scope` and `/scope/modulation` through
running → suspended/dark → resumed/responding → stopped/dark, with no page errors.
The fixture dry-run dimmers also closed during suspension. No real microphone,
camera or physical lighting was used. Evidence:
`/Volumes/ExtremePro/Code/lightflow/research/native_cues/audio_stall_v1/report.json`.

The full streaming regression also passed: file model/control readiness,
synthetic non-silent mono microphone, stereo system input, late permission and
no-audio capture cleanup, mobile layout, blackout/stop and original scope.
No page errors or queue overflow. Evidence: `native_cues/browser_streaming_v2`
on ExtremePro. File compute p95 3.3 ms and synthetic mic p95 3.4 ms are software
measurements only. No new musical-quality or physical-latency claim follows.
