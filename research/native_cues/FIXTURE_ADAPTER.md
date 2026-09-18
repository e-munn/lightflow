# Medium-independent signal to fixture dry run

Previous turn: concrete progress on trustworthy human-review collection. This
turn implements a pure fixture adapter for the current scope/cue output, and
adds a dry-run section to http://localhost:3001/scope/modulation.
No transport is imported or called. No DMX bridge, serial connection, fixture
movement or actual lighting output was triggered.

## Signal and mapping

`LightBehavior` version 1 names intensity, hue, spread, texture, balance and
accent, with a monotonic sampleTimeMs. Intensity/spread/texture/accent are nominal
0–1, hue wraps one turn, balance is -1–1. The current cue's gain diagnostics are
not extra fixture channels. Accent already contributes to the direct intensity;
it is not added twice. Invalid numeric values produce dark dimmers; normal
out-of-range controls saturate. Missing signal, age >250 ms or a timestamp more
than 1 ms in the future also closes dimmers. This expiry is a software policy,
not measured physical shutdown latency.

Spatial dimmer distribution uses fixture x position, spread and balance, with
the same Gaussian-envelope form used by the browser. Texture supplies a bounded
alternation between fixtures. This is a hand-designed adapter, not a learned
fixture placement or choreography rule. RGB fixtures get hue at fixed 55%
saturation/50% HSL lightness, with intensity on the separate dimmer. Physical
brightness/color will not equal browser HSL without calibration.

Existing repository RIG/PROFILES supply addresses and channel encoding. The
active patch is two Shocker panels (1–8,9–16) and two Spot160 movers (17–27,28–38).
Inactive fixtures are omitted. Active id uniqueness, channel bounds/overlap,
finite calibration and positive dimmer gamma are checked. These are existing
project settings, not confirmation of currently connected hardware or modes.
The conflicting historical comments above RIG are not used as configuration.

Movers remain at their calibrated neutral position, white wheel slot, open gobo,
no macros/control command and no fixture strobe. RGB white-blinder and program
channels remain zero. Zero dimmer does not mean every DMX byte is zero; parked
position and color values remain defined. Fast dimmer modulation is preserved,
so disabling a fixture's strobe channel does not imply a constant light output.

The browser section shows four dimmer meters and encoded channels, updated about
four times per second for inspection. This is not a DMX output clock. The pure
adapter can be called at signal cadence, but no physical scheduling/transport
integration is claimed. Browser Blackout and Stop also close the preview dimmers.

## Verification

TypeScript passes. Adapter tests cover invalid/future/stale/missing signals,
silence, overlap/bounds/calibration errors, parked movers, disabled programs and
all 1,500 saved learned-output frames from the existing streaming trace. Bytes
remain finite integers in 0–255. Largest replayed Shocker dimmer step is 120/255;
no temporal smoothing was added to hide transients.

Muted headless browser test verified four responding meters, Blackout/Restore,
Stop, no page errors and no connection to the DMX bridge at port 7777. Only the
Next development HMR WebSocket was observed. Evidence is on ExtremePro at
`Code/lightflow/research/native_cues/fixture_preview_v1/test-report.json`.
No real microphone or physical fixtures were used.

Compile/replay test:

```sh
npx tsc src/lib/fixtures.ts src/lib/scope/fixtureAdapter.ts --module commonjs --target es2020 --skipLibCheck --outDir /tmp/lightflow-fixture-adapter-test
node research/native_cues/test_fixture_adapter.cjs
```

The model still fails the Forest transfer gate and the full director goal remains
open. Actual fixture mode/address verification, renderer calibration, deliberate
movement semantics, physical timing and human musical evaluation remain required.
All previous SanDisk files are preserved; no model replacement occurred.
