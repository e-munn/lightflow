# LightFlow ML Roadmap

> Historical roadmap. For the `codex/new-research` direction, read
> [TRAINING_GOAL.md](TRAINING_GOAL.md) before any training run. The current goal
> is one continuous brightness signal that retains stereoscope detail and adds
> context-dependent expression. Additional output dimensions are deferred.
> RPMC-L2 is excluded from the new work.

Plan for evolving LightFlow from a deterministic, per-song precomputed light show into a learned model that can drive live shows from microphone input — and continue to be tweaked and improved over time.

## Where we are today

- **Webapp** (`src/`) — Next.js UI with stem-aware attention layer, Director (auto-picks raw / strobe / pulse / blackout per bar), Program Focus Timeline, energy-waveform scrubber, drag-and-drop with server-side analysis.
- **Analysis pipeline** (`archive/v3-python/analyze.py`) — htdemucs stem separation, librosa BPM + section detection, per-frame stem energies / onsets / pans / centroid / spectral flux at 30fps.
- **Director** (`src/lib/modulators.ts`) — deterministic state machine that picks effects from stem/centroid/variance/beat-phase, bar-locked, with rate-limiting.
- **Output** — for any song with analysis we precompute a Program Focus Timeline (`programBlocks`) of stem focus + effect choice across the entire track.

This is the **deterministic teacher** that everything below builds on.

## Goal

A model that takes **live audio (mic, line in)** and produces brightness + stem-focus + effect decisions in real time, with comparable taste to the current deterministic Director — and a workflow for tweaking it over time.

---

## Phase 1 — Data pipeline at scale

### Storage layout

```
songs/
  {audio_sha256}/
    audio.mp3              # source
    analysis.json          # demucs stems + bpm + sections + per-frame features
    show.json              # precomputed program timeline (current Director output)
    metadata.json          # title, artist, genre, source, license, bpm, duration
```

- Hash by audio content → free dedup.
- Blob storage on R2 / B2 / S3.
- SQLite or Postgres for metadata + search.

### Batch analysis

- Demucs on CPU: ~60–90s/song. On a single GPU: ~5–10s.
- 5000 songs on a 4090 ≈ 7–14 hrs. Easy overnight job.
- Lambda Labs A100 ≈ $1/hr → 5000 songs in ~5 hrs for ~$5.
- Refactor needed: turn `analyze_cli.py` into a directory walker that hashes inputs, skips already-analyzed entries, and writes the hashed layout above.

### Sourcing songs

- **Free Music Archive** (~150k CC tracks) — best legal corpus.
- **Jamendo**, **ccMixter**, **MTG-Jamendo** (used by Spotify research).
- Personal library for taste calibration.
- ⚠️ Do **not** train on commercial music if there's any chance of shipping it.

---

## Phase 2 — The model

Two architectures, one to start with, one to add later.

### Option A — Imitation learning *(start here)*

Map **audio features → Director decisions**, learning from precomputed shows.

**Inputs (per ~30ms frame):**
- Mel spectrogram, last 1–2 seconds (gives the model "ears")
- Beat phase, BPM estimate, spectral features
- *Optionally* stem energies during training (teacher-forcing); model learns to predict without them at inference time

**Outputs (per frame):**
- Brightness (0–1, regression)
- Dominant stem (5-way softmax: bass / kick / snare / hat / other)
- Effect choice (4-way softmax: raw / strobe / pulse / blackout)

**Architecture:**
- Small transformer or 1D conv-net on a sliding mel window
- ~5–20M parameters
- Trains in a few hours on a single GPU
- 30fps CPU inference is trivial

**Training data:**
- 5000 songs × 4min × 30fps = **~36M (frame_features → director_choice) pairs**
- Each `programBlocks` entry contributes labels at 30fps over its `[start, end]` interval
- Massively over-determined relative to model size

