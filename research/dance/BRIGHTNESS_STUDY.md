# Brightness mapping study — overnight continuation

## User acceptance criteria, recorded 2026-09-21

The target is one expressive brightness signal for an eventual live-audio light
show. Do not train another predictor until this target is worth learning.

- Motion, Arms and Legs (buttons 1–3) are too sensitive and sometimes feel random.
- Snap (4) is the strongest timing reference: most likely to land on the beat.
- Open (7) has appealing expression, but needs stronger musical timing.
- Sensitivity/fade strongly affect preference. Defaults should account for BPM
  and the sound's character, not require arbitrary knob hunting.
- Avoid accumulating ad hoc blends. Keep successive playable versions and show
  what each step changes, including failures. Work autonomously while the user
  sleeps; do not treat proxy scores as the user's artistic approval.

## Working model and limits

Use three interpretable roles, not a weighted sum of every metric:

1. **Timing evidence:** audio transients and a confidence-qualified beat estimate
   indicate when an accent is supported. Unknown beat is unknown, not 120 BPM.
2. **Expression:** reliable body expansion/contraction describes phrase shape.
   A held wide pose must not force full brightness forever. Test change and
   context against absolute expansion. Movement confidence gates validity.
3. **Envelope:** musical duration and measured audio texture determine the
   attack/release character; peak calibration preserves brightness headroom.

First test each role separately. Only integrate after ablations show an added
benefit. BPM does not specify beat phase; a BPM-scaled fade alone is NOT beat
locking. Audio texture is a low-level descriptor, not comprehension of mood.
Teacher evaluation uses observed dance + original audio; future deployment must
infer all needed controls from audio. No claim of live audio readiness yet.

## Version ladder

| Version | One question | State |
| --- | --- | --- |
| V0 original | What already works in Snap and Open at gain 1.3 / fade 160 ms? | Frozen and playable |
| V1 calibrated | Do passage-derived sensitivity and BPM/texture-derived fade reduce saturation while retaining accents? | Useful headroom; no timing improvement established |
| V2 timing evidence | Can supported audio accents reject off-beat movement flashes without suppressing syncopation? | Rejected; preserved with controls |
| V3 phrase expression | Can Open improve expression on a shared strong-audio-accent clock? | Frozen; evaluated once on reserve; ready for listening |

Keep no more than these three candidate steps tonight. A failed version remains
in the index with a reason; it need not advance. Prefer a few meaningfully
different results over many barely distinguishable presets.

## Evaluation protocol — predeclare before tuning V2/V3

- Freeze at least six varied passages, IDs and source IDs: sharp popping,
  continuous movement, restrained movement, fast footwork, a poor-tracking
  stress case, and a contrasting musical texture. Keep all excerpts from a
  source/song in one split. Record previously viewed clips honestly; do not
  call consumed pilot test material unseen. Reserve additional sources until
  candidate choices are fixed. Do not repeatedly tune on the reserve set.
- Preserve V0 code/config, checksums, common video clock, and common viewing
  conditions. Provide direct playable links for each version and passage.
  Freeze calibration within a passage so seeking/replaying is deterministic.
- Measure saturation fraction, event count, isolated one-frame spikes,
  confidence-gap leakage, brightness continuity, and recovery between accents.
  Compare alignment distributions against audio onsets AND tempo-grid evidence,
  with ± timing tolerance stated. A syncopation is not automatically an error.
- Measure energy/brightness-matched comparisons in addition to native gain;
  brighter is not synonymous with better. Include RMS/audio-onset-only and
  unchanged Snap/Open controls so fancy combinations must justify themselves.
- Include time-shifted and wrong-song controls; an onset-gated method cannot be
  validated solely against the very onset detector used to construct it.
  Add sampled waveform/video inspection and independent/manual beat anchors
  where possible; label automatic anchors and uncertain source A/V offset.
- Synthetic checks: silence, steady tone, known-tempo clicks, irregular hits,
  half/double tempo, missing joints, cuts, low confidence and parameter bounds.
  Good results on clicks do not prove accurate BPM on the recordings.
- Explain the parameter policy, confidence/fallback behavior, measured latency,
  and added lookahead. Do not silently delay or retime music to improve a score.

## Deliverable / stopping rule

A minimal local version index with V0–V3 (including rejected candidates), same-
excerpt playback, concise change notes, measured results, and a recommendation
qualified as a candidate for listening. Keep all raw media untouched. Heavy
derived assets must be NEW files on SanDisk; never delete/overwrite existing
SanDisk content. Light code, indices and reports may live in this repository.
Do not open/reload the user's Dia window. Do not deploy, push or train.

At completion or 2026-09-22 08:00 America/Los_Angeles, checkpoint and pause the
overnight heartbeat. A subjective decision remains for the user. Keep a running
append-only iteration log below so later wakeups continue rather than restart.

## Iteration log

