# Dynamic routing: Space / Grain → Snap

Status: the initial specification below is now implemented as a live routing prototype at `/scope/interplay`, alongside ten alternative recipes. See `LIVE_INTERPLAYS.md` for the implementation, tests and limits. No model training or musical-quality claim accompanies this prototype.

## Goal and evidence

Turn the user's preferred interplay into a causal controller: restrained Space/Grain during less intense material, decisive Snap when the music lands. Retain the stereo-scope response inside each engine and emit exactly one brightness value in [0,1].

The direct preference is recorded in `STYLE_ROUTING_PREFERENCE_2026-09-17.json`. Audio identity, precise boundaries, style settings and gain are not yet captured. No `lightflow-signal-styles*.json` export was found in Downloads at specification time. Do not assume the user was playing the built-in Forest example.

The current `AttitudeBank` already runs all ten styles and supplies causal onset, relative band energy, spread, texture, flatness, build and centroid measurements. Start routing only the three preferred styles. Leave their settings fixed during the first routing comparison so switching and parameter adaptation can be evaluated independently.

## Output architecture

```text
live stereo or mono audio
   ├─ immediate scope + audio features → running Space / Grain / Snap engines
   └─ recent musical context → mode, transition and restrained/intense gain
                                      ↓
                         one selected brightness signal
```

Keep engines running while unselected, preserving their onset/decay history. A controller chooses one primary mode. Only a bounded transition temporarily uses two outputs; no permanent mixture of all three is proposed. Style selection and intensity are separate controls.

For a transition between old and new modes:

`brightness = clamp((1−a) × oldGain × oldOutput + a × newGain × newOutput, 0, 1)`

Both weights are nonnegative and sum to one. Limit gains to [0,1] for this experiment. The lower and higher state gains must be chosen from a replay, not inferred from the user's adjective “intense.” A strong impact can use `a=1` immediately. A slower parameter controller must not delay the immediate audio path.

## Three behaviors

| Mode | Candidate evidence | Intended behavior |
|---|---|---|
| Space | Separated onsets, intervening gaps, low continuous activity | Selective accents and darkness between them |
| Grain | Ongoing texture/traversal activity, relatively continuous spectral change, no convincing impact transition | Restrained detail that follows the surface of the sound |
| Snap | Strong onset plus a meaningful change in energy/body or spectral arrangement relative to recent context | Immediate, intense articulation of the arrival and following attacks |

The Space-versus-Grain assignment is a proposed rule, not a label supplied by the user. Their observation allows either in the prebuild. Loudness alone does not determine mode: an energetic sustained texture can remain Grain, and an isolated quiet attack can remain Space.

## Evidence the router should use

- **Attack:** existing broadband novelty and onset score. Count discrete events with separate onset/reset thresholds rather than treating every above-threshold frame as another hit.
- **Body arrival:** change in absolute low-band energy and total RMS relative to preceding context. The existing `metrics.low` is a *fraction*: it can rise because treble disappears. Derive absolute band energy from the existing worklet powers before calling it bass/body arrival.
- **Context contrast:** compare short activity (roughly 100–250 ms) with robust trailing context (initial experiment: 6–12 seconds). Maintain an additional 0.5–2 second view for post-impact persistence. Compute thresholds from preceding frames, then update history.
- **Texture and continuity:** normalized waveform traversal, broad-band flatness, spectral novelty distribution, active fraction and event spacing. These are coarse signal descriptions, not isolated synth/vocal/snare labels.
- **Build evidence:** rising onset density, spectral brightness or energy may arm the router for an arrival. A build is a prior that changes confidence; it neither schedules a flash nor guarantees a future drop. A sufficiently clear arrival can occur without a detected build.

Robust normalization should prevent a differently mastered track from changing every threshold. Do not continuously normalize away actual builds or quiet breakdowns. Compare recording-level changes and musical dynamic changes separately. One audio stream does not always reveal which caused a level change.

## Causal state and transitions

Use a small state machine with mode scores, confidence, a build-armed flag and transition timers. The times below are starting hypotheses for replay calibration, not validated optima or musical timing claims.

