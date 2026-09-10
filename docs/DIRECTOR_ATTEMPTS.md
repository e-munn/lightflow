# Three distinct overnight attempts

User instruction: persist overnight, produce three varied approaches, test them
ourselves. Previous histogram/phrase regression app was rejected as an energy
meter. Preserve that rejection as the quality baseline. Use port 3001 and do not
open the user's browser. Headless tests are authorized.

## Shared requirement

All attempts use a genuinely expressive renderer: independently addressable
layers/regions, movement direction, geometry deformation, density, controlled
reveals, freeze/release, spatial sweeps and transitions. Global gain is secondary.
Preserve ten recognizable visual families including ASCII Waves, AI Blob,
Black Hole and Pixel Sculpt, actual components when available or faithful original
implementations where needed. Do not call custom sketches React Bits components.

Common cue representation must store intent/action, start, duration, target
layer/region, movement trajectory, transition and continuous parameters. Keep
replayable synchronized feature traces and decisions, enabling identical input
comparisons and sequence training. Explicitly distinguish authored/synthetic,
human-authored, inferred and model-generated examples.

## A — Composed musical director

A musical perception layer estimates pulse confidence, onset density, tonal vs
percussive texture, novelty/section evidence and tension over multiple timescales.
An authored score grammar executes multi-second gestures with holds, callbacks,
contrast and sparse accents. This is the strong composed comparator, not a claim
that hand-written policy is a trained lighting AI. It establishes whether the
visual language can produce a show worth learning in the first place.

## B — Human-show imitation

Inspect actual authored event sequences, starting with rhythm-game lightshows
(Beat Saber event groups / YARG venue cues). Retain event semantics, fixture/group
structure, time and durations. Verify source/quality/licensing rather than
assuming every map is human-lit. Learn causal next-cue or cue-chunk decisions.
Do not substitute the rejected histogram model just to fill this slot. If
acquisition is limited, demonstrate and report the actual sample size and limits.

## C — Motif retrieval and planning

Maintain short replayable visual performances, retrieve candidates from musical
context, then choose with continuity, contrast, repetition and upcoming likely
musical events. This operates on complete gestures, not frame-level averages.
Distinguish learned retrieval from hand-authored selection; measure whether
conditioning on correct audio helps over shuffled and loudness-only controls.

## Common test plan

- Same local track excerpts and gain/noise/reverb variants across all approaches.
- Quiet intros, steady grooves, breakdowns, vocals and abrupt transitions.
- Render and inspect clips, not just screenshots or scalar variance.
- Measure timing/age, dropped inference and frame stability. Inference time alone
  is not microphone-to-photon latency.
- Verify ten visual families, actual blackout, zero intensity, source changes,
  offline reload/file playback and simulated microphone on port 3001.
- Check sustained visual structure and independence from instantaneous amplitude.
  More variation, more switches, or brighter output are not quality metrics alone.
- Preserve failures. The final comparison should explain what differs, show the
  results, identify limitations, and recommend from evidence.

The full original goal remains active. Three nominal modes and passing smoke
tests do not establish completion. Human subjective quality remains distinct
from agent inspection and automated measurements.

## Progress

- New `gestures.ts` represents timed gestures and their provenance; holds freeze
  animation time. Timing/hold tests pass in `test_gestures.mjs`.
- `Visual.tsx` now accepts an optional independent gesture layer supporting
  spatial translation, scale bloom, directional reveal, orbit rotation, tile
  fracture, weave and dissolve. Existing app behavior is preserved when omitted.
- TypeScript check passed. Gesture integration into the three approaches and
  rendered clip tests are still outstanding. Do not claim the three attempts
  are implemented based on the shared gesture contract.
- Data audit: mounted corpus currently contains RPMC-L2 and Jamendo analysis; no
  confirmed rhythm-game cue corpus. Consult SOURCES.md: retain derived features
  with provenance, do not train unknown-rights corpora or quarantined v3 cache.
