# Handoff: Lightflow, research branch `codex/dance-choreography`

Lightflow is an audio-reactive lighting app (Next.js) plus a pile of research toward a
musically intelligent lighting model. Read `README.md` for the app itself and
`docs/TRAINING_GOAL.md` before any training. This file covers what is OPEN as of
2026-10-14. The latest session started a new thread: recovering per-fixture show data
(an equivalent of the DMX) from a concert recording, and playing it back as a 3D scene.
Earlier research handoffs are kept in `docs/HANDOFF_2026-09-25.md` (dance pipeline,
brightness studies) and `docs/HANDOFF_2026-09-10.md` (director).

## Run it

```sh
git switch codex/dance-choreography && git pull --ff-only
npm ci
npm run dev            # next dev --webpack --port 3001
```

- Node 20.9+ (Next 16); tested with Node 25.9.0.
- Port **3001**. Give Elijah the URL and let him open it in Dia; never open or reload a
  visible browser yourself. Headless checks use installed Chrome through Playwright
  (`chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })`).
- **SanDisk ExtremePro must be mounted at `/Volumes/ExtremePro`.** Research media, run
  artifacts and the data behind `/recovery` live only there. Without it those routes return
  503 ("Connect ExtremePro").
- No env vars for `/recovery` or the fixture-recovery scripts. `.env.local` (ignored) only
  matters for the Jev/TypeSafe experiment; keep `TYPESAFE_API_KEY` server-side.
- Fixture-recovery Python: `/Users/elijah/miniconda3/bin/python3` (3.12) with numpy, scipy,
  opencv (`cv2`), librosa, matplotlib; ffmpeg from the same miniconda. `acquire.py` also needs
  a yt-dlp binary and node; the one used lived in a throwaway venv
  (`python3 -m venv <dir> && <dir>/bin/pip install 'yt-dlp[default]'`).
- Regenerating the fixture-recovery run: the exact command sequence is in
  `research/fixture_recovery/EXPERIMENT.md` under "Reproduce". About 20 to 25 minutes for the
  100 s window on the M2 Pro; every step refuses to overwrite its output.

## Recent work in this session

### Source acquisition (`research/fixture_recovery/acquire.py`)

Of The Trees at Wakaan 2026 (YouTube `Hg---nS9Xo8`, uploader TheFestivalExperience, 60:43,
VP9 2160p60 + Opus) downloaded into a new batch:
`/Volumes/ExtremePro/Movies/Assets/lightflow_research/reference/10-13-26-125918/concerts/of_the_trees_wakaan_2026_Hg---nS9Xo8.mkv`,
SHA-256 `0e40bc31666c7ec4f9144d164cbbdf2872b936411c125e721b7e7803a8e8dff3`, with
`manifest.json`, `SHA256SUMS.txt`, `SOURCES.md` in the batch and a line appended to
`lightflow_research/SOURCES.md` (rights UNKNOWN). Downloader intermediates go to a local temp
dir (`--temp`) so nothing is ever deleted on the drive. The uploader notes rain and the camera
mic; the camera is on a support but reframes during the set.

### Fixture recovery pipeline (`research/fixture_recovery/*.py`, `EXPERIMENT.md`, `RESULTS.md`)

Elijah asked how to reverse-engineer "the exact DMX" from the video, then said to try it.
The literal DMX stream is not recoverable (unknown patch, fixture modes; many DMX states give
the same picture), so the target is an equivalent show: level, color and beam direction per
fixture. Pilot window **59:00 to 60:40** (start 3540 s, 100 s, 5,994 frames), analysed at
1920x1080 area-downscaled from the 4K decode (software decode runs ~170 fps; faster than
VideoToolbox here).

Steps and the constants a future session would otherwise rediscover:

1. `register.py`: compact sources = connected components of `GaussianBlur(σ1.5) − box41 > 30`
   on the max-channel image, area 6 to 3000 px. Camera drift = per-frame median offset to
   anchors seen in ≥25% of frames (8 px match radius, ≥6 matches; translation only). Result:
   91 anchors, 96.5% of frames solved, drift std 1.4/2.7 px, peak 8 px.
2. `stacks.py`: mean, max, motion energy, and `thin_clutter` = median top-hat (25 px ellipse)
   image over the 25% of frames with the fewest lit lenses.
3. `census.py` + `review_wakaan_3540.json`: panels = `blur(motion, σ2) > 9` then a 27 px
   ellipse opening (wide opening keeps fixture rows on panel edges out of the panel). Wash =
   saturated core area ≥200 px, saturated in ≥25% of frames, off-panel. Point = saturated in
   ≥2% of frames; inside a panel only if ≤12 px from its edge and ≥5%. Duplicates within 11 px
   merged. Structure mask = `thin_clutter > 6`. The review JSON holds 10 exclusion boxes and 6
   group boxes drawn by eye for this camera position (no rig plot). Final rig: 28 washes
   (4 per wing, 6 per centre side, 8 deck), 112 points, 9 panels.
