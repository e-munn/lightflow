# Mono and saturation audit — 2026-09-17

Previous goal turn: progress (exact scope dataset, rejected trained forecast, audio-buffer fix). This turn also made progress; the goal remains active and incomplete.

## Trace traversal is useful evidence, not the replacement baseline

The original area projection discards repeated traversal of the same pixels. A candidate measures average consecutive XY distance per sample, normalized to 48 kHz, and maps it to `movement / (movement + .036220556514185424)`. The scale is the median of six training excerpts only; no test-song adaptation. It is a procedural descriptor, not a trained model.

At identical RMS .2:

| Signal | Existing scope area brightness | Traversal candidate |
|---|---:|---:|
| Mono 100 Hz tone | .056 | .084 |
| Mono 1 kHz tone | .070 | .479 |
| Mono harmonics | .068 | .280 |
| Mono noise | .110 | .895 |

Quiet noise at RMS .0001 produces .0046 in the candidate. Thus it preserves mono frequency/texture distinctions and does not make this very quiet noise bright. However it is intrinsically weighted toward rapid waveform changes. In the first 15 seconds of the estimated Ultra 10-minute stems, median brightness was .475 for drums and .026 for bass, despite median RMS .033 versus .129. On Forest 20-minute stems it was .200 for drums and .015 for bass. Stem estimates are imperfect; these are diagnostic examples, not verified instrument labels.

**Decision: do not replace the live scope with traversal brightness.** It answers the mono sensitivity question partly, but risks removing the sustained low-frequency expression the goal also needs. `public/scope-motion.mjs` remains an offline research candidate; the live page does not import it.

## A bounded change to the display response

The live projection still measures the same actual stereo trace coverage. Its default display response now uses a soft knee: `x / (x + .6432430384611177)`, where `x = exposure * coverage`. The knee was fitted only to match the previous brightness at the combined training median: .5621756. The six training source intervals were fixed before this audit.

On the two ALLEYCVT excerpts, frames above .95 brightness drop from 19.38% and 16.90% to zero. Maximum brightness becomes approximately .909. The mathematical curve is strictly increasing and pointwise, so it preserves event ordering and extrema locations without adding smoothing or delay. It changes contrast and may change perceived salience; reduced saturation is **not** a musical-quality approval. Other recordings and mono limitations still need listening evidence.

The default response is reversible with “Preserve bright detail” under “Display sensitivity.” Unchecking it restores the original exponential curve used for the saved dataset and rejected forecast. Old datasets and models were not overwritten or retroactively relabelled.

## Capture and timing evidence

`brightness_live_inputs_v1` exercised mocked non-silent microphone and system streams; it also exposed isolated false black frames. Animation callbacks receive a scheduled timestamp that can precede a new audio message. Passing it to the strict freshness guard incorrectly treats that message as coming from the future. All scope pages now use `performance.now()` at draw time for freshness.

`brightness_live_inputs_v2` deliberately subtracts 50 ms from animation callback timestamps. Both synthetic mono and stereo streams now remain nonblack during non-silent input, vary with the source, go black within the tested 150 ms after gain becomes zero, go black after stop, and release tracks. Test assertions run on the actual browser page. Physical inputs are not opened. Software timestamps are measured, but sensor/input-driver/display scanout timing remains unknown.

The page can export up to 1,500 recent drawn frames with source, brightness, curve/exposure, channel count, graph/receipt timing and projection compute. Export explicitly marks physical latency as unmeasured and model enabled as false. This is evidence collection, not a claim of physical latency or musical improvement.

## Reproducible artifacts

- `research/brightness/motion_audit.mjs`: synthetic and separated-stem audit; `brightness_motion_audit_v1/report.json` on SanDisk.
- `research/brightness/test_projection.mjs`: mathematical curve, invalid-input and traversal checks.
- `research/brightness/live_input_check.mjs`: injected capture, old animation timestamp, silence, stop and cleanup tests; `brightness_live_inputs_v2` on SanDisk.
- `research/native_cues/test_audio_freshness.mjs`: shared audio freshness regressions, including long output buffers.
- TypeScript check passed after the changes.

## Remaining decision

A richer input description does not by itself supply targets for learned musical choices. Current facts do not justify claiming a noticeable learned improvement, or training another smoothed predictor of the same rejected target. The pending listening question concerns whether the direct scope-derived scalar retains useful detail. Mono sensitivity and the preservation of sustained bass remain unresolved; a new candidate needs a defensible target and listening evidence before model promotion.

Timing clarification: `brightness_live_inputs_v2/timing_correction.json` supersedes the original report's combined timing label. Graph age was sampled after projection, so adding projection duration would count some compute twice. Corrected p95 graph age is 17.0 ms mono and 17.33 ms stereo; p95 projection computation is 0.70 ms for each in this run. Neither includes a calibrated physical capture/display path. The original report is preserved.