- Start: implementing automatic defaults in `movement-brightness.ts`,
  `music-context.ts`, `music-audio.ts`, and `/pipeline/live`. Original metric
  outputs retained through the envelope refactor; existing synthetic brightness
  tests and TypeScript pass. BPM/texture analysis and Auto UI still require
  validation. Next: finish tests, freeze V0, establish passage manifest, build
  version index. User feedback arrived during this work and governs all tuning.
- 2026-09-22 05:20 UTC: V0 frozen in `src/lib/pipeline/brightness-v0.ts` with
  SHA-256 in `brightness-study-manifest.json`. `/pipeline/study` indexes V0 and
  V1; V2/V3 are explicitly planned, not implemented. Live player supports
  `?study=v0|v1&mode=snap|open&run=UUID`; switching version retains the playback
  timestamp. V0 fixes gain 1.3 / fade 160. V1 Auto resets per passage, retains
  manual overrides per mapping, and can restore suggestions with one click.
- V1 uses whole-excerpt offline audio: quiet decoding at 16 kHz, channel energy
  aggregation (no stereo cancellation), positive spectral changes, transient
  density, energy continuity and a periodicity estimate qualified across both
  halves of the excerpt. BPM is approximate; half/double-time ambiguity remains.
  No beat phase is inferred. Estimated texture is a heuristic, not mood. Audio
  failure/uncertain tempo falls back to movement-derived settings.
- `test_music_defaults.mjs` passes synthetic 90/120/150 BPM, real FFT extraction
  of a 120 BPM pulse signal, silence, sustained tone, irregular novelty, short
  excerpts, unknown-tempo fallback, noise/coverage guards, and parameter roles.
  TypeScript, brightness and smoothing tests pass. Auto/playback browser checks
  pass; extended V0/index checks are being completed. Fixed a paused-seek race:
  a late `seeking` event must not clear an already presented target frame.
- V1 development diagnostics:
  `brightness-evaluation-development-2026-09-22T05-20-02-517Z.json`, generated
  by `node research/dance/evaluate_brightness.mjs`. Six development/stress
  sources only; reserved sources remain unopened for this evaluation. All six
  audio textures classify as mixed (do not change thresholds merely to force
  different labels). Estimated tempos 82/120/124/86/123/120 have no independent
  musical validation yet.
- **Do not promote V1 as a solution.** Motion saturation falls from 18–28% of
  valid time to zero, largely because gain falls from 1.3 to 0.9. After matching
  mean brightness, Motion is almost unchanged. Snap events are unchanged;
  shorter fade makes them darker on average. This establishes headroom, not
  improved beat alignment or removal of random gestures. The next useful step
  is V2 with independent timing controls, NOT more V1 knob tuning.
- Overnight heartbeat `lightflow-overnight-brightness-study` is ACTIVE every
  30 minutes, ending at completion or 2026-09-22 08:00 America/Los_Angeles.
  Temporary `caffeinate -i` PID 59801 prevents idle sleep until that deadline;
  it expires itself. Keep the app running and SanDisk connected. No raw data
  or existing SanDisk file was modified. No model training or deployment.
- Final V1 checkpoint: extended hidden-browser tests now pass for all mappings,
  automatic/manual restoration, source-clock seeking, V0 parity and fixed
  settings, index links, full viewport brightness, mobile/landscape layout,
  original music, smoothing independence, and unavailable-source recovery.
  `/pipeline/study` is served on http://localhost:3001. Next continuation should
  begin V2 timing-evidence implementation/evaluation, not repeat V1 setup.
- 2026-09-22 overnight V2 iteration: implemented `brightness-timing.ts` with
  explicit audio-accent availability, backward 120 ms support of original Snap,
  separate RMS-rise anchors and an optional phase-grid diagnostic. Protocol was
  written before evaluation in `V2_PROTOCOL.md`. V2 results are in
  `timing-evaluation-development-2026-09-22T05-58-29-414Z.json` and the readable
  `V2_RESULTS.md`. Code/protocol locks are in `timing-v2-lock.json`; do not edit
  the frozen V2 algorithm merely to make its report look better.
- **V2 rejected as a general replacement.** Of 236 interior Snap events, true
  audio accepted 163, +700 ms shifted audio 154, wrong-source audio 138. Shifted
  support retained at least as many events in four of six sources. Spectral and
  RMS anchors were both dense; proximity scores were not strong evidence of
  musical timing. No reserved source was evaluated. Keep reserved data for V3.
- V2 is playable at `/pipeline/live?study=v2`; the Study index labels it rejected.
  Its comparison selector offers candidate, original Snap with the same fade,
  audio accents only, and RMS only. V0 and V1 remain available. The Open-amplitude
  ablation of V2 was computed but NOT promoted as V3, because it inherits the
  weak timing gate. Browser V2 tests, synthetic timing tests, music-default
  tests and TypeScript pass; V0/V1 regression verification is finishing.