4. `tracks.py`: wash core r≤6, glare ring 22 to 30 px minus 35 to 40 px (25th percentiles);
   point core r≤3.5, ring 8 to 11; `LIT = 200`. Beams: 480 angles, rays 12 to 416 px step 4,
   weight `exp(-r/180)`, top-hat capped at 0.08 linear, profile minus its ±6° median, averaged
   over 5 beam-frames (`BEAM_STEP = 2`), minus a per-lens clutter profile (90th percentile while
   that lens is dark, sampled every 6th frame), then greedy one-beam-per-lit-lens assignment
   where each accepted beam claims its pixels (`BEAM_CANDIDATES = 4`, `BEAM_FLOOR = 0.005`).
   Thumbnails 32x16 per panel.
5. `show.py`: `CLIP = 0.95`; wash level above clip from glare via a per-fixture gain fit
   (glare value that best separates clipped frames); level relative to a 16 s running 95th
   percentile because haze also scales glare. Beam kept if level >
   `0.008 + 0.02 × mean panel luminance` and within 6° of a 31-detection running median.
6. `render.py`, `describe.py` (tempo refined by onset autocorrelation at 16 beats: 116.01 BPM),
   `dmx.py` (40 Hz, 3 universes, virtual patch: wash dimmer+RGB, point 16-bit pan/tilt+dimmer+RGB,
   pan centred, tilt = image-plane angle over 270°).

Results (details in `RESULTS.md`): lens on/off, wash color/level changes and panels are good;
light repeats land on beat multiples (1, 2, 4, 8 beats; panel strobe every 0.26 beat). Beam
direction is the weak part: 27% of lit lens-frames get a kept direction; spot checks show
kept ones mostly right, many visible beams missed, a few false. No ground truth exists.

Dead ends, do not retry as-is: (a) requiring a beam on every quarter of a short ray: haze makes
many beams visible only far from the lens; (b) a usable-fraction rule on rays: dropped beams
that leave the frame; (c) structure mask from the all-frame median or a 90th percentile over
quiet frames: still contained beams (44% of the stage masked); (d) suppressing beams whenever
panels are bright: also kills the best real-beam passage (60:18). The earlier four-region
approach (`research/wide_lights`) is the baseline this replaced.

Artifacts on the drive (checksums inside):
`/Volumes/ExtremePro/Code/lightflow/research/fixture_recovery/wakaan_3540_v1/` (rig, tracks,
show values, timeline, DMX, comparison video, review stills, `web_v1/`). The comparison video
is also exported as
`/Volumes/ExtremePro/Movies/Exports/lightflow_fixture_recovery_wakaan_59m00_10-13-26.mp4`
(ledger row added).

### 3D playback at `/recovery` (`src/app/recovery/page.tsx`, `recovery.module.css`, `src/components/Recovered3D.tsx`, `src/app/api/fixture-recovery/[asset]/route.ts`, `research/fixture_recovery/web_export.py`)

Plays the recovered show as a three.js scene in Rig3D's visual language, beside the source clip.

- **Clock:** the source `<video>` (`source.mp4`, 960x540 with audio) is the only time source;
  frame = `floor(currentTime × fps)`. Nothing else keeps time, so scene, inset and audio cannot drift.
- **Data:** `web_export.py` writes `web_v1/` (scene.json, frames.bin 896 B/frame, panels.bin
  32x16x9 RGB per frame = 83 MB, masks.png 3x3 atlas of 256x128, source.mp4). The route
  whitelists those five names, is localhost-only and supports Range requests (needed for video seeking).
- **3D placement is assumed, not measured:** camera 60° horizontal FOV, 38 m from the stage
  front, 2.7 m high, pitched up 12.6°; depth by group (wings/roof 0, deck +1, centre recedes
  from −1 at the outer ends to −7 m at `CENTRE_X = 913` px). Each fixture sits on the ray
  through its pixel, so the default camera reproduces the recording (the export asserts a
  round-trip error under 0.2 px; measured 0.02 px) and any other angle shows guessed depth.
- **Beams:** image angle converted to 3D per fixture with a precomputed inverse image Jacobian
  and an assumed lean toward the audience `BEAM_LEAN = 0.36`; `BEAM_LENGTH = 15` m. Modes: off,
  seen (default; direction recovered within `SEEN_FRAMES = 6`), held (last direction kept
  `HELD_FRAMES = 90`, 1.5 s, while the lens is lit).
- **Rendering:** instanced billboards (washes and lenses) and instanced soft-edged cylinders
  (beams) with additive custom shaders; panels are one mesh using a 96x48 DataTexture atlas
  (SRGB) with masks.png as alphaMap; a faint haze billboard and structure lines take the
  washes' average color.
