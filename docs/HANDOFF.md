# Machine handoff — state as of 2026-08-25

Branch: `live` (this is the deployed branch; `main` is 20+ commits behind and stale).

## What's live

- **Production**: https://lightflow-emunns-projects.vercel.app — homepage, `/player`, `/live`, `/docs`.
- **GitHub**: https://github.com/e-munn/lightflow — **public** since 2026-08-22. Default branch is still `main` (stale); consider `gh repo edit e-munn/lightflow --default-branch live`.
- Player ships 3 demo songs tracked in git (`calabria_-_austin_marc`, `damn_right_-_audrey_nuna`, `mcdonalds` — mp3 + `_analysis.json` + `_scout.json`). Everything else in `public/songs/` is gitignored AND excluded from CLI deploys via `.vercelignore`.
- First visit to `/player` auto-loads Damn Right at 0:00, flat screen mode (not persisted; Z or the Flat/3D pill toggles). Record button removed. Phone remote, `/test` harness, and ratings were culled (recoverable at tag `live-pre-cull`).

## Deploy flow (important)

Vercel project `lightflow` (team emunns-projects) is GitHub-connected with **production branch = `main`**, so:

1. `git push origin live` → builds a **Preview** deployment.
2. `vercel promote <preview-url> --yes` → rebuilds it as Production.

Fix permanently in dashboard: Settings → Git → Production Branch → `live` (not settable via API). Then pushes deploy production directly.

**Never** run bare `vercel --prod` from a working tree without `.vercelignore`: the CLI uploads `public/` wholesale (it once shipped the whole 2.8G song library; fixed by `.vercelignore`).

`ANTHROPIC_API_KEY` is set in Vercel env (Production + Preview). Deployment protection (SSO) was disabled 2026-08-22 so vercel.app URLs are public.

## New machine setup

```bash
git clone https://github.com/e-munn/lightflow && cd lightflow && git checkout live
npm install && npm run dev          # port 3000; use --port 3001 if 3000 is taken
vercel link   # team emunns-projects, project lightflow
vercel env pull .env                # brings ANTHROPIC_API_KEY for /api/scout
```

- **Song library** (not in git): rsync/AirDrop `public/songs/` from the old machine, then regenerate `public/songs/manifest.json` (`scripts/ingest_audio_dir.py`). Without it the player falls back to the 3 demo songs.
- **DMX**: `node scripts/dmx-bridge.mjs` (auto-detects Enttec USB Pro; `DMX_PORT=` to force). `/live` connects automatically on localhost; on the hosted URL only after pressing live (Chrome will show a local-network permission prompt — expected).
- **Python analyzer** (only for analyzing new drops): see README "Analyzing new songs".

## In flight (picked up mid-task)

Deep research on ML training-data sources (for docs/ML_ROADMAP.md Phase 1/2) was running as background agents on the old machine; the machine's sleep cycles killed 4 of 5 streams. **Completed findings + remaining research plan are in `docs/TRAINING_DATA.md`** — continue from its "Open research streams" section.