- **Next continuation:** implement a revised, independent V3 hypothesis:
  strong audio accents supply the event clock; Open supplies phrase expression.
  Predeclare strong-accent selection, timing/latency and envelope; compare to
  the exact same audio event clock with constant amplitude, then wrong-movement
  controls. Shared audio timing cannot validate the contribution of Open.
  Prefer a new `brightness-phrase.ts` module; do not revise V0/V2 frozen code.
  Build a playable candidate and ablation, freeze it, then evaluate reserved
  sources once. Keep percussive density and false flashes under scrutiny; the
  current broad onset detector finds 114–218 events per 30 seconds and is too
  permissive to call every event a meaningful beat. No production/predictive
  training. Heartbeat remains ACTIVE because the comparison set is unfinished.
- V2 checkpoint complete: V0/V1 browser regression, V2 browser comparisons,
  TypeScript and whitespace checks pass. Mobile preview inspected. No evaluation
  process remains running. Continue directly with the revised V3 plan above.
- V3 checkpoint, 2026-09-22 06:44 UTC evaluation: replaced the failed V2 premise
  with the independent, preregistered `brightness-phrase.ts` hypothesis. Strong
  audio accents set event time; causally smoothed Open scales event amplitude.
  Constant-amplitude and wrong-movement controls share the event clock. No
  algorithm threshold was tuned after seeing development or reserved results.
- `phrase-v3-lock.json` froze all five algorithm dependencies before the one
  reserved-source evaluation. Reports are
  `phrase-evaluation-development-2026-09-22T06-41-20-091Z.json` and
  `phrase-evaluation-reserved-2026-09-22T06-44-32-685Z.json`. **The four reserved
  sources are now consumed evidence. Do not rerun them for parameter selection.**
- V3 selected 44–56 strong accents per 30 seconds, versus 114–218 broad accents.
  Zero isolated one-frame pulses were found; constant mean matching succeeded
  on all ten passages. Four reserve passages had 0–0.58% saturation. Tracking
  loss remains material: the stress source renders only 28 of 44 accents.
  No automatic score establishes that real Open is more expressive than the
  constant or wrong-movement controls. Read `V3_RESULTS.md` before claiming gain.
- V3 player now offers Open expression / Constant accents with mean matching
  enabled by default. Version switching preserves source time. The index at
  `/pipeline/study` preserves all four stages, labels the rejected idea, and
  links all ten passages. This is an offline recorded teacher study; whole-clip
  normalization sees future data. No audio-only live predictor was trained.
- New V3 headless-browser checks passed: distinct amplitudes at shared timestamps,
  matching toggle, shared manual settings, Auto restoration, skeleton smoothing
  independence, all version switches, blackout, desktop/mobile/landscape fit,
  index and reserved clip loading, explicit audio failure and no browser errors.
  Screenshots were inspected. V0/V1/V2 regression checks are finishing before
  the completion checkpoint. No visible browser or existing SanDisk file changed.
- Completion checkpoint: all five pure suites, TypeScript, whitespace checks,
  V0/V1 browser regression, V2 browser comparison, V3 browser comparison and raw
  player/recovery regressions pass. Frozen algorithm hashes still exactly match
  the pre-reserve lock. The reviewable comparison set is complete.
- Heartbeat `lightflow-overnight-brightness-study` is now **PAUSED**. Next work
  depends on listening feedback: does V3 Open add useful expression over constant
  accents, and does either retain/improve the original Snap/Open feel across
  multiple passages? Keep the target unapproved until then. Review URL:
  http://localhost:3001/pipeline/study . No training, push or deployment occurred.
- User feedback, 2026-09-22: “im not sure we got any closer.” Treat this as lack
  of demonstrated progress toward the musical target, not approval of V3 and
  not a requirement that the user select one of the existing candidates.
- Implementation audit in response: V3 replaces dancer-derived event timing
  with detected audio accents, and reduces continuous Open to a sampled pulse
  amplitude. It therefore changes BOTH aspects the user liked: Snap's timing
  and Open's continuous feel. The constant control isolates Open's amplitude
  contribution inside V3, but does not establish that this architecture retains
  either advantage of the original. Body expansion is a geometric quantity;
  its identification with musical phrase expression remains a hypothesis.
- Keep the useful infrastructure (raw poses/confidence, synchronization,
  preserved references, matched comparisons) and the V2 negative result. Do
  not describe more versions, lower saturation or passing playback tests as
  evidence of a more musical light. No candidate has demonstrated superiority.
- Recommended next experiment: diagnose exact successful/failed moments in
  original Snap/Open before building another mapping. On short development
  excerpts, separate pose/tracking errors, metric-generated false events,
  missed musical accents and release-envelope spill. Annotate the intended
  musical moments independently of the detector, record uncertain A/V offset,
  and fix one observed failure while preserving the reference event timing.
  Compare that single change at matched brightness on the same moments, then
  test another source. Do not treat this as authorizing a new automatic version
  ladder or resuming the paused heartbeat; no new work has been scheduled.
