# LightFlow

Audio-reactive lighting. Two surfaces in one Next.js app:

- **`/player`**: the automated show. Songs are analyzed offline (Demucs stem separation + librosa), then an attention layer picks the dominant stem per frame and a deterministic Director chooses a pulse rate per bar. An optional Claude **Scout** pass reads the analysis once and returns song-level moments (drops, lifts, breakdowns) and per-section hints. The screen previews the result as a flat full-screen light or a 3D rig; with the DMX bridge running, the same signal goes to real fixtures.
- **`/live`**: the live console for events. Mic or tap-tempo input drives a scene engine (keyboard-triggered scenes and colours, strobe/pulse/blackout, AutoPilot) rendered on an on-screen 3D rig and, when output is switched to **live**, out over DMX via an Enttec USB Pro.

Hosted demo: https://lightflow-emunns-projects.vercel.app (three pre-analyzed songs; the full library stays local).

## Current research handoff

The `codex/dance-choreography` branch adds local dance extraction, synchronized
music/skeleton playback, brightness studies, and a Full/Heavy/RTMW pose comparison.
Read [the current handoff](docs/HANDOFF.md) for startup, SanDisk dependencies,
verification, known failures and next steps. These are research tools; an
expressive audio-to-light model has not been validated. The realistic 3D lighting
scene is saved as a specification and is not yet wired into the renderer.

## Stereoscope research

The `codex/new-research` branch adds an experimental one-channel brightness
pipeline. The current goal is detailed live response plus musical phrasing;
there is not yet a validated expressive model. Read
[the training goal](docs/TRAINING_GOAL.md) and
[the focused comparison protocol](research/brightness/PHRASE_TARGET_EXPERIMENT.md)
before training or interpreting results.

Run `npm run dev`, then visit:

- `http://localhost:3001/scope/phrase`: preferred scope versus a marked Grain-to-Snap phrase.
- `http://localhost:3001/scope/threshold`: radial threshold and compression/expansion controls.
- `http://localhost:3001/scope/styles`: ten signal-shaping alternatives.
- `http://localhost:3001/scope/interplay`: experimental dynamic transitions between styles.

Research media, model checkpoints, prepared comparison frames and submitted
feedback live under `/Volumes/ExtremePro`, outside Git. Hosted previews do not
have those files: built-in excerpts and saved research comparisons require the
local server with SanDisk connected. Live/file-input tools can run without the
bundled excerpts. Never delete or overwrite existing SanDisk artifacts.

## Architecture

```
[audio file]
     │
     ├─► Python analyzer (Demucs + librosa)  ~60s/song, local only
     │     └─► public/songs/<slug>_analysis.json  (stems, sections, BPM, onsets)
     │
     ├─► Scout (src/lib/scout/, /api/scout)  optional, Claude, once per song
     │     └─► public/songs/<slug>_scout.json  (moments, section annotations, primary stem)
     │
     ├─► /player  (src/app/player/page.tsx)
     │     ├─ Attention layer (src/lib/attention.ts): one dominant stem per frame, shaped envelope
     │     ├─ Director (src/lib/modulators.ts): pulse rate per bar — raw / pulse:1–16, step-down ladder
     │     ├─ Scout apply (src/lib/scout/apply.ts): moment cues + stem weights + section hints
     │     └─ Render: flat screen | Screen3D | sendDMX()
     │
     └─► /live  (src/app/live/page.tsx)
           ├─ liveAudio.ts: mic energy / bands / onsets / auto-BPM
           ├─ tapTempo.ts: phase-continuous tempo clock (tap or typed BPM)
           ├─ scenes.ts: living scenes + beat-synced motion layer
           ├─ autopilot.ts: hysteresis state machine → scene/colour selection
           └─ stageRender.ts + fixtures.ts → universe → Rig3D preview | sendDMX()

dmxClient.ts ──ws://localhost:7777──► scripts/dmx-bridge.mjs ──serial──► Enttec USB Pro
```

## Quick start

```bash
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env   # optional, only for Scout generation
npm run dev                                   # http://localhost:3001
```

`/player` with no local song library shows the three demo songs tracked in git. To use your own library, drop `<slug>.mp3` + `<slug>_analysis.json` (+ optional `<slug>_scout.json`) into `public/songs/` and regenerate `public/songs/manifest.json` with `scripts/ingest_audio_dir.py`. Everything in `public/songs/` except the three demo songs is gitignored and excluded from Vercel uploads (`.vercelignore`).

### DMX output (events)

```bash
node scripts/dmx-bridge.mjs      # auto-detects the Enttec; DMX_PORT=/dev/tty.usbserial-XXXX to force
```

