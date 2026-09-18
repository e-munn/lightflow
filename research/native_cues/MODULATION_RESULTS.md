# Actual light-output comparison

The previous turn trained and verified a second candidate and showed that volume
augmentation does not solve its transfer failure. This turn converts the trained
probabilities into explicit, medium-independent light signals and produces two
playable four-condition comparisons. The full goal remains active and unmet.

## What is implemented

An offline causal policy keeps the direct 20 ms scope features in every output.
The trained layer changes only intensity gain and spatial spread, with fixed
limits and time constants declared in MODULATION_EXPERIMENT.md before rendering.
Intensity/hue/spread/texture/balance/accent outputs can feed the same browser or
fixture-group adapter. Hue, texture, balance and immediate accent remain measured
or procedural, not learned human choices. Gain metadata is stored separately in
the signal schema. No actual DMX hardware commands are emitted.

Four conditions use identical audio and rendering: direct reference, trained
temporal-model modulation, current-context logistic modulation, and the trained
layer receiving audio features delayed by 17 seconds. The delayed control retains
correct fast direct audio. It uses no circular wrap or future samples. All clips
start after 60 seconds of actual input context. No recorded lighting labels are
fed into the output policy.

Outputs consume only predictions completed at least a modeled 20 ms before their
audio-clock tick; no future interpolation. This is an offline computation allowance,
not measured capture-to-photon latency. The delayed model has its full context
after 42.5 seconds; the ordinary model after 25.5 seconds. Before readiness, prior
probabilities reduce exactly to the direct output.

## Observed size of the change

| Fixed one-minute passage | Learned intensity gain min/median/max | Mean absolute intensity change vs direct | Maximum change |
|---|---|---:|---:|
| Forest 31:00–32:00 | .938 / .984 / 1.068 | .01444 | .05317 |
| Jack White 35:00–36:00 | .952 / 1.013 / 1.250 | .01514 | .14722 |

No newly saturated intensity frames occur in these two samples. Correlation of
20 ms intensity first differences with the direct baseline is .99965 and .99817.
That indicates the immediate direct response still dominates; it does not prove
better musical judgment. Synthetic tests verify immediate transient response,
prior neutrality, exact darkness at silence, mono spread, output bounds, identical
prefixes and prediction availability. All seventeen native-cue/policy tests pass.

Four representative render frames were visually inspected: two each from Forest
and Jack White. The same layout, palette and renderer are used in all panels.
Differences are often subtle, as the trace measurements predict. Human listening
and preference review have not happened; holds, builds and transitions are not
established as learned behavior by these samples. The cue model still fails its
cross-show controls. This is a candidate to judge, not a promoted director.

## Verified deliverables

Each video decodes to 1,800 frames at 30 fps, 1440×1080, with 60 seconds of finite,
non-silent stereo audio. Export copies match research renders by SHA-256. Latest
source frame is held for display (max age 33.33 ms Forest / 41.67 ms Jack White).
Scope/light data max displayed age is 13.33 ms; model endpoint age is up to
100 ms because predictions update at 10 Hz. These are file-clock/display sampling
checks, not physical latency or precise prediction of lighting decisions.

- `/Volumes/ExtremePro/Movies/Exports/lightflow_learned_modulation_forest_9-16-26.mp4`
- `/Volumes/ExtremePro/Movies/Exports/lightflow_learned_modulation_jack_white_9-16-26.mp4`

Research artifacts: `native_cues/modulation_v1` (all traces, provenance, metrics,
and two 50 Hz light-signal CSVs with 3,000 display rows each) and
`native_cues/modulation_replay_v1` (renders, frame samples and verification).
Original assets and all earlier experiments remain preserved on SanDisk.

The next useful integration is an explicitly experimental live comparison on
microphone/system/file input, with streaming feature/model parity and software
timing checks. Keep the existing scope reference and controls available. That
would make the trained candidate usable for direct musical evaluation; it would
not erase the remaining human-quality and physical-latency requirements.
