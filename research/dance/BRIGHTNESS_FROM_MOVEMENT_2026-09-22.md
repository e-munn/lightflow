# What should movement teach one brightness signal?

Use **movement intensity as the continuous carrier, with starts, stops and holds
controlling its envelope**. Keep arm and leg evidence separate until this final
projection. Do not add every available metric into a weighted brightness sum.
This is a proposed experiment, not a validated light target or a trained model.

## Why these measures

| Measure | How to estimate it | Proposed job in brightness | Main failure to guard against |
| --- | --- | --- | --- |
| Local movement intensity | Body-relative joint speed, normalized by torso scale; separate arm and leg groups and retain their confidence masks | Continuous light level during moving phrases; compress the range so subtle movement remains visible | A whole-body mean dilutes a small hand gesture; camera motion and jitter can look like activity |
| Starts and sudden accents | Rise in reliable group speed over roughly 80–120 ms compared with the preceding 300–500 ms | Temporarily shorten attack; allow a clear, brief brightness accent | A one-frame pose jump is not a musical hit; require several reliable observations |
| Arrivals / controlled stops | A substantial fall in speed after actual movement, followed by a short stable pose | End a gesture decisively, with a short arrival accent or a crisp level hold | Raw acceleration/jerk strongly magnify tracking noise; a hidden wrist is not a stop |
| Holds and releases | Stable reliable limbs and torso after movement, with duration and confidence | Retain the previous level for a bounded time, then release gently | Stillness should not automatically mean darkness; missing frames must never create a hold |
| Expansion / contraction rate | Change in distance of reliable hands/feet from the torso, rather than absolute pose width | Optional slow envelope bias for opening and closing phrases | A wide resting stance and body size should not make a song permanently bright; turns change 2D projection |

Keep **arm-versus-leg dominance** as a control context, not another brightness
term. When clean footwork carries a passage, let leg activity drive the carrier;
when a relatively still body articulates with the arms, let arm activity lead.
Use a smoothed dominance estimate with hysteresis so it does not switch every
frame. If one group becomes unavailable, mark that group missing; do not
reinterpret it as quietness. Exact thresholds need auditioning.

Torso/global travel is a separate diagnostic. Leave it out of the first light
projection: camera translation, pans, zoom and perspective can imitate travel.
Fine fingers, chest pops and facial expression are also poorly represented by
the current body skeleton and must not be claimed as captured detail.

## What the expanded data already changes

The first new **Crave You** passage has about 99% leg visibility but only 61% arm
visibility; requiring every major joint reduces complete-pose coverage to 60%.
**Studio Sorcery** has essentially 100% leg visibility but 72% arm visibility.
These are confidence/visibility counts, not proof of correct joint locations.
They support separate group masks before attempting any new supervision.

On jointly valid observations, arm and leg speed correlation is approximately
−0.04 in **Thriftworks**, 0.06 in **Cradles**, and 0.06 in **Feel the Way I Feel**.
Those are within-passage measurements, conditional on the current visibility
mask; they suggest that collapsing the limbs immediately loses distinct motion.
They do not establish correlation with musical components or lighting quality.

The earlier audio model used absolute extension heavily and averaged away
timing. The new experiment should test event timing and envelope behavior before
trying to learn exact posture or a blended light label.

## The smallest useful comparison

Use the same well-tracked passage and the same single fullscreen light field:

1. **Motion only:** normalized arm/leg movement carrier with a fixed envelope.
2. **Motion with phrasing:** the identical carrier, with reliable starts/stops
   changing attack/release and confirmed holds briefly retaining the level.
3. Retain the preferred stereoscope as the unchanged reference.

Only one hypothesis changes between the first two views: whether movement
phrasing improves expression. Keep gain and average brightness comparable so
the brighter view does not win automatically. Do not add expansion, travel and
every other signal until that comparison establishes a benefit.

Review sharp popping, continuous footwork, restrained passages and transitions.
Label a small set of actual arrivals/holds in synchronized video and music;
automatic cue counts are proposals, not truth. Inspect shifted-audio and
wrong-song controls, source A/V offset, extraction mistakes and added filter lag.
Select source/song-level splits only after deduplication; two excerpts of one
upload are not two independent songs. Reserve fresh songs for a final model
test rather than reusing the consumed pilot test set.

## Smoothing and eventual live input

The player's [1€ filter](https://gery.casiez.net/1euro/) is display-only. Steadiness
lowers the minimum cutoff; fast-movement response raises the cutoff with speed.
More smoothing introduces lag. The gray raw trace makes the tradeoff visible;
turn smoothing off for original coordinates. Confidence gaps, cuts, track
changes and source boundaries reset state. Every source frame is processed in
timestamp order, so a seek or playback-rate change retrieves the same result
instead of dragging a stale pose across the screen. Coordinates on disk remain
untouched. Saved controls are local to the browser.

The existing offline movement analysis is a different filter: centered ±60 ms
fits and whole-passage scaling. Those labels use future video. Do not confuse
them with the causal display filter or promise that they are live audio features.

The eventual model would infer activity and phrase events from **past/current
audio only**, then feed this one-channel envelope. Predicting a stop before it
happens requires evidence from musical context; the skeleton itself does not
solve anticipation. For now we are building and reviewing the observed teacher
signals, not retraining the failed predictor or generating live dance from music.
