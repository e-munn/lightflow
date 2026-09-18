# Adaptation anchored to the first preferred circle setting

The user explicitly preferred radius .33, gradual inside reduction, outside expansion and strength 3.3 on the pictured song. Adaptation was off. The screenshot does not identify the song or reveal exposure gain, attack or release. Record: `PREFERRED_CIRCLE_2026-09-17.json`. An asynchronous source-identification question is pending. No `lightflow-circle-trial*.json` export was present in Downloads when checked.

## Existing behavior

The current `RadialThreshold` automatic mode slowly tracks the per-frame radius enclosing 60% of the raster's trace light. Its desired radius does not retain an offset calibrated from the user's chosen .33 threshold. It is a useful generic experiment, not a learned or calibrated transfer of this preference. The screenshot's instantaneous 58% outside must not be converted into a 58%-outside control target.

## Proposed next experiment

Keep the immediate raster-to-brightness response. Add a separate slower parameter controller; its observation window does not become a delay buffer for the brightness signal.

1. Capture a representative reference passage while the user's preferred settings are active. Retain audio identity and position, scope radial distributions over time, stereo geometry, level, onset activity, output occupancy and all display/timing settings. Begin with roughly ten seconds, then verify the preference on a longer passage containing a contrasting section. Duration is an experimental starting point, not a validated optimum.
2. Derive the relationship between .33 and the reference's typical scope size, for example .33 divided by median q60 radius across active reference frames. A causal rolling robust size estimate on a new passage supplies an initial reference-relative threshold hypothesis. Preserve the ratio 3.3 and inside/outside modes during this first test. Include bounds and slow parameter movement; use only preceding audio.
3. Compare reference-relative adaptation with the fixed preferred preset and the current generic automatic circle on exactly the same replayed audio and display. Test recording-level changes separately from real breakdowns/builds. Radius adaptation should accommodate changed signal scale without mechanically making quiet and loud musical sections equally active.
4. Include quiet texture, attacks, sustained bass, a build, a breakdown and silence. Record loss of small detail, saturation, unwarranted brightening, parameter drift, reaction lag and resets. Freeze or slow adaptation around short transients; reset between sources; never shrink the threshold continually through silence. Threshold bounds, freeze criteria and adaptation speed remain hypotheses to validate rather than musical labels.
5. Only after radius adaptation earns its place, test slowly changing strength and release independently. Brightness saturation and insufficient contrast are diagnostics, not sufficient artistic rewards by themselves. Keep an immediate attack path; output smoothing and parameter smoothing are separate decisions.
6. If reliable preferred examples accumulate across multiple identified passages, train a small causal controller to choose bounded threshold/strength/release adjustments from recent scope/audio features. Evaluate against both the fixed preference and the deterministic adaptive controller on reserved unfamiliar music. The fast scope-derived signal still yields one brightness channel.

A single source's gain change cannot generally be distinguished perfectly from an intentional musical amplitude change using level alone. Long-term normalization therefore needs explicit musical-preservation tests; it is not automatically correct because it stabilizes occupancy. Mono/stereo changes also alter scope geometry and need separate trials.

This turn records a preference and a concrete design; it does not implement reference calibration, select numerical adaptation limits, train a controller, or claim successful cross-song transfer. The missing source and hidden settings are retained as unknowns. The existing page is unchanged, preserving the user's current experiment.

Related technical reference: [FabFilter's time-control guide](https://www.fabfilter.com/help/pro-g/using/timecontrols) describes program-dependent attack/release behavior and the importance of preserving transients. It motivates testing time behavior separately; it does not validate our proposed light controller.
