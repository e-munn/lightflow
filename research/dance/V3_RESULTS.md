# V3 — audio-timed Open, ready for listening

**Decision: offer as a comparison, not an approved training target.** Functional
checks passed on ten 30-second passages, including four sources reserved until
code was frozen. These checks do not establish that dance improves the light.

Review: http://localhost:3001/pipeline/study
Direct: http://localhost:3001/pipeline/live?study=v3

## One question

Does body expansion give musically useful variation to a reliable shared accent
clock? Switch **Open expression** / **Constant accents**, keeping **Match average
brightness** enabled. Hide the skeleton to judge the light itself. Both versions
use the same events, validity mask and release envelope; only amplitude changes.
Then compare with V0 Snap/Open on the same passage using the version selector.
A changed value is not automatically an improvement. Reject V3 if the modulation
feels arbitrary or the audio accent clock loses what made original Snap useful.

## Fixed method

The policy is preregistered in `V3_PROTOCOL.md`; code hashes were saved in
`phrase-v3-lock.json` before opening reserved sources. No parameters were changed
from the reserved results. V0 and the rejected V2 remain unchanged and playable.

- Select strong spectral accents (normalized strength >= 0.9); use a refractory
  interval of half an estimated beat, bounded to 180–300 ms, or 250 ms when
  tempo is unknown. No generated beat grid or assumption that every accent is a beat.
- Smooth normalized Open with a causal 200 ms time constant. At an audio event,
  brightness amplitude is `0.25 + 0.75 * Open`. Wide posture alone creates no light.
- The constant control has amplitude 0.625. Matching adjusts its gain so displayed,
  clamped time-average brightness matches the candidate on common valid samples.
- Gain targets 90% brightness at the 90th percentile of event amplitudes. Fade
  follows the existing estimated-BPM/audio-texture policy, with audio-event-spacing
  fallback. Settings stay fixed within an excerpt, and manual controls remain.
- Missing joints clear the signal. The constant control uses the same mask to
  isolate amplitude; it is an experimental control, not an independent audio-only
  deployment implementation.

## Measurements

All passages are 30 seconds. Selected accents precede visibility masking; rendered
events require reliable Open. Saturation is valid time at displayed brightness
>= 0.98. The one-frame check requires a value > 0.2 surrounded by valid values
< 0.05; it does not rule out every possible visual artifact.

| Passage | Split | Broad accents | Strong selected | Rendered events | Saturated time |
| --- | --- | ---: | ---: | ---: | ---: |
| AI Naafyish | Development | 218 | 55 | 55 | 0% |
| Beat Killer | Development | 161 | 50 | 50 | 0.28% |
| Top-Tier Animation | Development | 162 | 50 | 50 | 0% |
| Lotus Flower | Development | 136 | 52 | 50 | 0.12% |
| Feel the Way I Feel | Development | 142 | 46 | 40 | 0% |
| Crave You | Tracking stress | 114 | 44 | 28 | 1.21% |
| The Tuxedo Way | Reserved | 120 | 53 | 52 | 0.58% |
| Thriftworks | Reserved | 136 | 56 | 48 | 0% |
| Chemicals | Reserved | 125 | 45 | 41 | 0% |
| Studio Sorcery | Reserved | 129 | 50 | 45 | 0.25% |

No isolated one-frame pulses were detected. All ten constant controls achieved
mean matching within 0.001 on the matching integration mask. The summary statistics
omit the final frame, so rounded summary means can differ slightly from matching
means. Native V3 mean brightness ranged from 0.1624 to 0.2867. Sparser events and
low saturation describe behavior; neither is a musical quality score.

The 60%-coverage Crave You stress source loses 16 of 44 selected events to tracking.
It is useful for failure handling but poor supervision for training. Reserved
sources have 85–93% whole-pose coverage; Open has its own joint-validity mask.
All sources were previously screened for pose quality. The split is by upload
source, not a claim of independent performers, songs, or never-seen footage.

## What wrong-movement controls tell us

Pairing another passage's Open with the same target audio retained common evidence
for 84–100% of visible events in development and 85–96% in reserve. The single
stress source had no within-split partner and is explicitly unavailable for this
control. Both actual and mismatched Open have generally weak relationships with
instantaneous audio RMS. No consistent numerical advantage establishes actual
movement as the better expression signal. RMS correlation is not an aesthetic
objective anyway. The report includes the comparisons so they cannot be hidden
behind an attractive beat-proximity number. Wrong movement is an offline diagnostic;
the playable ablation isolates constant versus real Open.

## Timing and limits

Accent confirmation requires one 20 ms analysis hop. Emission then waits for the
next valid source-pose frame: measured additional median quantization was 5.6–21.7 ms
across passages, with maxima up to 40.7 ms. Relative to the detector timestamp this
is about 25.6–41.7 ms median added delay, not a measured end-to-end microphone or
physical-light latency. The spectral feature itself uses a trailing 32 ms window.
No video/audio retiming was applied. Original recording A/V offsets and perceptual
beat times have not been independently annotated.

Full-excerpt percentiles, BPM and movement normalization use future data. This
is still an offline teacher study, not a causal live audio controller. Selected
events have 75–98% proximity to separate RMS anchors within 120 ms on reserve,
but those anchors are dense and not annotated beats. Candidate and constant
control share timing by construction; proximity cannot validate Open.

## Verification and preserved evidence

- Pure checks: brightness, smoothing, music defaults, V2 timing, V3 phrase logic.
- V3 headless browser: distinct amplitudes on the same timestamps, matching on/off,
  shared manual settings and Auto restoration, independent skeleton smoothing,
  V0–V3 switching, blackout, full viewport/mobile/landscape, all ten indexed passages,
  reserved-source loading and explicit audio-failure darkness. No visible browser
  was opened or reloaded.
- Existing V0/V1/V2 browser regressions and TypeScript are checked separately.
- Reports: `phrase-evaluation-development-2026-09-22T06-41-20-091Z.json` and
  `phrase-evaluation-reserved-2026-09-22T06-44-32-685Z.json`.
- Raw media and existing SanDisk files were read only. No new model was trained.

Do not rerun the reserved evaluation for tuning. If listening identifies a useful
next hypothesis, record it as a new version and obtain new independent validation
sources. First collect preference on V3 versus constant and V0 on several passages;
only then consider a brightness target worth predicting from audio.
