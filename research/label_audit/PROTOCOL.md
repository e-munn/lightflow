# Cross-show observation audit

The preceding goal turn made progress: completed the frozen music-feature
comparison, ruled it out for live use, and exported a verified playable diagnostic.
This audit addresses the next uncertainty, not a new definition of success.

No fitting, threshold selection against model scores, or live-policy promotion.
Preserve the fourteen admitted clips and labels_v2 unchanged. Forest is development
data; this audit cannot supply a fresh final evaluation. No RPMC-L2.

1. Profile all fourteen clips after the same 25.4-second model warmup, excluding
   the last two seconds. Measure retained geometry, forecast-label coverage,
   positive frequency, clipping, brightness distribution, and opposite-event
   spacing. Rapid rise/release pairs can be real flashes; do not call them errors.
2. Recompute only the observation mapping at gains 4.8, 6 and 7.2 instead of 6,
   leaving source geometry and the event threshold unchanged. Recover per-region
   mean luma by inverting the stored 1-exp(-6*mean_luma). This tests sensitivity to
   our mapping, not physical camera exposure or calibrated light intensity.
   Report event agreement and label changes; do not adopt a winning gain.
3. Re-extract 30 Hz observations on two fixed 20-second spans (offsets 60 and 180)
   from five clips: Ravenscoon 3000, ALLEYCVT 1800, GRiZ 1800, Levity Forest 2100,
   Forest 1800. These cover every source, including bright/low-event training
   examples and the repeatedly inspected Forest test. The selection is diagnostic,
   not a representative random sample or independent test.
4. Use the existing 10 Hz registration transforms, held to the next transform;
   carry the existing geometry uncertainty. Compare 30 Hz event detection with
   each of three 10 Hz decimation phases, with the same 300 ms difference and
   300 ms same-sign suppression. Match events one-to-one within 100 ms. This
   quantifies sampling sensitivity, not event precision against ground truth.
5. Inspect source/curve examples and document what remains unknowable. Infer
   next targets only after these checks. A high event-agreement score does not
   establish human musical judgment, and a smoother target is not automatically
   a better teaching signal. Preserve the fast stereo-scope path.

All generated data and imagery go into new folders on ExtremePro. Existing
source files, datasets and exports are never deleted or overwritten.