1. **Restrained mode selection.** Start in Grain at a restrained gain while collecting context. Space can take over when gaps and separated attacks dominate. Require the alternative to remain preferable for about 250–500 ms; use different entry/exit thresholds and a roughly 0.5–1 second minimum dwell to prevent rapid toggling. Interpolate Space↔Grain over about 150–350 ms.
2. **Fast impact entry.** Trigger provisional Snap from a strong onset plus at least one independent body/context-change cue. An armed build increases confidence but is not required. Switch on the same analysis frame that declares the impact, with an optional 0–40 ms ramp. Do not wait for a long smoothing window or a future beat before showing the first attack.
3. **Confirmation after entry.** Over the next roughly 200–400 ms, check whether changed body/energy or ongoing rhythmic activity supports the new section. If not, count a provisional false entry and return gently to the prior restrained mode. This cancellation overrides the normal minimum dwell. It cannot undo a flash already displayed, so false entries must be measured explicitly.
4. **Snap persistence.** After confirmation, hold the mode for roughly one second initially. Then require the impact evidence to fall below a lower exit threshold for roughly 0.5–1 second before leaving. Continued rhythmic attacks can support Snap without requiring every frame to remain loud. A long pad or a snare roll must not lock the router in Snap merely by being energetic.
5. **Return.** Choose Space when gaps dominate or Grain when texture continues, and release over roughly 200–500 ms. Avoid inventing a new attack when switching styles mid-tail. If another impact arrives during a slow transition, retarget from the current rendered output; do not restart from an obsolete mode's brightness.
6. **Silence and interruption.** Stop, invalid input and stale capture force zero immediately regardless of mode or fade. Digital silence also produces zero. Retain enough *router context* through short musical rests to recognize an arrival after silence; stop/source changes reset it. The existing bank resets engine history on digital silence, so the new router's longer context must be maintained separately. Sustained silence should expire build arming. Microphone noise-floor behavior needs its own calibration and tests.

The first version is reactive. “Same analysis frame” means no extra switching delay after detection, not zero physical latency or knowledge of a future drop. Report detection lag, transition lag and physical capture/display latency separately.

## Minimal controls and diagnostics

Keep the production-style UI compact:

- Manual / Auto selection.
- **Drop sensitivity:** adjusts how much impact evidence is needed.
- **Restraint:** gain separation between quieter modes and Snap.
- **Transition softness:** changes ordinary fades; a strong impact can retain its immediate entry.
- A small live label: mode, confidence and reason, e.g. “Snap · onset + body arrival.”

Expose individual thresholds and timers in an advanced panel only. Retain the manual ten-style bank for comparison. Fullscreen remains pure brightness with the existing keyboard controls.

Log selected mode, three scores, pending/confirmed transition, input cues, threshold/reference values, raw style outputs, gains, transition coefficient and final brightness with audio time and source identity. Record exact presets. Manual correction buttons should mark a preferred mode or boundary with uncertainty rather than fabricate a frame-accurate target from a late click.

## First implementation and evaluation

1. Identify the current excerpt and save its settings. Mark a restrained passage, the first drop impact and the return to restrained material. Where the user accepts either Space or Grain, retain a set-valued label instead of inventing a precise allocation.
2. Add a deterministic `StyleRouter` between `AttitudeBank.frame()` and the selected display. Keep style definitions fixed. Run offline replay and live code through the same router implementation.
3. Freeze settings after development on that passage. Test at least an additional passage from it plus unfamiliar electronic tracks with sparse sections, sustained textures, snare-roll builds, impact arrivals and false-drop candidates. Split by track/performance and avoid repeated-song leakage across shows.
4. Compare manual switching, the best fixed mode, a loudness-only switcher and the proposed contextual router on the same display. Also compare the router with a fixed style driven by the **same gain envelope**: this checks whether changing style adds value beyond becoming brighter at the drop. A constant-gain routing comparison separates timing/style from intensity contrast.
5. Report first-impact detection lag, false Snap entries per minute, missed arrivals, unnecessary switches, useful dwell, preservation of quiet detail and listener preference. Do not count same-frame routing after late detection as on-time success. Do not collapse these into a single prediction-error score.

Accept the controller only when the preferred pattern repeats on unfamiliar material, first attacks remain visible, and false switches are tolerable in listening. A manually replayed sequence is a comparison reference, not a live solution. Generalization is not established by tuning a threshold to this one drop.

### Required engineering checks

- Prefix causality: identical audio prefixes produce identical modes and brightness regardless of subsequent audio.
- Exact shared offline/live router parity, including timestamps and gaps.
- An isolated loud transient and a rising snare-roll fixture do not automatically become confirmed drop sections; retain any provisional false entry in the report.
- Weak or conflicting evidence retains a stable mode instead of toggling.
- Transition interruption stays bounded and starts from the actual current output.
- Invalid data, stale capture, source changes and stop produce the documented reset/blackout behavior; brief rests do not erase necessary section context.
- No style accumulator is reset merely because it is deselected.
- Tweak/export/replay retain complete routing parameters and source position.
- Measure router compute and detection timing under load; physical timing remains a separate measurement requirement.

## Path to a learned controller

After the deterministic comparison is useful, train a compact temporal classifier on recent scope/audio measurements to predict Space/Grain/Snap suitability and an impact-transition score. Initially keep the reviewed gain profiles and state-machine timing rules outside the model. With uncertain prebuild labels, supervise membership in the accepted {Space, Grain} set instead of pretending either is uniquely correct.

The learned component must beat the deterministic router on held-out music while preserving immediate scope detail. Train gain or per-style parameters later only when reviewed examples specify them. This is a concrete model target—when a response suits a passage—supported by the user's observation. It does not claim that genre, instrument identity or human-level musical direction can already be inferred reliably.
