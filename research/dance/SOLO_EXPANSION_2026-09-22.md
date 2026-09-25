# Expanded solo movement library — September 22, 2026

32 new YouTube uploads downloaded and screened. Fourteen were deferred before extraction for crowds, mirrors, cropping, low detail or editing. Eighteen uploads reached passage extraction; one failed timestamp validation. **23 completed passages from 17 new uploads: 675.56 seconds and 24,552 decoded frames.** The raw-movement player now has 38 completed solo passages including earlier runs.

All new media, pose chunks, audio, movement analyses and review sheets are on SanDisk. Every download/run uses a new directory; existing files were not deleted or overwritten. No new model was trained.

## Watch and tune

- [Poppin John — Beat Killer](http://localhost:3001/pipeline/live?run=89dab10c-317e-4ea4-aa70-beb1b86d0438): 99.6% required-joint coverage; popping/arm articulation candidate.
- [Poppin John — Top-Tier Animation](http://localhost:3001/pipeline/live?run=35ad6ce5-109d-4431-bf59-7c8936482124): 100% required-joint coverage in source20–50s; many automatically proposed holds to inspect.
- [takeSomeCrime — Radiohead / Lotus Flower](http://localhost:3001/pipeline/live?run=a9af2c35-798f-410b-91a0-858e8f828d12): 90.4% required-joint coverage; broader stances and bends.

Open the sliders icon: **Steadiness** suppresses small joint fluctuations; **Fast movement response** increases responsiveness during faster gestures. Defaults55%/35%. Switch smoothing off for raw points or enable the gray comparison trace. Settings persist in local browser storage. Smoothing changes only displayed coordinates; source data and offline movement analysis are untouched.

## What was actually reviewed

Nine source stills per upload, plus nine later-source samples for six uploads. Every completed new passage received nine uniformly spaced exact-frame skeleton samples (207 uniform samples total). Six passages also had their difficult-frame sheets inspected (52 samples, some overlapping the uniform selection). Observations are appended to each run as assistant **sampled** reviews. This is not continuous identity/anatomical review or verified source A/V alignment.

Eleven passages meet the numerical higher-coverage screen: at least85% required-joint visibility/confidence, at most1% multiple detections, and no automatic cuts or sustained-loss lockouts. This is not training admission. In particular the Boogie Frantick stage example has camera/scale changes despite good numerical coverage. No automatic cut flag is proof that a video has no edits.

## Main findings

- Arms and legs need separate validity masks. Crave You20–50s retains about99% leg visibility but only61% arm visibility. The whole-body gate keeps60% of frames. Studio Sorcery20–50s keeps virtually100% legs but72% arms.
- A front-facing source can extract cleanly while later turns in the same upload fail. Cradles drops from81.2% required-joint coverage at20–50s to56.9% at70–100s. Source-level acceptance is insufficient.
- Apparent solo footage can yield duplicate skeleton proposals. Withdrawal and Feel the Way I Feel show overlapping proposals on the single dancer in difficult samples; those frames remain unassigned.
- Camera movement, oblique views, fine hand gestures and head/hand cropping are unresolved even where the main body skeleton looks plausible. Smoothing may hide jitter but cannot recover an occluded joint or establish correctness.
- The selected volfmon passage failed because decoded timestamps repeat: 569 collisions after millisecond conversion among1,798 decoded frames, including exact duplicate PTS. The failed run and preview are retained; timing was not fabricated or silently repaired.

## Completed passages

Coverage means all12 major limb/torso joints visible, in frame and confidence≥0.5. It does not measure true identity/anatomical accuracy. Movement coverage is stricter because derivatives need neighboring valid frames.

| Passage | Original interval | Pose coverage | Movement coverage | Quantitative screen |
| --- | --- | ---: | ---: | --- |
| [City Dance : Spring Onstage / BOOGIE FRANTICK / Solo -- Official Video](http://localhost:3001/pipeline/live?run=77b9f996-1d50-453d-ba07-d4ee8b132d78) | 20–50s | 89.2% | 83.1% | higher-coverage |
| [Crave You -  Flight Facilities (daniella andrade teemid cover) {oggTSC}](http://localhost:3001/pipeline/live?run=3946f65e-3938-4d38-ae54-4854c937d099) | 20–50s | 60.3% | 53.3% | needs-inspection |
| [Crave You -  Flight Facilities (daniella andrade teemid cover) {oggTSC}](http://localhost:3001/pipeline/live?run=f7f5684d-344f-4b20-a633-d0ebabaf89aa) | 70–100s | 76.1% | 71.5% | needs-inspection |
| [Give me one reason](http://localhost:3001/pipeline/live?run=e0279535-d68a-436a-a42b-a133181d6c60) | 20–50s | 70.8% | 62.5% | needs-inspection |
| [Kormac - Studio Sorcery (TSC - Ogg)](http://localhost:3001/pipeline/live?run=a49dd8a8-5b28-4589-8ae1-38863dad04f3) | 20–50s | 72.3% | 66.5% | needs-inspection |
| [Kormac - Studio Sorcery (TSC - Ogg)](http://localhost:3001/pipeline/live?run=099ae693-359c-4df4-9947-664a57bd3bbf) | 70–100s | 88.2% | 81.3% | higher-coverage |
| [Max Frost - Withdrawal](http://localhost:3001/pipeline/live?run=7451c690-66d7-48db-96c0-085b13530d3a) | 20–50s | 76.8% | 71.4% | needs-inspection |
| [POPPIN JOHN / BEAT KILLER / TWERL](http://localhost:3001/pipeline/live?run=89dab10c-317e-4ea4-aa70-beb1b86d0438) | 20–50s | 99.6% | 98.8% | higher-coverage |
| [POPPIN JOHN / EVERYTHING I WANTED / BILLIE EILISH](http://localhost:3001/pipeline/live?run=7538b392-8a53-46db-81dd-5d06b33ec4da) | 20–50s | 55.0% | 52.2% | needs-inspection |
| [POPPIN JOHN / J**e's House Thriftworks](http://localhost:3001/pipeline/live?run=84c76181-2bcf-4729-8b1b-64bfcf737d09) | 20–50s | 88.5% | 84.3% | higher-coverage |
| [POPPIN JOHN / J**e's House Thriftworks](http://localhost:3001/pipeline/live?run=6ff3f1c3-331a-4ef8-b58a-d3341a428118) | 70–100s | 84.1% | 83.2% | needs-inspection |
| [Poppin John / Freestyle / The Tuxedo Way](http://localhost:3001/pipeline/live?run=cdcaa625-8176-4ea0-a78f-165593e75179) | 20–50s | 92.5% | 89.9% | higher-coverage |
| [Poppin John / Freestyle / The Tuxedo Way](http://localhost:3001/pipeline/live?run=daa4342c-5a00-4ba7-b500-1de031ef83fa) | 70–100s | 86.4% | 84.8% | higher-coverage |
| [Poppin John / Lauterbrunnen Switzerland / Cradles / 2025](http://localhost:3001/pipeline/live?run=29d00a80-c65e-4536-83b8-6c328bbf51d3) | 20–50s | 81.2% | 76.2% | needs-inspection |
| [Poppin John / Lauterbrunnen Switzerland / Cradles / 2025](http://localhost:3001/pipeline/live?run=53f84bc6-7b73-49fd-aa9c-f2ba7462f58b) | 70–100s | 56.9% | 51.0% | needs-inspection |
| [Radiohead - Lotus Flower](http://localhost:3001/pipeline/live?run=a9af2c35-798f-410b-91a0-858e8f828d12) | 20–50s | 90.4% | 88.7% | higher-coverage |
| [SG Lewis - Chemicals](http://localhost:3001/pipeline/live?run=9ff85da3-4e31-40ae-b139-62005d4c20b3) | 20–50s | 85.7% | 83.4% | higher-coverage |
| [SOME COLD ANIMATION! / POPPIN JOHN / 2 Souls - Dawn](http://localhost:3001/pipeline/live?run=8e704036-1d15-4047-a81e-0f6c07ca607c) | 20–50s | 81.5% | 77.1% | needs-inspection |
| [Sylvan Esso - Ferris Wheel](http://localhost:3001/pipeline/live?run=fee3937d-526f-4286-a19f-5876512868b3) | 20–35s | 51.2% | 42.1% | needs-inspection |
| [TOP-TIER ANIMATION / DANCE / POPPIN JOHN 2021](http://localhost:3001/pipeline/live?run=35ad6ce5-109d-4431-bf59-7c8936482124) | 20–50s | 100.0% | 99.7% | higher-coverage |
| [TOP-TIER ANIMATION / DANCE / POPPIN JOHN 2021](http://localhost:3001/pipeline/live?run=36fe8631-6258-497f-aaef-4070507681d2) | 70–100s | 99.9% | 99.3% | higher-coverage |
| [The Jungle Giants - Feel the way I feel](http://localhost:3001/pipeline/live?run=32e7239a-1f50-486a-82ee-afd3ac8875ed) | 20–50s | 87.8% | 80.8% | higher-coverage |
| [aKu - Final Blow](http://localhost:3001/pipeline/live?run=8418d7bd-9d88-48a4-ba45-ad67ccf059a6) | 20–50s | 63.6% | 57.5% | needs-inspection |

## Brightness direction

Start with movement intensity as the continuous carrier, then let reliable starts, stops and holds shape attack/sustain/release. Keep arms and legs separate until that projection. Do not immediately blend every metric into brightness. The first controlled comparison should change only the presence of phrase-event shaping, alongside the unchanged stereoscope reference.

See [the metric definitions, failures and proposed comparison](BRIGHTNESS_FROM_MOVEMENT_2026-09-22.md). These are hypotheses to audition, not learned lighting judgment.

## Storage and reproducibility

New source batches:

- `/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/candidates-20260922T041116-q1bc1s8o`
- `/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/candidates-20260922T041820-3qjy2yvs`
- New UUID runs under `/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance/runs/`.

- `solo-expansion-screening-2026-09-22.json`: all32 source decisions and later passage selection.
- `batch-solo-expansion-{a,b,c,d}-2026-09-22.json`: passage specs.
- `solo-expansion-results-2026-09-22.json`: coverage, group visibility, arm/leg correlations, automatic event counts and playable URLs.
- `solo-expansion-visual-observations-2026-09-22.json`: exact sampled frame indices and observations.
- Failed timestamp run: `2ff0c16d-84e6-4935-8767-a476076f961c`.

Validation: TypeScript and whitespace checks; smoothing tests for raw-data immutability, confidence gaps, cuts/track/time resets, causal prefix behavior, jitter reduction and fast-step response; headless desktop/mobile player checks; playback of two newly processed passages; catalog confirmed38 completed solo runs. Browser checks use a hidden browser and temporary screenshots. Catalog/status now counts pose chunk filenames instead of loading every joint of every passage.

The synthetic smoothing test at75% steadiness reduced a15Hz stationary test oscillation by90%; raising response shortened a synthetic step lag. This characterizes the implemented filter on constructed inputs, not measured real-video tracking accuracy or a guarantee of music/light latency. The repository has no ESLint configuration, so a lint pass is not claimed.