**Key trick — stem distillation:**
- The deterministic Director uses live stems, but a mic feed doesn't have stems
- Train a "stemless" student: input = raw mel only, target = stem-aware Director output
- This is the same idea as [demucs distillation](https://arxiv.org/abs/2402.02075)
- Works well in practice; the model effectively learns an implicit cheap stem separator

### Option B — Preference / RL learning *(later)*

- Watch shows live, thumbs-up/down moments
- Tiny dataset (~hundreds of labeled segments) goes a long way once the imitation baseline exists
- Use as a fine-tuning layer on top of Option A — **don't start here**

---

## Phase 3 — Live mic inference

### Pipeline

```
mic ──► circular buffer (2s)
    ──► mel spectrogram (~10ms)
    ──► trained model (~5ms)
    ──► existing modulators (raw / strobe / pulse / blackout)
    ──► LED output / WebGL render
```

**Latency budget:** 30–80ms total. Achievable on a Mac mini.

### Live BPM tracking

- Offline beat trackers (`librosa.beat.beat_track`) are too slow / wobbly live.
- Use **BeatNet** (PyTorch streaming, ~30ms latency) — or fold beat estimation into the model's output head.

### Audio I/O

- WebAudio API in browser (works for laptop mic / line in).
- For LED output, the existing Three.js `Screen3D` already drives a per-frame brightness — same hook works.

---

## Phase 4 — Tweak & improve workflow

This is where having a learned model pays off vs. a static deterministic one.

### 1. Show review UI

- Load a song, watch the model's predicted timeline alongside the deterministic Director's.
- Flag disagreements. (We already have the Program Focus Timeline component — extend it to render two tracks side-by-side.)

### 2. Manual override capture

- Every time the user pins a sub-pill manually during playback, log
  `(song_hash, time, predicted_choice, user_choice)` as a correction example.
- Stored in a corrections table; queryable.

### 3. Periodic fine-tune

- Weekly job: replay all corrections + a sample of original training data through a small LoRA-style update on the model.
- The model gradually shifts toward the user's taste, not just the deterministic teacher's.

### 4. A/B mode

- Split-screen rendering: deterministic Director vs. learned model on the same audio.
- Tracking metric: how often the user prefers the learned version → improvement signal.

---

## Hard parts

- **Stem → stemless distillation stability** — the most important and least solved-by-default piece.
- **Live BPM at song start / on quiet sections** — beat trackers wobble. Mitigate with smoothing + uncertainty output.
- **Genre coverage** — a model trained only on EDM is terrible on jazz. Curate intentionally; diversity > volume.
- **The "average show" trap** — imitation learners trained on many sources regress to a boring mean. Counter with:
  - Train on a single curated style first
  - Add a sampling temperature / variance term
  - Layer on Phase-4 preference learning

---

## Concrete first milestone (1 focused week)

**Target:** 500 curated electronic tracks → working learned model running side-by-side with the deterministic Director in the existing webapp.

| Day | Work |
|---|---|
| 1 | Refactor `analyze_cli.py` into a batch walker. Hash inputs, skip duplicates, write hashed layout. |
| 2 | Run analysis pipeline on the 500-song corpus (overnight). |
| 2–3 | Run deterministic Director on all songs in batch, save `show.json` (precomputed `programBlocks`). |
| 4 | Build training data loader: stream `(mel_window, frame_label)` pairs. Define small transformer model. |
| 5 | Train v1 on the 500 songs. Ship checkpoint. |
| 6 | Load checkpoint in the webapp behind a `useModel: true` toggle. Render learned timeline next to deterministic. |
| 7 | Compare, iterate, document failure cases. |

This deliverable is enough to **decide whether the approach is worth scaling**.

---

## Deployment notes (from current discussion)

- The current Next.js `/api/analyze` route shells out to `analyze_cli.py` over a venv. Works locally and on **any container host** (Render, Railway, Fly.io).
- Won't work on Vercel/Netlify-style serverless — torch + demucs is ~2GB and takes 30s–2min per call.
- **Recommended deployment shape**:
  - Webapp on Vercel
  - Analysis worker on Render or Fly Machines (or Modal/Replicate for GPU on-demand)
  - Results cached in object storage by audio hash → instant on re-load
- Once the model exists, **inference** (the mic-driven path) is small enough to run client-side via ONNX Runtime Web. No backend needed for the live show.

---

## Cheat code

The single biggest reason this is feasible: **we already have a deterministic teacher that produces good output**. Most ML projects have to figure out what "good" looks like first. We don't.

Everything in this roadmap is plumbing on top of that core asset.
