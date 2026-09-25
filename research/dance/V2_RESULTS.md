# V2: recent-audio support is not a sufficient timing model

**Decision: keep as a rejected, playable diagnostic. Do not use it as the new
brightness target. Reserved sources remain untouched for this experiment.**

Play: http://localhost:3001/pipeline/live?study=v2

The comparison selector includes V2, ungated Snap at the same fade, audio accents
only, and audio level only. V0 and V1 remain in the version selector. Switching
versions/controls preserves the source-video time. V2 requires available audio
analysis; it does not silently substitute another algorithm if audio fails.

## What changed

Only retain a raw Snap event when a locally prominent spectral accent became
available within the previous 120 ms. Keep the original movement-event time and
amplitude. The cue uses one 20 ms analysis frame for peak confirmation; that
availability time is explicit. No beat-grid quantization or music retiming.

The amplitude-only Open ablation was also calculated: at each retained event,
multiply by `0.25 + 0.75 × Open`, with identical fade. It cannot fix the gate's
timing evidence and was not promoted as V3.

## Development evidence

Data: `timing-evaluation-development-2026-09-22T05-58-29-414Z.json`.
Counts exclude the first and last second. Wrong-song support uses the next fixed
source in the declared manifest; shifted support is +700 ms, with no wrapping.

| Passage | Original Snap hits | Real support | Shifted support | Wrong song |
| --- | ---: | ---: | ---: | ---: |
| AI Naafyish | 48 | 43 | 44 | 29 |
| Beat Killer | 42 | 29 | 19 | 26 |
| Top-Tier Animation | 47 | 31 | 29 | 26 |
| Lotus Flower | 43 | 23 | 24 | 21 |
| Feel the Way I Feel | 37 | 27 | 28 | 19 |
| Crave You, tracking stress | 19 | 10 | 10 | 17 |
| Total | 236 | 163 | 154 | 138 |

Shifted support retains at least as many events in four of six passages. Real
support keeps 69.1% of original events, shifted 65.3%, wrong song 58.5%. These
counts do not establish a musically useful discriminator.

The construction detector finds 114–218 accents per 30-second passage. The
separate RMS-rise detector is also dense (72–145 anchors). With such dense
anchors, a ±120 ms match is often easy by chance. V2's proximity to RMS anchors
improves in some passages and worsens in others. Do not quote proximity alone
as "beat accuracy." A concentrated phase grid was unavailable on five of six
passages. No manual beat annotations or source A/V-offset calibration exist.

V2 and the Open ablation are dimmer. Equal-mean diagnostics are included in the
JSON; adjusting gain back upward does not repair the weak timing discriminator.
No perceptual success has been established. The declared rejection criterion
was a weak true-versus-mismatched support distinction, not merely hit retention.

## Validation and reproducibility

- `test_timing.mjs`: preserve accepted hit timestamps, reject future/expired
  support, confidence/cut reset, zero signal through silence, no static-pose
  light generation, raw immutability, causal pose prefix and cache behavior.
- `timing_browser_smoke.mjs`: deep link, four distinct controls, common video
  clock, version switching, blackout, mobile layout, explicit audio failure.
- TypeScript and existing music-default tests pass. Existing source data and
  V0 implementation are untouched. No model is trained.

## Revised V3 question

The original plan to add Open on top of V2 would inherit a failed premise.
Instead, test **strong audio accents as the event clock, Open as expression**.
Use an identical event clock with constant amplitude as the ablation, plus a
wrong-movement pairing. Declare the strong-accent selection and envelope before
evaluating. Timing will be shared by construction, so any claim that Open adds
value must concern expression, not an automatic beat-proximity score. Keep
weak-beat passages honest; do not label accent timing as a verified beat grid.
