# Live browser director — active work

## User quality rejection — supersedes the previous direction

The user auditioned the result and said it still feels like an energy meter.
Treat this as a failed product-quality evaluation. Better descriptor MSE,
phrase classification, increased variance, and passing browser tests do NOT
establish success. Do not continue tuning that formulation as the main path.

Reframe around **musical cue decisions and controllable visual gestures**:
- Data must retain cue timing/duration, holds/rests, layer/region selection,
  movement/geometry changes, transitions, and musical context.
- RPMC-L2 histogram summaries do not supply these explicit cue labels. They
  remain a secondary color/dynamics reference, not the main director teacher.
- Renderer needs expressive controls beyond global brightness/color/speed.
  An oracle controlling the existing few uniforms would still be limited.
- First prove the visual vocabulary with several authored short performances
  using local tracks. If these are not engaging, training cannot fix them.
- Record the authored actions, synchronized audio features, and user preferences;
  train a causal cue policy on that representation. Keep synthetic demonstrations
  distinct from genuinely human-authored data and held-out evaluation.
- Investigate rhythm-game authored lightshows (Beat Saber event groups and
  Rock Band/YARG venue cues) as external sequence pretraining, retaining their
  structure. Availability is not blanket licensing or proof of human authorship.

Verified references:
https://huggingface.co/datasets/RS2002/RPMC-L2
https://bsmg.wiki/mapping/map-format/lightshow.html
https://github.com/RS2002/Skip-BART

Next milestone: a demonstrably engaging authored show and replayable cue
recording format, before further model training. Existing app remains an
experimental baseline at port 3001, not the final solution.

Goal remains: microphone → natural, engaging, learned lighting direction for
unfamiliar music, fully offline, controlling ten React Bits-style animations.
A working visualizer is not completion. User grants overnight iteration.
Use **port 3001**. Do not open/reload the user's browser; share the URL.

## Implemented in this checkout

`/director` has ten original procedural visual interpretations, microphone and
local file input, ONNX inference in a dedicated worker, AudioWorklet capture,
continuous controls, scene crossfades, manual selection, blackout and intensity.
The existing `/live` and `/player` remain. Main page links to the new director.
`npm run dev` uses 3001; production preview: `npm run start -- --port 3001`.
Build output is `.next-production`, separate from development.

Offline service worker caches the director HTML, compiled chunks, models,
ONNX WASM and audio worklet. Root scope is necessary for dedicated-worker
fetches. It handles only director navigation and its assets. Network-off reload, file playback and simulated microphone inference all pass.
The favicon and Next Link prefetch errors are fixed. Latest browser report has
zero errors and no mobile overflow. All ten isolated canvas renders are
nonblank and distinct; blackout pixels are zero.

## Evidence so far

- Browser mel frontend vs Python: maximum error 2.86e-6 across 104 causal frames.
  `test_frontend.py` and `test_frontend.mjs`; report in artifacts.
- Selected descriptor model PyTorch vs ONNX max error 5.96e-8.
- Native ONNX p50 ~0.09 ms. Browser observations 0.4–0.5 ms. These are inference
  times, NOT microphone-to-photon latency. End-to-end timing still needed.
- Descriptor experiment trained all 20 epochs on 699 RPMC-L2 clips. Selection
  by validation MSE chose epoch 2. Test brightness MSE 0.03664 is WORSE than
  constant 0.03193. Activity and several color descriptors improve. Predictions
  have too little variance. Not a successful final director.
- Three local 90-second track probes show brightness standard deviation only
  0.0065–0.0108. Real failure evidence, not a passing musical-quality claim.
- Production build passed after removing an unused invalid export from the
  pre-existing shows API route.

## Current experiment

`scripts/director/train_phrases.py` trains an audio-conditioned 24-way lighting
phrase model. A phrase contains four half-second keyframes of seven real
concert-light histogram descriptors. Vocabulary fitted on TRAIN only.
Validation best so far: CE 3.033 vs prior CE 3.161; accuracy 13.9% vs majority
4.5%. Training completed all 16 epochs. Selected checkpoint is epoch 2. Test CE 2.922 vs prior 3.176; accuracy 5.43% vs majority 1.35%. Improvement is real under this limited split, but absolute accuracy is weak.
Outputs exist: `public/models/phrases.onnx`, `phrases.json`. The browser now runs both models and performs learned phrases using `src/lib/director/phrases.ts`. Phrase selection uses model logits with small continuity/repetition penalties; scene mapping remains procedural.
Further validation audit: correct-audio CE 3.033, shuffled-audio CE 3.325, loudness-only CE 3.210, prior CE 3.161. This supports using conditional audio information beyond loudness, under the limited clip split.

