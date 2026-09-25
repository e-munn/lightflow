**Current implementation: [Jev live control v2](LIVE_V2.md).** It addresses the user’s lag and repetitive-choice feedback. The page and API now use v2. The following records the historical v1 design and evidence; its timings are not full response latency.

**Jev context experiment — September 21, 2026**

Branch: `codex/jev-experiment`. Local page: http://localhost:3001/scope/jev

The TypeSafe skill was installed for Codex using one installation method:

```sh
npx --yes skills add typesafe-ai/skills --skill typesafe-ai --agent codex --yes
```

The installed instructions are in [SKILL.md](../../.agents/skills/typesafe-ai/SKILL.md). `skills-lock.json` records their source and hash. The project instructions in `AGENTS.md` retain the user's request to apply this skill to TypeSafe work. No Claude plugin installation was used.

**Purpose**

Test whether Jev can make useful decisions about the character of one brightness signal while a local audio loop preserves detailed, immediate reactivity. This is an experiment with an existing hosted model, not a trained Lightflow model or a validated improvement in musical judgment.

The connection to game-playing is a bounded action loop: observe the situation, select an available behavior, apply it in code, and evaluate the next situation. Here, the current prototype observes audio measurements. It does not yet observe human preference, reward its own output, or learn online.

**What runs**

- Existing local audio capture and scope projection process trailing 20 ms windows. The preferred circle remains radius 0.33, soft inside, expansion outside, strength 3.3, adaptation off.
- The existing AttitudeBank calculates Circle, Grain, Snap, and Sustain from the same audio. Frequency measures are not isolated instrument stems.
- A bounded rolling history summarizes the trailing two seconds and compares them with up to eight preceding seconds. Deterministic code calculates numeric comparisons and converts them into descriptions of level, attacks, continuity, texture, spectrum, and recent rise.
- The server sends those observations to `https://api.typesafe.ai/v1/systemone`, pinned to `jev-1.13.0`, with one Choice question. Available answers are Circle, Grain, Snap, Sustain, and Uncertain. No raw audio, filename, song identity, secret, or recording is included in model state.
- Requests are serialized and spaced at least two seconds after completion. A session ends after ten minutes. Selecting Circle for the display still runs Jev so A/B switching compares concurrently computed responses; Stop ends both.
- Jev selects one mapping. Local code crossfades for 600 ms, retains a selection for at least two seconds, and rejects answers older than 1.5 audio seconds. A provisional confidence floor of 0.55 filters ambiguous answers. After six seconds without a usable decision, the output returns to Circle.
- Digital silence, stale input, Stop, or blackout cannot retain illuminated output. Each render still comes from current local audio; an API reply does not fire a delayed flash.

The skill's official documentation establishes that Jev accepts text/structured state, not raw audio, images, or video. Its guidance also recommends keeping arithmetic in code. Accordingly, the quality of our observation descriptions is a central unknown. They can discard musical information that a listener hears. Sources: [model capabilities](https://docs.typesafe.ai/models), [state](https://docs.typesafe.ai/concepts/state), [known numerical limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13), [Choice](https://docs.typesafe.ai/primitives/choice), [function-calling pattern](https://docs.typesafe.ai/cookbooks/function_calling), [HTTP contract](https://docs.typesafe.ai/api).

**Use**

Keep `TYPESAFE_API_KEY` in `.env.local`, then run `npm run dev`. Open the local URL yourself. Choose Demo, a local music file, Mic, or System. Switch A/Circle and B/Jev while listening. Fullscreen fills the viewport. A/B keys switch the displayed response; Space blacks out; Esc exits fullscreen.

“What Jev sees” exposes the observations and model confidence. Export decisions downloads the observations, numeric summaries, response distributions, request timing, and whether each answer was applied. It contains no raw audio. Exports currently do not include the full per-frame brightness trace or a human preference label, so they are not sufficient training/evaluation records by themselves.

The API key is used only server-side. `/api/jev` rejects production mode, non-loopback hosts, cross-origin browser requests, oversized inputs, and arbitrary prompts. It accepts only a numeric signal-summary schema. The local rate limiter permits one in-flight call and limits request starts. Errors never return upstream bodies or credentials. This is deliberately a local experiment; the paid endpoint is not enabled on the public deployment.

**Initial evidence**

One preliminary hand-described state returned Grain in 271 ms. Five subsequent synthetic audio probes passed through the real local feature extractor and the actual TypeSafe API:

| Synthetic signal | Jev choice | Confidence | API round trip |
| --- | --- | --- | --- |
| Smooth steady tone | Sustain | 1.00 | 730 ms |
| Continuous noise texture | Grain | 0.99 | 203 ms |
| Repeated transient attacks | Snap | 0.74 | 197 ms |
| Louder attacks after a quiet passage | Snap | 0.88 | 212 ms |
| Gradually rising mixed signal | Sustain | 0.52 | 122 ms |

The five-call median was 203 ms; range 122–730 ms. The rising probe's response would not pass the provisional application threshold. These are integration examples, not human-labeled accuracy results. Confidence is the model's distribution concentration, not proof of correctness. See [audit-1790036789785.json](audit-1790036789785.json).

The first real-music headless check used the existing Calabria demo, made real model calls, and selected Snap throughout the tested passage (with one answer below the application confidence threshold). Both outputs varied; their maximum displayed difference in the sampled interval was 0.601 on a 0–1 scale. That demonstrates a functional difference, not artistic improvement or matched average brightness. The check found a startup pacing issue: development compilation compressed the first two server calls. Request scheduling was changed to count from completion and the browser test now rejects any normal-playback 429. The initial report is retained in `browser-1790036918766.json`; subsequent reports document the fix.

The [repeat browser check](browser-1790037032906.json) completed 13 successful decisions with no rate-limit errors or browser exceptions. Browser-to-server-to-model round trips had a 155 ms median and a 111–561 ms range; the corresponding server-measured API median was 142 ms. Snap remained the returned choice throughout this percussive excerpt, including two uncertain answers which were not applied. Mode changes were not forced merely for variety. Fullscreen, A/B switching, blackout, decision export, mobile layout, and stopping API activity passed. These times do not include microphone acquisition or physical display/light latency.

Physical microphone-to-light latency, real Hue/DMX delivery, blind listening preference, and success across genres remain unmeasured. The demo is familiar development material. Neither the tests nor model confidence establish prediction of future drops. The browser display is the current output device.

**Verification commands**

```sh
node research/jev/test.mjs
npx tsc --noEmit
npm run build
node research/jev/api-test.mjs
node research/jev/browser-test.mjs
node --env-file=.env.local research/jev/audit.mjs
```

The audit and browser test make a small number of real paid API calls; the unit and API-boundary tests do not. Audit/report files use exclusive writes and unique filenames. The browser test runs headlessly and opens no visible preview window. Desktop/mobile screenshots are temporary small files under `/tmp`.

Repository-wide ESLint could not run because this checkout has no flat ESLint configuration. This experiment does not add one or claim a lint pass.

Final checks passed: unit scenarios, TypeScript, production build, API boundaries, and headless real-music playback. The actual configured API key was also checked against generated browser JavaScript and was absent. `.env.local` remains ignored by Git. The build-generated change to the unrelated director service-worker cache ID was restored after verification.

**Next meaningful decision**

Listen to unfamiliar passages and mark exactly where a Jev choice improves or harms expression. Compare against Circle and a simple deterministic selector using the same measurements. If Jev merely reproduces a band/onset rule, it has not justified the network step. If it makes useful contextual choices, expand the action vocabulary carefully—for example, whether to leave space or hold through a sustained sound—while retaining a single brightness output and local timing.
