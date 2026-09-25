# LightFlow handoff — September 10, 2026

**Read this first on the other machine.** This is unfinished experimental work,
not the production deployment or an achieved AI-director goal.

## Start the current app

Branch: **`codex/production`**. It began at the verified production commit
`f1fc943` and now contains the experimental director work.

```sh
git fetch origin
git switch codex/production
git pull --ff-only
npm ci
npm run build
npm run start -- --port 3001
```

If the local branch doesn't exist, `git switch --track origin/codex/production`.
Use Node 20.9+ as required by Next 16 (tested with Node 25.9). Open
**http://localhost:3001/director** yourself; do not automatically open/reload the
user's browser. Development: `npm run dev` (port 3001). Stop the production
server before starting dev on that port.

The build needs internet for the existing Google font dependency. It writes
`.next-production`, copies ONNX Runtime browser assets from the locked npm
package into `public/ort`, and creates the offline cache manifest. Models in
`public/models` are committed, so Python and training data are **not required**
to run the app. No API key is required for `/director`. The older optional
Scout route has separate environment requirements; do not copy secret files.

## Latest requested behavior

The user asked to test raw lighting on a full white/black screen, without the
animations. **Raw white light is now the default.**

- Start microphone or open a music file.
- Fullscreen expands only the output surface; no labels or other UI.
- Space toggles blackout in fullscreen; Esc exits.
- Output is uniform grayscale from the director signal, not a spatial shader.
- Stop/no source, zero intensity and blackout produce black.
- The Animations toggle restores the ten experimental visual families.

## The actual goal and user feedback

Unfamiliar music through a microphone → natural, engaging lighting direction,
live and offline, eventually controlling ten React Bits-style visual families.
The user explicitly rejected the current learned output as **“still feels like
an energy meter.”** Treat that as a failed quality evaluation. Browser tests,
more variation and better prediction metrics did not satisfy the goal.

The user then requested **three varied approaches**, persistent overnight work,
and agent testing. The accepted work plan is in `DIRECTOR_ATTEMPTS.md`:

1. Composed musical direction with intentional gestures/holds/transitions.
2. Human-show imitation from actual authored cue sequences.
3. Motif retrieval and short-horizon planning.

**These three attempts are NOT implemented.** The shared gesture contract and
renderer support were started. Do not describe the old histogram models as
three completed solutions. Next work should pursue the three approaches and
compare rendered performances on the same music.

## What is implemented

- `/director`: local file + AudioWorklet microphone capture; ONNX WASM worker.
- Small concert descriptor model and learned 24-way two-second phrase model.
- Phrase scheduling with continuity/repetition penalties; procedural scene map.
- Ten original GLSL visual sketches (not actual licensed React Bits components).
- Raw grayscale output, output-only fullscreen, blackout and intensity.
- Service worker for offline reload, local playback, model/runtime assets.
- Gesture API: holds, drift, bloom, sweep, orbit, fracture, weave, dissolve.
  Optional renderer support exists, but the live director does not yet use it.
- Existing `/live` and `/player` retained.

Key files: `src/app/director/page.tsx`, `src/components/director/Visual.tsx`,
`src/lib/director/{audio,inference.worker,score,phrases,gestures}.ts`,
`public/director-{capture,dsp,sw}.js`.

## Evidence and limits

Concise machine-readable results are in `scripts/director/artifacts/*.json`.
See `DIRECTOR_PROGRESS.md` for research details; this handoff supersedes stale
process IDs and older mode descriptions there.

- Browser frontend vs Python mel max error: 2.86e-6.
- Descriptor PyTorch/ONNX max error: 5.96e-8.
- Phrase validation CE: correct audio 3.033; shuffled audio 3.325;
  loudness-only 3.210; prior-only 3.161. Limited clip split, not show-disjoint.
- Descriptor brightness underperformed a constant test baseline. Phrase output
  varies more but the user's audition still rejected its musical quality.
- Inference timings are **not** microphone-to-photon latency.
- Build passed. Headless online/offline playback, simulated microphone, ten
  distinct nonblank scenes, black blackout, and mobile width passed.
- Latest raw-output check passed: equal RGB channels, 1280×800 fullscreen output
  at origin, Space blackout, animations toggle, no page errors.
- No physical room microphone/DMX validation. No completed three-way comparison.

## Tests on another machine

```sh
node scripts/director/test_gestures.mjs
node scripts/director/test_phrases.mjs
# With production server running on 3001:
node scripts/director/browser-smoke.mjs
python3 scripts/director/check_visuals.py
```

The smoke test generates its own synthetic microphone WAV and uses tracked demo
songs. macOS defaults to installed Google Chrome. Override with `CHROME_PATH`,
or on other platforms install Playwright Chromium (`npx playwright install
chromium`). The pixel check requires Python Pillow and NumPy. Tests are headless
and use a fake microphone, not the real device.

For musical evaluation, the scripts can produce local-track traces and compare
phrase output, but those require Python torch, numpy, librosa, onnxruntime,
scikit-learn/h5py as applicable and the local training artifacts. Dependency
versions for Python are not pinned; do not mistake that for a reproducible
training environment yet.

## What does not travel in Git

- Large datasets/caches, `.pt` training checkpoints, raw local audio library.
- Symlinks into the original machine's ExtremePro drive.
- Generated screenshots/traces, build output, node_modules, runtime copies.
- `.env.local` or any credentials.

The three pre-existing demo songs are already tracked. Browser ONNX models,
mel filterbank and phrase vocabulary travel with this branch.

Original data: `/Volumes/ExtremePro/Code/lightflow/data/rpmc-l2/RPMC_L2.hdf5`,
accessed via the original machine's `data/rpmc-l2` symlink. 699 concert clips,
RPMC-L2, CC-BY-4.0. The dataset is video histogram labels, not explicit human
cue actions. See https://huggingface.co/datasets/RS2002/RPMC-L2.

Training cache/checkpoints remain on the original machine under
`scripts/director/artifacts/` (concert.npz, concert.pt, phrases.npz, phrase.pt).
Transfer separately only if needed, or recreate from the source dataset.
Do not train the old quarantined `archive/v3-python/songs` cache: audio/label
pairs are mismatched. Keep source/rights provenance for any new cue corpus.

## Working preferences

- Port **3001**.
- Share preview URL; don't open/reload the user's browser automatically.
- User authorizes sustained iteration and testing, but no pretending incomplete
  experiments achieved the goal.
- Prefer action; no repeated permission questions for already authorized work.
- Push is a Git handoff only. No production deployment/promote is requested.