Open `/live` on the same laptop, press **L** (or the preview/live button) to send the universe to the bridge. On localhost the page connects to the bridge automatically; on the hosted URL it only dials the bridge after that user gesture, which is what triggers Chrome's local-network permission prompt.

### Analyzing new songs (local only)

Dropping an audio file onto `/player` posts it to the Python analyzer at `http://localhost:8000` (`NEXT_PUBLIC_API_URL` to override). Without it, the file plays in raw mode (audio only, no Director).

```bash
conda create -n lightflow python=3.10 && conda activate lightflow
pip install demucs librosa soundfile fastapi uvicorn pydantic
conda install -c conda-forge 'ffmpeg>=6,<7'
cd archive/v3-python && KMP_DUPLICATE_LIB_OK=TRUE PYTHONUNBUFFERED=1 python server.py
```

Known quirks: torchaudio wants ffmpeg 4–7 (Homebrew ships 8, use conda's); `KMP_DUPLICATE_LIB_OK=TRUE` silences the OpenMP duplicate-lib abort on macOS; `num_workers=0` is required on macOS.

## How the player decides

1. **Attention** (`attention.ts`): per frame, reads stem energies, picks the loudest/most-interesting stem, shapes its envelope with stem-specific attack/release (kick = exp decay, hat = square, bass = plateau, vocals = sigmoid). v1.5 is bass-first by default; Scout can flip that per song.
2. **Director** (`modulators.ts`): maps the attention signal to a pulse rate on a continuum (raw, pulse:1 per beat, :2, :4/:5, :8/:16 strobe). Decisions are held for bars, not frames. Strobes start only on downbeats, any fast rate is capped at 2 bars before a mandatory step-down, hat-dominant sections run raw. `DIRECTOR_VERSION` tags the algorithm.
3. **Scout** (`scout/`): one Claude call per song turns the analysis into a small JSON file: an arc sentence, `primaryStem`, `modulatorBias`, timestamped **moments** with anticipation/duration, and per-section annotations (semantic label, stem focus, intensity scale). `apply.ts` turns those into attention weights and cue boosts at render time. No key or no file = Director-only baseline; the engine's taste is always the floor.
4. **Render**: `signal = attention × modulator × intensity (+ moment boost)` → screen brightness / 3D rig / DMX channels.

## Key files

| File | What it does |
|---|---|
| `src/app/page.tsx` | Homepage |
| `src/app/player/page.tsx` | Automated show: render loop, song menu, Flat/3D screen, Scout UI |
| `src/app/live/page.tsx` | Live console: keyboard surface, scenes, AutoPilot, tap tempo, DMX toggle |
| `src/app/docs/page.tsx` | Renders this README + `docs/ML_ROADMAP.md` |
| `src/app/api/scout/route.ts` | Generates a Scout file from an analysis URL (needs `ANTHROPIC_API_KEY`) |
| `src/app/api/shows/route.ts` | Lists / writes `<slug>_show.json` (local disk; read-only on Vercel) |
| `src/lib/attention.ts` · `modulators.ts` · `beatAlign.ts` | Player signal pipeline |
| `src/lib/scout/{schema,prompt,buildSummary,apply}.ts` | Scout schema, prompt, summary builder, runtime application |
| `src/lib/liveAudio.ts` · `tapTempo.ts` · `scenes.ts` · `autopilot.ts` | Live console engine |
| `src/lib/fixtures.ts` · `stageRender.ts` · `dmxClient.ts` | Fixture profiles, universe rendering, bridge client |
| `src/components/Screen3D.tsx` · `Rig3D.tsx` | Three.js previews (player / live) |
| `scripts/dmx-bridge.mjs` | WebSocket → Enttec USB Pro sidecar |
| `archive/v3-python/` | Analyzer (FastAPI + Demucs + librosa) |

## Deploying

`npm run build` writes to `.next-production`; `vercel.json` explicitly selects
that output directory so Vercel can locate the Next.js route manifest.

The Vercel project deploys from GitHub. Pushes to `live` build a Preview; promote it (`vercel promote <url>`) or set the project's production branch to `live` so pushes go straight to production. Set `ANTHROPIC_API_KEY` in the Vercel environment for Scout. Do not deploy with `vercel --prod` from a working tree that has the full song library unless `.vercelignore` is present: the CLI uploads `public/` wholesale.

## Director version history

- **v1.0** — unified pulse-rate continuum, smooth decay envelope, beatless→raw, hat→raw, transient detector, beat-offset grid fitting, 2-bar min commit.
- **v1.1 / v1.2** — Claude-as-editor layer (DraftPlan + PlanPatch) and composed bar patterns; later replaced by the simpler single-shot Scout.
- **v1.5** — bass-first attention + perceptual decay + simplified UI.
