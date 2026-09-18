# Wide-shot appearance baseline — not promoted

The fresh model is too flat and does not demonstrate useful timed conditioning.
It remains an offline experiment; the live scope prototype is unchanged.

The dataset retains peak brightness, lit area and energy independently for four
stage regions, plus masked global RGB chromaticity. This preserves small accents
and broad washes as different observations. It is mixed stage appearance, not
recovered lighting-console commands. Screen content, exposure, haze, camera
obstructions and audience audio delay remain limitations.

## Data and checks

Sampled source/target review covered four frames in each four-minute clip, plus
short source/target replay exports and inspected replay frames. This was not
exhaustive full-video inspection or human approval. Ravenscoon 10:00–14:00 was
excluded for unreliable registration. Fourteen clips remain: eight training,
three validation, three test. After model warmup and geometry masking, usable
observations total about 26.6 training minutes, 5.1 validation minutes and 10.6
test minutes. Color has additional masks. Missingness is scene-dependent, so
scores may overrepresent easy-to-track lighting states.

Train: Ravenscoon, ALLEYCVT and GRiZ. Validation: Levity Forest. Test: Of The Trees
Forest. Both Forest recordings stay together. Track overlap across DJ sets is
unknown. No RPMC-L2, prior trained weights or rejected editorial checkpoints.

Audio windows end at the matched video timestamp. Verified all 14 clips align
numerically and all features are finite. This does not correct physical audience
sound travel or establish true live light/audio latency. Seven-layer causal TCN,
25.5-second context, fresh weights; epoch 6 selected by validation from 50 epochs.
Prefix causality and chunk/whole inference errors were both zero in tested cases.
Missing-color loss and chromaticity normalization checks passed.

## Held-out result

Equal-clip averages over three Of The Trees clips; lower combined score is better.
The score averages four channel-group MSEs plus 0.2 adjacent-change error.

| Method | Combined score | Energy MSE | Temporal energy correlation | Energy change / observed change |
|---|---:|---:|---:|---:|
| Learned TCN | .13198 | .10873 | .093 | .103 |
| Same model, audio shifted 17 seconds | .13152 | .10805 | .057 | .103 |
| Training mean | .13754 | .11754 | .000 | .000 |
| Amplitude-only ridge | .13724 | .11669 | .036 | .045 |
| Instantaneous audio ridge | .13875 | .11445 | .010 | .382 |
| Direct scope-derived display control | .18954 | .18552 | .067 | .248 |

The learned model retains only 12.7% of observed temporal energy standard
deviation and 10.3% of adjacent-change magnitude. It improves average energy and
coverage fit against static/loudness controls, but color is worse than those
baselines. Wrong audio performs slightly better overall; the paired 60-second
block intervals do not establish superiority to wrong audio for any channel
group. Fixed +/-1-second timing diagnostics barely change the score. These
findings do not support musical timing or useful choreography. Validation was
also worse than the training-mean and amplitude-only controls.

The direct control's pixel-reconstruction score is not a musical-quality score.
This replay adapts scope signals to the 15-channel display contract; it is not
the stereo XY trace and is sampled at 10 Hz rather than the live path's 50 Hz.
Do not infer that the learned model improves the user-endorsed scope response.

The original evaluation pooled spatial channel differences into correlation and
variation. `temporal_evaluation.json` corrects those diagnostics by centering each
channel over time. Original artifacts remain preserved. Selection, MSE, frame
changes, bootstrap intervals and model weights are unchanged.

## Playable comparisons and next question

Three fixed, non-performance-selected 60-second test replays begin at 11:00,
31:00 and 51:00. Source, observed targets, direct mapping, amplitude baseline and
learned predictions use the same display mapping and original recording audio.
Verified each has 600 video frames at 1440×900, stereo audio and 60-second duration;
inspected representative rendered frames. Human musical-quality review remains
outstanding. No model promotion depends on an assumed user response.

Artifacts: `/Volumes/ExtremePro/Code/lightflow/research/wide_lights/run_v1`.
Replays: `/Volumes/ExtremePro/Code/lightflow/research/wide_lights/comparison_v1`.
Exports: `/Volumes/ExtremePro/Movies/Exports/lightflow_wide_model_forest_{11,31,51}m_9-16-26.mp4`.
Pixel-method comparison: `/Volumes/ExtremePro/Movies/Exports/lightflow_pixel_methods_9-16-26.mp4`.

Next hypothesis: learn when observed light states change, hold, build or release,
with explicit timing uncertainty, while the fast scope path retains audio detail.
Absolute RGB/brightness regression across different rigs encourages averaging;
this small negative experiment does not show that human visual decisions cannot
be learned. Before another training run, inspect relative event labels against
the source and establish an audio-conditioned event baseline. Do not present a
procedural visualizer or an average-looking regression as the completed director.