## Limitations and next work

1. Headless production baseline tests passed: online playback, ten distinct
   scenes, blackout, mobile width, offline reload+file, fake mic offline. Repeat
   after meaningful changes. Baseline is functional, not final musical quality.
2. Improve musical quality. Evaluate phrase model vs prior and loudness-only
   baselines, examine output trajectories, integrate a coherent phrase scheduler
   if supported. Current scene arrangement is procedural, not learned labels.
3. Measure end-to-end frame age and attack response, not just model.run time.
4. Reproduce real mic conditions (gain/noise/reverb), inspect tracks and visual
   outputs. Subjective quality is unproven. No physical mic or DMX test yet.
5. Improve visual fidelity: current ten effects are original GLSL sketches.
   Requested named React Bits components are Pro registry components requiring
   licensing per official installation docs; no registry is configured. Do not
   claim these are the actual React Bits components. Explore available exact
   components or improve the allowed mimics, especially 3D blob/pixel sculpture.
6. Production build, offline checks, and eventual hosting decision after the
   requested product is complete. No deployment or git push has been made.

## Data integrity and provenance

RPMC-L2 is locally mounted at `data/rpmc-l2/RPMC_L2.hdf5`, 699 clips.
Read-only source data; derived local cache `scripts/director/artifacts/concert.npz`.
Source: https://huggingface.co/datasets/RS2002/RPMC-L2 (CC-BY-4.0).
Features verified from actual HDF5: 128 mel bands match librosa defaults
(sr22050/FFT2048/Slaney) from stored STFT. Lighting is approximately 30 Hz,
audio features 22050/512 Hz. Current label alignment assumes 30 Hz, not a
verified per-clip timestamp map. Centered training STFT creates ~46 ms of
alignment offset relative to trailing browser FFT; account for this in next
training version. Fixed-reference log power avoids whole-song normalization.
Splits are deterministic by clip hash, NOT verified show-disjoint; no strong
claim of unfamiliar-show generalization. Never train against the quarantined
old v3 cache. Existing ML branches/checkpoints are preserved.

## Relevant commands

- `npm run build` (existing next/font may need network at build time)
- `npm run start -- --port 3001`
- `node scripts/director/browser-smoke.mjs` (headless installed Chrome, fake mic,
  no real microphone; local files only; writes evidence under artifacts)
- `python3 scripts/director/check_visuals.py`
- `python3 scripts/director/train_phrases.py` (check live session first)
- `python3 scripts/director/evaluate_tracks.py`

Do not mark the overarching goal complete based on this document or green
smoke tests. Verify the full user objective against actual runtime output.

Latest retained production server tool session: `4499`, port 3001.
Both training sessions are terminal (descriptor 77751, phrases 44740).
Latest successful browser+pixel verification session: `59976`.
Next: phrase-model shuffled-audio and loudness-only comparisons, then evidence-led
scheduler integration and richer visual fidelity. Goal remains active.

## Latest phrase integration iteration

- PhrasePlayer performs four learned keyframes over two seconds, with half-second
  joins. Deterministic selection uses logits, continuity cost, repetition cost.
- Local-track output brightness std: Damn Right 0.118 vs descriptor 0.018;
  Calabria 0.069 vs 0.008; McDonalds 0.118 vs 0.011. Greater variation is measured;
  improved subjective musical quality is still unproven. One automatic scene
  change per 90-second probe; inspect whether mapping is too conservative.
- Browser capture timestamps now refer to the last sample in each PCM block;
  worker subtracts the samples after each exact mel frame. Timestamp correction
  needs end-to-end telemetry/latency test, not inference-only claims.
- Build passed with planner. Retained preview session now `8993` (3001).
- Browser verification session `68075` passed: learned planner online/offline, fake microphone, all ten distinct scenes, and black blackout. Next: improve visual fidelity,
  measure pipeline age, and inspect musical output under room-like conditions.
