# Learning from the edit — hypothesis and target contract

User direction: edited concert video may contain useful musical judgment in shot
selection, pacing, cuts, holds and reveals even where physical lighting choices
cannot be recovered cleanly. Current corpus is electronic-first (nine shows).

The hypothesis is that audiovisual editorial structure can teach a shared notion
of musical attention and pacing. It is NOT evidence that camera edits equal
lighting cues or that the editor and lighting engineer made the same decisions.

## Three separately attributed teaching sources

- Direct audio / stereo scope: fine response, detailed dynamics and geometry.
- Within-shot lighting observations: regional changes with masks for camera,
  exposure, graphics and occlusion uncertainty.
- Editorial sequence: cut/transition times, shot holds and duration; later
  close/wide view type, reveals and changes of attention after image review.

Do not discard a cut: invalidate the continuous-light measurement across it,
then retain it in the editorial sequence. Maintain independent confidence and
provenance for each stream. No exact desk-command reconstruction is assumed.

## Initial editorial targets

A detected cut is an inferred event with model score, source timestamp, sample
rate and boundary uncertainty. Visually confirmed cuts get a separate review
flag; detector confidence is not human approval. Durations between boundaries
are observed edit holds, not light holds. Camera viewpoint labels require
explicit visual evidence. Effects/flashes can be false detections.

Learned outputs to test: probability and timing of an upcoming editorial change,
and expected persistence of the current editorial pace, from past audio only.
Use a longer causal audio context alongside the unchanged immediate scope path.
A later lighting policy may use this as a pacing prior; it must decide lighting
behavior independently and demonstrate improved rendered musical judgment.

## Evaluation before transfer

- Held-out artists/shows and duplicate-track checks; electronic genre scope.
- Average edit-rate, tempo-only, recent audio-energy and shuffled-audio controls.
- Exact timestamp / ±tolerance event matching, false/missed changes and duration
  calibration. Use calibration/validation only for thresholds and policy choices.
- Blinded playable comparisons: direct scope baseline, lighting-only learning,
  and combined lighting/editorial learning. Assess accents, restraint, builds,
  releases, transitions and fine responsiveness. More cuts/changes is not better.
- Cross-genre claims wait for separate diverse data and evaluation.

Current state: all four scans completed (Levity 1,498, Whethan 1,119,
REZZ 1,280, Skrillex Chile 1,596 threshold-.5 candidates). Sampled visual reviews
led to confidence masks and explicit ambiguity flags. The first model was
trained and rejected: it did not beat simple controls on the separate test
production. See `RESULTS.md`; no transfer-to-lighting benefit is demonstrated.

Jack White at Pine Knob was added after this contract was fixed. Keep it outside
these splits as an exploratory rock holdout. Its sampled monochrome footage
cannot provide color targets. One rock show is not broad genre validation.

## Pilot v1 fixed contract

Train: Levity Coachella and Whethan EDC. Validation: REZZ Coachella. Test:
Skrillex Chile. Different shows/artists; overlapping tracks are still possible.
The held-out Chile production offers an additional production-domain change.

Eight causal scope features are pooled over trailing 200 ms blocks into mean
and maximum (16 inputs at 5 Hz). Exact blocks end at .2, .4, .6... seconds; no
centered pooling. Separate 50 Hz direct signal continues preserving detail.
A fresh left-padded temporal CNN uses six kernel-3 layers, 16 channels,
dilations 1–32: 25.4 s receptive field. Three probability heads:
- a cut 0.2–1.0 s ahead;
- a cut 1.0–3.0 s ahead;
- no cut over the next 5.0 s (editorial hold).
These are inferred editorial targets from TransNet V2 boundaries, not human
lighting cue labels. Detector scores/visual audit stay separate from probabilities.
Target endpoints without full future labels are excluded. Initial 126 frames
are warmup and are not scored. Normalization fitted on train only.

Pre-training visual audit rejected the original unfiltered .5 detections:
flashes sometimes masquerade as camera cuts. The .8 subset also failed on
Whethan. For this exploratory pilot only, use .9+ candidates as weak positive
evidence; reviewed ambiguities are demoted. Any lower-confidence candidate
masks a no-cut claim in its future target window unless a strong candidate
already proves a cut. Record per-head coverage and score only unmasked labels.
See `label_review.json`. These are selective, detector-defined labels, not
complete editorial ground truth. Neither detector recall nor exact boundary
timing is validated. A statistical win justifies further review, not deployment
or a claim of learned human lighting direction. Threshold selected on training
show reviews before seeing validation/test modeling results.

Compare calibrated probabilities with train prevalence, a logistic current-
amplitude-only baseline, a tempo/phase logistic baseline, and a 17 s wrong-history
shift. The tempo comparator estimates 60–200 BPM from the past 16 s of onset
autocorrelation and two phase harmonics; it is a simple control, not robust beat
tracking. Verified on a 120 BPM pulse train, silence and identical prefixes with
different futures. Report per-head AP,
prevalence, Brier score, and output variation; choose checkpoint on validation
Brier score only. A positive result must survive the separate test show before
we test transfer to a rendered lighting policy. Never silently add target cut
history as input: the live audio source has no access to the video edit.

Test uncertainty uses paired 60-second blocks (2,000 bootstrap draws) for Brier
differences. This addresses temporal correlation within the one held-out show;
it does not establish generalization across all productions or genres.
