# Scope brightness findings — 2026-09-17

This is progress on the active single-channel goal, not completion. The model is saved but not promoted to live output.

## The new reference retains some information beyond volume

At identical stereo RMS 0.2, the exact browser projection gives brightness 0.056 for a mono sine, 0.179 for a quadrature stereo sine, and 0.536 for a stereo complex tone. Silence is exactly zero; nonfinite input fails closed. Swapping channels changes brightness by less than 0.0001 in the checked pair. These are controlled signal properties, not musical quality evidence.

Important limits: the mono complex tone gives 0.063, barely different from the mono sine. Unique trace coverage discards traversal speed/repetition. Some ALLEYCVT clips spend 17–19% of their frames above 0.95 brightness at fixed exposure 40. GRiZ is much dimmer. Source geometry/recording conditions matter. Do not treat this candidate as a universally useful microphone target without further evidence.

The source study `../stereo_scope_analysis/REPORT.md` had already identified this mono ambiguity and warned that different sounds can share scope geometry. The current measurements confirm that limitation for the actual live raster.

## New forecast model: rejected for live use

Dataset: six 120-second training excerpts from ALLEYCVT, GRiZ and Ravenscoon; one Levity validation excerpt; two Forest transfer excerpts. Each has a 10-second prefix. Targets are exact scope coverage brightness at +40, +100 and +260 ms, computed in Chrome 256×256 canvas using the same code as the live page. No concert video labels used. Artists/shows are separated; cross-show track overlap is unknown. Forest has been studied previously and is not a fresh final test.

The causal model uses nine lag positions over two seconds, retaining amplitude, spread, texture, balance, bass, air, attack, correlation and current coverage brightness. Architecture: 81→96→48→3. Output heads forecast one scalar at different horizons. An amplitude-only model and ridge regression are independent controls. We save the checkpoint and JSON model even when rejected.

At +40 ms:

| Excerpt | Learned MSE | Direct persistence MSE | Linear history MSE | Learned temporal-change standard deviation / target |
|---|---:|---:|---:|---:|
| Levity 900 | .00337 | .00386 | .00330 | .58 |
| Forest 600 | .01643 | .01685 | .0141 | .56 |
| Forest 3000 | .01516 | .01817 | .0143 | .56 |

The model reduces error largely with flatter forecasts. It retains only 56–58% of the fast-change standard deviation at 40 ms and loses more at longer horizons. It does not consistently beat the linear control. All three predeclared forecast diagnostic gates fail. This is evidence against replacing the direct response with these forecasts, not evidence of learned musical improvement.

## Live reliability correction

The headless browser's observed output buffer was approximately 272 ms. Previously the generic 250 ms wall-clock freshness limit blacked out file frames that were correctly queued for audible playback. File freshness now allows the measured scheduled output lead in addition to the 250 ms delivery allowance, while the strict 250 ms audible-age check remains. External input retains its original freshness limit. Unit checks cover long buffers, genuinely stale frames, suspension, future queue entries and stop.

The live brightness page now skips loading the old unrelated forecast model. It shows input channels, processed frames, graph age and raster compute time. The shared raster's measured p95 compute in one Chrome run was 0.30 ms; this is **not physical input-to-photon latency**. File playback varied across sampled brightness values and stop cleared the entire field. No physical microphone or system capture was initiated automatically.

## Artifacts

- Dataset: `/Volumes/ExtremePro/Code/lightflow/research/brightness_dataset_v3/`
- Model, checkpoint, metrics and predictions: `/Volumes/ExtremePro/Code/lightflow/research/brightness_forecast_v1/`
- Live page: http://localhost:3001/scope/brightness
- Shared projection: `public/scope-brightness.mjs`
- Commands: `node research/brightness/extract.mjs <fresh-directory>`; `python research/brightness/train.py --data <dataset> --out <fresh-directory>`; `node research/brightness/browser_check.mjs <fresh-report.json>`.

The first extraction attempt found the preview server stopped; the second was interrupted by a development-page reload. Both were preserved. The third used an isolated static module document, reused only complete validated CSVs, and completed all nine excerpts. Every new SanDisk output used exclusive creation.

## Next decision

Do not iterate more MSE-only predictors of this same target. First determine whether the scope-derived scalar itself is musically useful, including a mono-input comparison. If not, revise the projection with explicit evidence about the detail it loses. A future learned temporal layer must preserve immediate detail and earn changes in holds/builds/releases through listening-backed or otherwise defensible targets; self-supervised future scope values are not such labels. Noticeable improvement and physical live timing remain unproved.
