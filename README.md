# LightFlow

Audio-reactive LED lighting system for live DJ sets. Analyzes songs via stem separation (Demucs) + feature extraction (librosa), then an attention-based Director picks focus stems and pulse rates per frame. An optional Claude AI layer reviews the Director's draft and adds macro arc, hit cues, intensity scaling, and composed bar-level patterns.

## Architecture

```
[audio file]
     │
     ├─► Python analyzer (Demucs + librosa)     ~60s per song
     │     └─► *_analysis.json (stems, sections, BPM, onsets, chroma)
     │
     ├─► Next.js webapp
     │     ├─ Attention layer (src/lib/attention.ts)
     │     │    └─ Picks ONE dominant stem per frame, shapes envelope
     │     ├─ Director (src/lib/modulators.ts, v1.2)
     │     │    └─ Chooses pulse rate per frame: raw / pulse:1–16
     │     │    └─ Step-down ladder: max 2 bars of any fast rate
     │     ├─ Claude Director (src/lib/director/)
     │     │    └─ Reviews draft → PlanPatch (intensity, focus, hit cues, bar patterns)
     │     └─ Render loop (src/app/page.tsx)
     │          └─ signal = stem_energy × modulator × intensityScale + hitCueBoost
     │
     └─► Browser playback (Web Audio API)
```

## Quick start

### Prerequisites

- Node.js 20+
- pnpm
- Python 3.10+ with conda (for analysis server)
- Anthropic API key (for Claude Director — optional, works without it)

### 1. Install and run the webapp

```bash
cd lightflow
pnpm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env.local   # optional
pnpm dev
```

App runs at http://localhost:3000.

### 2. Start the analysis server (for custom song drops)

Preset songs load from pre-analyzed JSON files in `public/songs/`. To analyze **new** songs dropped into the browser, the Python analysis server must be running:

```bash
cd archive/v3-python
KMP_DUPLICATE_LIB_OK=TRUE PYTHONUNBUFFERED=1 python server.py
```

Runs at http://localhost:8000. The webapp's `src/lib/api.ts` points there automatically.

**Python env setup** (one-time, via conda):

```bash
conda create -n lightflow python=3.10
conda activate lightflow
pip install demucs librosa soundfile fastapi uvicorn pydantic
conda install -c conda-forge 'ffmpeg>=6,<7'
```

**Known issues:**
- torchaudio 2.9+ wants ffmpeg 4-7 but Homebrew has ffmpeg 8. Install ffmpeg 6 via conda (above).
- The server monkey-patches `demucs.audio.save_audio` to use soundfile instead of torchaudio.save.
- `KMP_DUPLICATE_LIB_OK=TRUE` is required for OpenMP duplicate lib warning on macOS.
- `num_workers=0` is required on macOS (fork issues with librosa).

### 3. Transfer songs to another machine

Copy `public/songs/` to the new machine. This contains:
- `*.mp3` — audio files for preset songs
- `*_analysis.json` — pre-computed analysis (stems, sections, BPM, etc.)

AirDrop is fastest for a batch. For ongoing syncs:
```bash
rsync -avz --progress public/songs/ other-host:~/code/lightflow/public/songs/
```

Pre-analyzed songs work without the Python server — it's only needed for analyzing *new* drops.

## How it works

### Signal pipeline (per frame, ~30fps)

1. **Attention layer** (`attention.ts`) reads the current analysis frame, picks the loudest/most-interesting stem, shapes its envelope with stem-specific attack/release profiles (kick = exp decay, hat = square, bass = plateau, vocals = sigmoid).

2. **Director** (`modulators.ts`) takes the attention signal and picks a pulse rate on a continuum: raw (passthrough), pulse:1 (one per beat), pulse:2 (8ths), pulse:4/5 (16ths), pulse:8/16 (strobe). Decisions are held for bars, not frames. Hard rules: strobes only start on downbeats, max 2 bars of any fast rate before mandatory step-down, hat-dominant sections always run raw.

3. **Claude Director** (optional, `src/lib/director/`) runs once per song load:
   - `buildDraft.ts` walks the analysis offline, producing a section-by-section DraftPlan that mirrors the live Director's priority list
   - Sends the DraftPlan + a compressed StemSummary to Claude via the Anthropic API
   - Claude returns a PlanPatch: per-section edits (intensity scale, palette hints, bar patterns) + timestamped hit cues + arc narrative + warnings
   - `applyPatch.ts` merges draft + patch into a ShowPlan
   - `engineAdapter.ts` converts the ShowPlan into programBlocks the render loop consumes, with per-bar pattern synthesis for composed gridded timelines