- **Why a CSS module:** new Tailwind classes (`h-dvh`, `w-[22rem]`, `bottom-16`) did not appear
  in the long-running dev server's compiled CSS, so the page collapsed to zero height. The
  module keeps the page independent of that.
- Verified only headless: no console errors, 60 fps, playback advances in step. No feedback
  from Elijah on the scene yet.

Open ideas, not implemented: (1) bloom post-processing; (2) fit one shared beam fan per
fixture row instead of a direction per lens, which should fix both recall and the stray
beams; (3) higher-resolution panel content from rectified source crops; (4) real stage
geometry if a rig plot or a second camera angle is found; (5) play `dmx.npz` through the DMX
bridge to Elijah's own rig. Most promising combo: (2) plus a known-DMX ground-truth recording.

## Things to fix / look at next

- **Fixture recovery has no ground truth.** Film Elijah's own rig (Halo, Intimidator Spots,
  Shocker panels) running a known DMX sequence and score the recovered values.
- **Beam direction recall is about a third** and some directions are wrong; see open idea (2).
- **Wash level under haze:** glare rises as smoke builds after 65 s; the 16 s relative level
  hides slow fades along with it.
- **Generality untested:** every threshold and the review boxes were set on one 100 s window;
  the camera reframes elsewhere in the set and registration is translation only.
- **Stray folder on the drive:** `wakaan_3540_v1/web/` holds one `masks.png` from a failed
  first export. Unused; left because nothing on ExtremePro gets deleted without Elijah's say.
- **Session code is uncommitted** (see below). Commit it when Elijah asks.
- **Dance pose extraction** (from 2026-09-25, still open): separate the dancer from false
  RTMW detections, validate on multi-person cases, check joint placement, measure jitter.
- **Brightness mapping** (still open): diagnose concrete good and bad moments in the original
  Snap/Open before another mapping or training run. No validated expressive model exists.
- **Overnight heartbeat** `lightflow-overnight-brightness-study` stays paused unless asked.
- **Realistic 3D scene spec** `research/dance/realistic-light-scene.ts` is still design only.

## What's where

| Path | Purpose |
| --- | --- |
| `src/app/live`, `src/app/player` | The two product surfaces (live console, automated show) |
| `src/app/recovery` | 3D playback of the recovered show (this session) |
| `src/app/pipeline`, `src/app/scope` | Dance pipeline and stereoscope research pages |
| `src/app/api/fixture-recovery/[asset]` | Streams `web_v1/` from ExtremePro for `/recovery` |
| `src/app/api/scope-research/[asset]` | Same pattern for older research media |
| `src/components/Rig3D.tsx` | Live console's 3D rig (abstract/literal) |
| `src/components/Recovered3D.tsx` | Recovered-show scene |
| `research/fixture_recovery/` | Recovery scripts, review JSON, EXPERIMENT.md, RESULTS.md |
| `research/dance/`, `research/brightness/`, `research/wide_lights/`, ... | Earlier research threads, each with its own write-ups |
| `docs/` | Training goal, visual-signal research notes, dated handoffs |
| `scripts/` | DMX bridge and tests, show builder, director scripts |
| `archive/`, `v1` to `v4`, `ml/`, `data/` | Older versions and model work, historical |

## Conventions baked into the code

- **ExtremePro is additive only.** Never delete or overwrite an existing file there. Scripts
  write to new directories and refuse existing outputs; heavy media, datasets and model
  artifacts live on the drive, not in Git or `public/`.
- **Every acquired asset gets a ledger line** in `lightflow_research/SOURCES.md` with rights
  status (see `VIDEO-PROJECTS.md` at the drive root).
- **Drive-backed routes are localhost-only** and return 503 with "Connect ExtremePro" when the
  drive is missing.
- **Recovered values are observations, not calibrated fixture output.** Keep confidence and
  assumptions stated next to any number (see `RESULTS.md`).
- **Research write-ups state limits before results** and never present cleaner-looking
  signals as model quality.
- **No em-dashes** in prose for Elijah's projects.

## What's *not* in this commit

- This handoff commit contains only `HANDOFF.md` and the pointer lines in `AGENTS.md` and
  `docs/HANDOFF.md`. The session's code is **untracked on Elijah's Mac**:
  `research/fixture_recovery/`, `src/app/recovery/`, `src/app/api/fixture-recovery/`,
  `src/components/Recovered3D.tsx`. A clone elsewhere will not have it until it is committed.
- All recovery data, the source video, run artifacts and exports are on ExtremePro only.
- `.env.local`, local runtime pointers under `research/dance/*.local.json`, the song library
  in `public/songs/` (except the hosted demo songs), and `*.wav`/`*.npy` are ignored on purpose.
