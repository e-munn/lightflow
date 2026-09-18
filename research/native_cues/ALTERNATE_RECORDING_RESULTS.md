# Same performance, different recording

The preceding timing audit was progress: it isolated within-clip failure beyond
average calibration. This experiment probes recording dependence without a new
fit. The full lighting-director goal remains active and unverified.

## Controlled comparison

Use the two already matched Of The Trees Forest recordings. Wide-shot video,
all original targets, masks, prediction times, saved gain-augmented model weights
and baseline weights remain fixed. Replace the audio with the other recording.
No Forest examples enter fitting and no lighting labels select alignment.

Nine fixed 20-second audio windows, three per four-minute clip, refine the old
content alignment. The spectral-change match uses 64 ms windows on a 10 ms grid.
Peak correlations .460–.736 exceed alternatives outside 100 ms by at least .35.
Offsets differ from the earlier global mapping by 0–10 ms, with 6.1 ms variation
inside each clip. A median constant offset per clip is used; measured global
clock drift implies less than 10 ms change over 240 seconds. This is content
matching, not proof of physical A/V synchronization or a confidence interval.
Neither recording is designated clean studio audio.

Each alternate clip yields 12,000 raw feature rows and 2,400 model queries.
Paired evaluation begins at 42.5 seconds so both the correctly timed and
17-second-delayed predictions have full past context. No circular wrap. This
common support differs from earlier full-warm-up reports; compare the numbers
within this experiment, not directly with older .3194 scores.

## Result

Pooled four-head Brier error (lower better):

| Condition | Wide-shot recording | Alternate recording |
|---|---:|---:|
| Learned model | .340362 | .282814 |
| Learned model delayed 17 seconds | .336749 | .289667 |
| Loudness control | .280839 | .283660 |
| Current-context control | .284860 | .259853 |
| Tempo/phase control | .284595 | .283880 |

The alternate recording changes model behavior substantially. It improves two
clips (.33588→.27098 at 10 minutes and .40284→.28354 at 50 minutes) but worsens
the 30-minute clip (.27809→.29430). The pooled improvement is .05755, about 16.9%,
without changing weights. This demonstrates dependence on the recording, not
reliable general improvement from a preferred source. The simple context
control remains better in the pooled comparison.

Paired 60-second block-bootstrap intervals within this one performance include
zero for all three aggregate differences: alternate minus wide [-.12736,.00666],
alternate minus context [-.00372,.04728], and alternate minus delayed
[-.06789,.04687]. Twelve blocks include partial tails. These intervals are not
independent-show evidence. Correct timing has not passed a dependable transfer
gate. No human musical-quality claim follows from these probability scores.

## Verification and next decision

Independently checked exact equality of saved time/target/mask arrays, hashes of
original prediction files, and float64 score recomputation (maximum difference
3.99e-8). Existing model and media files remain unchanged. New artifacts only:

- `/Volumes/ExtremePro/Code/lightflow/research/native_cues/alternate_alignment_v1/alignment.json`
- `/Volumes/ExtremePro/Code/lightflow/research/native_cues/alternate_recording_v1/report.json`
- Same directory: features, predictions and `verification.json`.

Do not substitute the alternate recording into training or silently treat its
better aggregate score as deployment approval. Recording robustness deserves a
training-only intervention beyond constant gain: test plausible spectral/room
variation while preserving timing, select using existing validation, and keep
both Forest recordings paired in development evaluation. First verify the
augmentation against actual waveform processing; feature arithmetic alone must
not invent invariance of scope breadth, texture or transient shape. In parallel,
weak appearance targets still omit deliberate holds/builds and may reflect
production artifacts. Better recording robustness alone cannot fulfill that
missing supervision or the required human and physical timing evaluations.