4. **Render loop** (`page.tsx`) resolves the signal:
   - Without Claude: `signal = attention.signal → modulator(signal, rate) → brightness`
   - With Claude (toggle on): `signal = stems[claude.focusStem] → modulator(signal, claude.rate) × claude.intensityScale → max(signal, hitCueBoost) → brightness`

### Claude Director detail

Claude is an **editor**, not an author. It receives the engine's draft and returns a small patch. Key design decisions:

- **PlanPatch, not ShowPlan.** Claude can't rewrite the whole plan. It can scale intensity, shift palette, assign bar patterns, place hit cues, and write warnings. Empty patch is a valid answer.
- **Bar patterns** (v1.2). Claude assigns one of 5 archetypes per section: `solid`, `solid-blackout-last`, `every-4-bars`, `every-2-bars`, `alternating`. The engine synthesizes per-bar fx blocks from the archetype. This prevents the "#1 complaint": flat 16-bar strobes.
- **Hit cues.** Claude's unique contribution — timestamped one-shots (drops, lifts, stabs, breakdowns) the engine can't infer from frame-level analysis. Labels map to effects: drop→impact, stab→flux_burst, breakdown→scan, lift→buildup_rise, blackout→blackout.
- **Disk cache.** SHA-256 of (analysis + director version + prompt version) → `.director-cache/<hash>.json`. First run ~30s, subsequent loads instant. Cache invalidates on version bumps.
- **Streaming.** `/api/director/stream` returns NDJSON partials so the HUD populates progressively during the ~30s Claude call.
- **Graceful fallback.** No API key = draft-only plan. Claude error = draft-only plan. The engine's taste is always the baseline.

### Key files

| File | What it does |
|---|---|
| `src/lib/attention.ts` | Per-frame stem focus + envelope shaping |
| `src/lib/modulators.ts` | Pulse rate selection, step-down ladder, Director state |
| `src/lib/director/schema.ts` | Zod schemas: StemSummary, DraftPlan, PlanPatch, ShowPlan, BarPattern |
| `src/lib/director/prompt.ts` | Claude system prompt with engine invariants + bar pattern rules |
| `src/lib/director/buildDraft.ts` | Analysis → StemSummary + DraftPlan |
| `src/lib/director/applyPatch.ts` | DraftPlan + PlanPatch → ShowPlan; hit-cue label→effect routing |
| `src/lib/director/engineAdapter.ts` | ShowPlan → programBlocks with bar-pattern synthesis; hit-cue boost |
| `src/lib/director/cache.ts` | Disk cache for Claude responses |
| `src/app/api/director/route.ts` | JSON API endpoint |
| `src/app/api/director/stream/route.ts` | NDJSON streaming endpoint |
| `src/components/DirectorHud.tsx` | HUD panel + DirectorBadge compound pill |
| `src/app/page.tsx` | Main render loop, Claude signal integration, UI |
| `archive/v3-python/server.py` | FastAPI analysis server (Demucs + librosa) |
| `archive/v3-python/analyze.py` | Full analysis pipeline |

### Director version history

- **v1.0** — Clean baseline: unified pulse rate continuum (1/2/4/5/8/16 per beat), smooth decay envelope, beatless→raw, hat→raw, transient detector, beat-offset grid fitting, 2-bar min commit.
- **v1.1** — Claude-as-editor layer: DraftPlan + PlanPatch architecture, streaming HUD, disk cache.
- **v1.2** — Composed bar patterns (`every-4-bars`, `every-2-bars`, `alternating`, `solid-blackout-last`). Fast-pulse cap tightened to 2 bars (8 beats). New sustained-peak strobe branch. UI shows actual rate (STROBE ·16, PULSE ·4).

## Development notes

- `.env.local` — add `ANTHROPIC_API_KEY=sk-ant-...` for Claude Director
- `.director-cache/` — gitignored, auto-created, auto-invalidated on version bumps
- Song menu render loop pauses while menu is open (hover responsiveness fix)
- Tube test mode has been removed (v1.2) — spatial render not currently wired to Claude's effect vocabulary
- The `v3/.env` file from the old Python era contains a working Anthropic key — copy to `.env.local` if needed
