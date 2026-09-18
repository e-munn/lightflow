# Native-clock cue-label pilot

The previous goal turn made progress: quantified sampling sensitivity, reviewed
screen/fixture differences and demonstrated late short-flash release labels.
This pilot corrects those observation/target issues before another model run.
The full live, predictive, human-quality director objective remains unchanged.

## Observation contract

Decode every available source frame without an fps filter. Preserve exact integer
PTS and time base, and compare all decoded timestamps with ffprobe. Store the
source timestamp rather than assigning i/fps. Missing source frames remain gaps.
Reuse existing reviewed registration transforms and geometry masks for now;
these are not new or improved camera tracks. Retain color/clipping uncertainty.

Use the ten fixed 20-second audit spans, with one second of context at each end.
Preserve four regional energy values, raw mean luma, lit coverage, clipped fraction
and color support. No per-frame normalization. This is a pilot, not enough data
for training admission or musical-quality validation.

Keep region provenance explicit: GRiZ = screen dominated; Ravenscoon = mixed
screen/beam; ALLEYCVT, Levity Forest, Forest = candidate beam/fixture fields with
possible contamination. Do not pool the first two as generic physical-light
targets. These tags separate evidence types; they do not magically isolate pixels.
New spatial masks require separate visual review before changing that status.

## Edge and slower-change meanings

An observed edge is a >=0.25 change in mean mapped regional energy between two
consecutive valid source frames, with interval <=50 ms. Its timestamp is the first
frame showing the changed value. It is bounded by the previous/current frame PTS,
not a physically exact switching time. There is no 300 ms contrast timestamp and
no same-sign nonmaximum suppression that could merge separate strobes.

Changes of 0.12–0.25 are ambiguous for this candidate definition; smaller changes
are not strong edges. Real ramps may never form a strong single-frame edge. Keep
their separate signed one-second energy trend as a slower-change descriptor.
Do not call a lack of edges a hold: motion, color or screen content can still change.
All consecutive-frame or one-second descriptors require complete valid support;
gaps, uncertain geometry and registration updates cannot become synthetic cues.

Candidate predictive outputs, if this pilot is later admitted: probabilities of
an observed brightening/dimming edge over a specified future interval, plus separate
slow-state controls. These are medium-independent event signals. A browser/DMX
policy would schedule accents/releases and modulate the direct stereo path only
after validation. No policy or live output is changed in this pilot.

## Checks before use

Test one-frame flashes, long steps, ramps, repetitive strobes, missing frames,
unknown geometry and unchanged prefixes. Inspect before/event/after source frames
and compare edge timestamps with the old contrast events. Assert source timestamps
match ffprobe and keep all old files. Exposure-induced changes can remain false
edges; passing synthetic tests is not concert ground truth or human judgment.
