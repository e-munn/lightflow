# Spatial appearance instead of a single brightness average

The previous turn made progress by rejecting misleading hold/build candidates.
This turn implemented and tested a spatial review descriptor on those same four
eight-second spans. No labels were admitted, weights changed or live model promoted.

## Descriptor and boundaries

Registered source RGB is converted to display-space luma (.2126R+.7152G+.0722B),
not linear physical radiance. Each pixel's 20th percentile across the eight-second
clip supplies a persistent-appearance map. Positive and negative residuals retain
appearance above/below that map, reconstructing original luma as base+plus-minus.
This percentile uses the full clip: OFFLINE review only, never causal model input.
Persistence does not prove a background object, and a persistent light is still a
light. No physical fixture/screen segmentation is claimed.

Store residual mean, area exceeding .08 luma above persistence, residual-weighted
centroid with validity, and mean absolute pixel change on native frame times.
Separate the existing measured regions from the broader registered tracking-box
context outside them. The latter explicitly includes screens, structure and other
non-fixture content and is not pooled into lighting targets. First-frame change
has an invalid flag, because no preceding sample was decoded. Version 1 lacked
that explicit flag and included its zero placeholder in averages; version 2
corrects this, preserving version 1.

## Evidence

All 960 frames match independent source timestamps within .334 microseconds.
Maximum base+residual reconstruction error is 5.97e-8. Synthetic equal-brightness
left/right alternation has zero mean-brightness change but nonzero pixel activity
and changing centroid. A static field has zero residual/change. First-frame
validity and finite centroids pass. Four review sheets were visually inspected
(three times each); this is not continuous playback or musical listening review.

| Span | Measured pixel-change mean | Broader-context pixel-change mean | Measured excess, first 2 s → last 2 s |
|---|---:|---:|---:|
| GRiZ 1949–1957 | .00137 | .01042 | .00626 → .01244 |
| ALLEYCVT 1825–1833 | .07330 | .02017 | .15568 → .06247 |
| Forest 3209–3217 | .03004 | .01618 | .06291 → .00556 |
| Ravenscoon 2011–2019 | .01168 | .00697 | .04922 → .03314 |

Values are observed display luma, not dimmer commands; differently sized regions
are normalized by pixel count. In GRiZ, the wider context changes about 7.6 times
as much as the nominally stable measured areas. This supports the earlier sampled
finding that quiet regions cannot stand for a whole-stage hold. Forest's active
interior contribution drops substantially while the persistent map retains the
border. The review makes that partial-field transition more legible than a single
brightness slope. ALLEYCVT still shows strong rapid activity despite an overall
decline. Ravenscoon retains side structures and changing interior elements.

Residual images also contain audience objects, screen changes, haze and imperfect
registration/exposure effects. The decomposition helps describe where appearance
changes; it does not solve their provenance. No claim of deliberate builds,
engineer intent, cleaner supervision or musical-quality improvement is justified.

## Next experiment

Use these distinct quantities to review active-pattern transitions at native
speed with music, while preserving explicit scene-context separation. Test a
trailing baseline with reset/validity rules before scaling any descriptor that
will be computed online; otherwise keep the full-window percentile strictly in
offline review. A subsequent target contract should distinguish intensity,
activity/occupancy and position, with uncertainty masks, rather than attach a
hold label to a flat mean. Human evaluation and physical latency remain open.

Authoritative output:
`/Volumes/ExtremePro/Code/lightflow/research/native_cues/spatial_persistence_v2/`
contains report.json, per-span NPZ descriptors and review sheets. Version 1 and
all earlier SanDisk files are preserved. Reproduce with spatial_persistence.py
--out <NEW_EXTERNAL_DIRECTORY>.
