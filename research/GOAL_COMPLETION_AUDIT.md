# Full-goal audit — 2026-09-17

The objective remains unchanged. The trained runnable prototype is NOT the
completed human-quality lighting director. This audit directly reopened the
saved evaluation and browser evidence rather than assuming success from prior
summaries. The previous goal turn made progress with the stale-audio fix.

| Requirement | Current authoritative evidence | Conclusion |
|---|---|---|
| Live microphone/system input | native_cues/browser_streaming_v2/browser-test.json: synthetic non-silent capture passes; physicalInput false | Software path works; real-device behavior not proved |
| Stereo-scope detail foundation | Streaming feature/policy parity; mono/stereo tests; direct path preserved | Implemented, human comparison still required |
| Causal anticipation | Prefix/chunk checks pass; forecast transfer metrics below | Causal implementation proved; useful anticipation not proved |
| Human-level musical judgment | blind_review_ui_v2/evidence-audit.json: zero eligible human trials | Missing |
| Holds/builds/releases/phrases | STRUCTURE_REVIEW.md rejects semantic hold/build admission; spatial descriptor is observation only | Incomplete supervision and behavior |
| Generalization to unfamiliar songs | Saved file/Jack White execution and playable comparisons; Forest repeatedly used for development | Execution established, generalization quality not established |
| Medium-independent intensity/dimensions | Cue output and pure fixture adapter; FIXTURE_ADAPTER.md | Implemented experimental contract |
| Browser and DMX rig | Browser works; fixture_preview_v1/test-report.json: hardwareTransmission false | Browser implemented, physical fixture output/calibration unverified |
| Precise end-to-end timing | Software timing only; physical probe/analyzer tested synthetically | Real recording and calibration absent |
| Playable comparisons and human evaluation | /scope/modulation and /scope/review available, tested | Comparisons ready; human evaluation absent |
| Storage/exclusions | New versioned external outputs, fresh native models, source snapshots | Current work preserves SanDisk assets and excludes RPMC-L2 |

Saved Forest mean four-head Brier (lower is better), reread this audit:

| Model | Learned | Loudness control | Wrong history |
|---|---:|---:|---:|
| forecast_v1 | .332336 | .263869 | .333287 |
| forecast_gain_v1 | .319355 | .266914 | .318910 |
| forecast_recording_v1 | .324938 | .258369 | .319624 |

These do not prove a useful transferable lighting predictor. Another small
parameter adjustment cannot be counted as completion or substitute for musical
review. Artifact names containing “trained” describe weight fitting, not success.

## Current dependency

The human judgment and physical capture requirements require external evidence.
The specific questions about musical shortcomings and available timing setup
have already been presented to the user and remain unanswered. A targeted check
of Downloads for lightflow*review*.json and lightflow*timing*.json found no exports.
Automated UI ratings are explicitly excluded. Existing test jobs completed; no
training continuation is being claimed from a status file or an old handle.

Next action with new evidence: audit an exported listening judgment, identify the
musical failure it describes, and use the declared capture setup to obtain a
calibrated recording. If judgments reject the current expression, revise the
behavior/supervision before collecting more identical metric-only experiments.
This is the first consecutive dependency audit since the last concrete progress;
the goal remains active and is not marked complete or blocked here.
