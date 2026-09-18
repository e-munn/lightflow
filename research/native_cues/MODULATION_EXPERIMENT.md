# Offline learned-modulation comparison

The last turn trained and verified a second candidate. Neither model passes
the cross-show cue forecast controls. This comparison asks whether its small
continuous modulation adds useful expression to the user-endorsed fast scope
path. It is an offline candidate demonstration, not live promotion or evidence
of a completed human-level director. No new fitting or thresholds are selected.

Use forecast_gain_v1, the same fixed renderer and the same 20 ms direct audio
features in four conditions: direct only, temporal-model modulation, current
causal-context logistic modulation, and temporal-model modulation with 17 s
delayed audio features. The delayed condition changes only the learned layer;
the direct layer always receives the correct audio. No circular wrap/future
audio for this control. The first fully supported delayed-model output requires
42.5 s of source context. Display clips start after 60 s of input context.

## Fixed policy before rendering

Keep intensity, hue, spread, texture, balance and immediate audio accent as the
medium-independent output. Their direct definitions match the scope adapter.
Intensity is in [0,1]; hue is a cyclic [0,1) palette coordinate; spread/texture
and accent are in [0,1]; balance in [-1,1]. Color remains a procedural mapping
of measured bass/air, not a learned fixture-color decision.

The near brightening/dimming probabilities get a causal 150 ms exponential
response; far probabilities get 600 ms. Start state at the training prior. Let
near_delta and far_delta be the corresponding rise-minus-dim differences minus
the training-prior differences. Intensity gain is
clip(1 + .6*near_delta + .4*far_delta, .75, 1.25). Multiply the unchanged direct
intensity by that gain and clip to [0,1]. No added light during exact silence.
Spread multiplier is clip(1 + .5*(mean_far_probability - mean_far_prior), .8, 1.2).
All other dimensions remain direct. These are explicit heuristic adapters of
learned probabilities, not trained dimmer commands, recovered holds or exact
event scheduling. Near changes are anticipatory preparation; immediate detail
continues through the unfiltered direct path. Saturation can still flatten peaks.

Hold only predictions whose audio endpoint plus a modeled 20 ms computation
allowance is at or before the output tick. This is an offline scheduling model,
not measured end-to-end latency. No future prediction interpolation. Before
context is ready use training priors, which reduce exactly to the direct output.
Process the entire causal prefix before clipping the display interval.

Browser mapping: full-screen brightness/palette and eight spatial zones. Conceptual
DMX mapping: intensity to calibrated master/group dimmer; hue to fixture RGB/color
adapter; spread and balance to fixture-group weights. No pan/tilt/strobe channel
commands or hardware output in this experiment. The same renderer is used in all
four conditions, avoiding extra effects that could make one condition look better.

## Fixed examples and checks

Forest wide recording 31:00–32:00, development only. Jack White 35:00–36:00,
exploratory unseen recording/genre; no paired clean lighting targets or genre
success claim. Both are outside this model's fitting; track overlap elsewhere
in the corpus is not exhaustively identified.

Test prior neutrality, exact silence, bounds, mono spread, immediate transient
response, unchanged prefixes and prediction availability. Store output traces
and quantify changes, saturation and gain ranges. Render source footage, the
unchanged scope and all four lighting conditions with original stereo audio.
Review representative render frames and verify duration/frame/audio/hash data.
Leave actual preference and musical-quality judgment open for the user; do not
convert numerical preservation checks into human-quality approval.
