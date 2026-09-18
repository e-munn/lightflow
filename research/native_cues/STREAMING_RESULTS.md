# Streaming trained-candidate comparison

Preview: http://localhost:3001/scope/modulation (open manually in Dia).
Select a file, Electric Forest, Jack White, or an explicitly granted microphone/system source. Direct scope response begins immediately. The learned layer needs 25.5 seconds of past audio; the delayed comparison needs 42.5 seconds. Stop or Blackout clears the light panels. TouchDesigner is not required.

The saved gain-augmented model remains on ExtremePro at `Code/lightflow/research/native_cues/forecast_gain_v1`. This experimental route compares direct response, bounded learned brightness/spread modulation, a simple context control, and a model receiving 17-second-delayed history. The original `/scope` route is retained. This is a trained and runnable candidate, not a demonstrated human-quality lighting director: Forest transfer still fails the simple controls (see GAIN_RESULTS.md). Colors and fast details remain directly measured; the adapter is hand-designed, not learned fixture programming.

## Verification

- Streaming/offline parity across fifteen recordings: all 81 input features match exactly; prediction maximum absolute error 2.69e-7. Forest/Jack White light-output maximum error 1.20e-7.
- Causal scheduling checks reject early prediction use, reset context after source-clock gaps, preserve darkness for silence and zero spread for mono. No future audio is consumed.
- TypeScript check passed: `npx tsc --noEmit --incremental false`.
- Muted headless browser tests passed file playback, model/context readiness, all five canvases, blackout/stop, synthetic mono microphone and stereo system input, ended-track cleanup, no-audio display rejection, late permission cleanup, mobile overflow, and original scope regression. No page errors or queue overflow. Desktop and mobile screenshots visually inspected.
- Browser compute p95: 3.4 ms file, 3.5 ms synthetic microphone. Synthetic microphone sample-to-audio-clock draw age p50 8 ms / p95 17.3 ms. File estimated audible offset p50 8.0 ms / p95 14.9 ms. These are software measurements, not physical microphone-to-photon latency; actual devices and DMX remain untested.

Evidence on ExtremePro: `Code/lightflow/research/native_cues/streaming_v1/node_parity.json` and `browser_streaming_v1/browser-test.json`, exported timing traces and screenshots. Tests used synthetic capture; no real microphone was recorded. Heavy artifacts remain on the external drive. No external artifacts were deleted or replaced.

The user-facing comparison is ready for listening review on unfamiliar songs. Better musical judgment, broad transfer, calibrated physical timing, builds/holds/phrasing and fixture output remain open requirements of the full goal.
