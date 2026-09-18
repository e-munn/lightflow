# Shot boundary audit

The original edge-change pilot missed known cuts. A second full Levity scan
used normalized image residuals and ORB matches at 2 Hz. It proposed 137 segments
of at least 6 s, selecting 32 for inspection. Visual review of the first 16
showed many intervals still contained obvious camera cuts. Do not treat these
as valid stable shots. Persistent logos and stage structures can maintain feature
matches across different views. This heuristic is rejected as a training gate.

## Dedicated detector

TransNet V2, official PyTorch code from https://github.com/soCzech/TransNetV2.
MIT code/license saved with SHA-256 in the external third_party folder. Converted
checkpoint distributed by ByteDance/shot2story at revision
ff853c571fd92eb4e0c5713e27f2a323ac903f67; SHA-256
a313d0b3bebfa9a71914b375bfdf918a30b5c3b1e6be51972d35dd8078b442de.
Loaded with torch.load(weights_only=True). No RPMC-L2 relation or dependencies.
Upstream conversion parity has not been independently verified here.

Offline video cleaning uses future frames, which is allowed for constructing
labels. The LIVE audio model still must use only received audio. Do not confuse
the two causality requirements.

Trial: Levity 75–120 s, resampled to 30 fps, frames reduced to 48×27 RGB.
100-frame windows; keep central 50 predictions; threshold .5. Four detections:
96.533, 109.067, 114.867, 119.133 s. Before/transition/after frames visibly confirm
four camera cuts. The small review verifies those detections only; recall and
behavior under strobes/fades remain unmeasured. A full-show scan is launched;
inspect its live tool handle before deciding whether it has completed or stopped.

The 75–96 s stretch appears to keep a stage-wide view with changing imagery
and zoom. Shot continuity does not prove a stationary camera or clean labels.
Stage masks still require alignment, exposure/occlusion review, separation of
screen content from physical beams, and synchronized cue inspection.

Artifacts:
- /Volumes/ExtremePro/Code/lightflow/research/concert_cues/levity_shots_2026-09-16_v1/
- /Volumes/ExtremePro/Code/lightflow/research/concert_cues/transnet_levity_trial_v1/
- /Volumes/ExtremePro/Code/lightflow/research/concert_cues/transnet_levity_full_v1/
- /Volumes/ExtremePro/Code/lightflow/research/third_party/transnet_v2_2026-09-16/

GPU verification: MPS is available when the local process has the required host
access. The same 45-second trial produced exactly the same four cut timestamps;
max CPU/MPS probability error 2.69e-7. Trial inference fell from ~15 s to ~5 s.
The verified CPU full-show process was intentionally stopped for this performance
improvement, not because a poll timed out. Its directory and an explanatory
STOPPED_FOR_GPU.json are preserved. Replacement output is
`transnet_levity_full_gpu_v1/`; initial tool session handle `23323`. Always poll
that handle or inspect the actual process before deciding its current status.

Editorial refinement: these boundaries now have two uses—protect within-shot
lighting measurements and retain the video's edit rhythm as separate supervision.
See ../editorial/EXPERIMENT.md. Cutting pace is not discarded as noise, nor
silently treated as physical lighting behavior.

The MPS full Levity scan completed: 3,930.73 decoded seconds, 1,498 candidate
boundaries, 274.4 seconds inference after buffered decoding. These remain
unreviewed proposals apart from the small trial. The streaming implementation
produced bit-identical single/many probabilities on the same 45-second GPU
trial. Its padded windows also matched the buffered implementation exactly for
18 short/tail cases from 1 to 151 frames. Future full scans can use `--stream`
to bound decoded-frame memory and overlap decoding with inference.

Completed streaming scans: Whethan 3,567.93 s / 1,119 candidates; REZZ
3,339.43 s / 1,280; Skrillex Chile 5,445.80 s / 1,596. Random and low-confidence
review sheets found same-view flashes even above .9 confidence. Model score is
not ground truth. `../editorial/label_review.json` records sampled judgments;
the selective weak-label editorial pilot masks these cases and did not pass
the separate-show prediction test. No detector-only shot is an automatically
accepted physical-light training interval.
