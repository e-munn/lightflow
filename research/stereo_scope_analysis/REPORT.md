# What the stereo scope reveals about song components

2026-09-16. Exploratory measurements of user-selected Of The Trees recordings.
Read `docs/TRAINING_GOAL.md` before turning any of these observations into a
training objective.

## Main finding

The useful decomposition is **energy / stereo breadth / texture / time**.
Instrument identity helps explain those quantities, but is not uniquely encoded
in the drawing. A snare can produce a bright, broad burst; a centered snare can
also make the mix narrower. Bass can increase the size of the trace while
reducing its relative width. A visually quiet component can contribute much of
the mix's stereo breadth.

Do not turn “snare → wider/brighter” into a universal label. The sampled passages
support “many broadband transients increase trace coverage; widening depends on
their stereo structure and the other sounds already playing.”

## Evidence and scope

Three 60-second passages were analyzed:

| Recording | Source interval |
|---|---|
| Of The Trees, Ultra Miami 2026 | 10:00–11:00 |
| Of The Trees, Ultra Miami 2026 | 30:00–31:00 |
| Of The Trees, Electric Forest | 20:00–21:00 |

HTDemucs produced **estimated** drums, bass, vocals, and other stems. It does
not isolate individual snares, kicks, or synths. Those finer labels below are
acoustic candidates, not verified instrument annotations. The “other” stem may
contain synths, pads, effects, instruments, and separation leakage. A vocals
estimate is not proof of singing throughout its contents.

Analysis used 20 ms windows at 50 updates/second. Source-stem reconstruction SNR
was 31.0–34.7 dB. This checks reconstruction agreement; it does **not** certify
stem purity or phase accuracy. The study covers three minutes, not both entire
shows, and adjacent windows/events are correlated. Statistics are descriptive,
not independent-sample significance tests or generalization evidence.

Raw stems, per-frame CSV measurements, event candidates, intervention results,
and manifests are on ExtremePro at:
`/Volumes/ExtremePro/Code/lightflow/research/stereo_scope_analysis/9-16-26/`.

## What was measured

| Quantity | Definition | What it distinguishes |
|---|---|---|
| Energy | Stereo RMS | Overall signal level |
| Trace thickness | RMS along the covariance ellipse's minor axis | Absolute spread perpendicular to the main direction |
| Roundness | Minor-axis RMS / major-axis RMS, 0–1 | Breadth independent of overall gain |
| Side-energy fraction | Energy of (L−R)/2 divided by total mid+side energy | Difference between the channels; phase-sensitive |
| Channel correlation | Centered L/R correlation | Similarity or opposition between channels |
| Balance | Normalized L/R variance difference | Channel asymmetry |
| Roughness | Mean consecutive XY step length divided by RMS | Rapid, jagged movement independent of overall gain |
| Lit area | Fraction of pixels touched by a fixed trace | A specific renderer's average core brightness |

The numerical rendering test uses a 128×128 canvas, a one-pixel line, fixed
1.5× gain, and no glow or persistence. Thus “brighter” below means **more area
lit at the same per-pixel intensity**, not an increase in individual pixel
brightness or a perceptual brightness judgment. Video examples have a larger
canvas and are illustrative, not a pixel-identical rendering of that metric.

A second rendering test matches each window to RMS 0.15, solely to compare
shape. This diagnostic normalization is not a proposed live renderer behavior:
it can amplify weak leakage and removes dynamics we otherwise want to retain.

## 1. Snare-like and other drum transients

We detected peaks in the estimated drum envelope, separated them by at least
180 ms, and used coarse low/body/high energy ratios to categorize candidates.
For each event, the attack neighborhood was compared with a baseline roughly
80–180 ms earlier in the same mix. This is an event association: other sources
can change during that interval.

| Candidate category | Count | More lit area | Greater absolute thickness | Greater roundness |
|---|---:|---:|---:|---:|
| Snare-like | 79 | 85% | 72% | 61% |
| Kick-like | 120 | 56% | 30% | 11% |
| Hat-like | 249 | 89% | 75% | 69% |

For the snare-like group, the median increase in lit area was **2.45 percentage
points** of the canvas, and the median increase in roundness was **0.11**.
Roughness increased in 89% of cases. However, hats showed a similarly strong
or stronger pattern. Bright, scratchy bursts are therefore not a unique snare
signature.

The strongest warning comes from splitting the snare-like results by passage:

| Passage | Candidates | Increased thickness | Increased lit area |
|---|---:|---:|---:|
| Ultra 10:00–11:00 | 17 | 100% | 94% |
| Ultra 30:00–31:00 | 29 | 24% | 62% |
| Forest 20:00–21:00 | 33 | 100% | 100% |

Possible explanations include different stereo processing, different drum
sounds, simultaneous centered low-frequency energy, and misclassification by
the coarse drum heuristic. The present analysis cannot separate those causes.
Human listening review of these candidates is the next necessary label check.

**Interpretation:** transients often draw more or longer new line segments,
illuminating more pixels. If the transient differs across L and R, it also
widens the figure. If it is strongly centered, it may extend the diagonal and
make the mix relatively narrower instead.

## 2. Bass: powerful but visually narrow

Estimated bass accounted for **52–66% of summed stem energy** across the three
passages. That denominator is the sum of the separate stem energies; it is not
an exact partition of mixture energy because cross-terms exist.

Its active-window median roundness was only **0.001–0.016**, with nearly zero
side-energy fraction. It therefore appeared predominantly as a narrow line in
L/R coordinates. In mid/side coordinates, that same behavior becomes a narrow
vertical trace; rotating the display changes its appearance, not its stereo
information.

In upper-quintile bass-activity windows, adding estimated bass back to the
other stems increased RMS while reducing median roundness by **0.31–0.40**.
At equal RMS, it reduced lit area by **8.0–9.4 percentage points**. These are
paired, same-time leave-one-stem-out comparisons, not before/after song changes.

**Interpretation:** bass supplies a strong coherent backbone. Its presence can
make a trace taller/larger while suppressing its *relative* spread. It is a
strong candidate for driving the base intensity or scale of a visual, but not
for automatically driving “more stereo width.” These particular bass estimates
are dominated by sub-bass; harmonically rich or stereo synth bass may behave
very differently.

## 3. Synths, pads, and the “other” estimate

We have an “other” estimate, not a clean synth stem. Its active median roundness
was **0.43–0.66**, versus **0.001–0.016** for bass. In Ultra's 10-minute passage it
represented only about **1.5% of summed stem energy**, yet it was geometrically
broad. Removing it reduced breadth in the paired tests.

At matched RMS, adding “other” increased median lit area by approximately
**0.4–3.5 percentage points** across passages. Its effect varied with the
arrangement; it was not uniformly the largest contribution.

**Interpretation:** low-energy stereo effects or sustained instruments can be
responsible for much of the interesting shape. A brightness-only representation
can lose that information. We should explicitly test dry versus chorus/reverb
versions of the same synth and distinguish sub-bass from upper synth harmonics
before making an instrument-level rule.

## 4. Vocals

Estimated vocals had active median roundness **0.17–0.24**, between bass and the
broader “other” estimate. They occupied more lit area than bass after matching
RMS: approximately **6.1–7.7%** versus **0.32–0.53%** of the test canvas.

Their stereo effect was not consistent in sign. Adding estimated vocals slightly
increased roundness in two passages and slightly decreased it in Ultra's
30-minute passage. Forest's vocals estimate contributed only **0.3% of summed
stem energy**; its geometry should not be treated as strong vocal evidence.

**Interpretation:** the scope can respond to vocal texture and stereo processing,
but does not tell us that a voice is present. Vowels, consonants, sibilants, vocal
effects, and separator bleed need listening-backed annotations before attributing
specific shapes to those components. No such fine vocal annotation was performed.

## 5. Why brightness and spread must be separate

At identical RMS 0.15, controlled synthetic examples produced:

| Signal | Roundness | Lit area |
|---|---:|---:|
| Same tone in both channels | 0.00 | 0.23% |
| Same noise in both channels | 0.00 | 0.51% |
| Tone with 90° L/R phase offset | 1.00 | 0.79% |
| Independent noise in L and R | 0.94 | 18.17% |

These are diagnostic signals, not training examples of human choreography.
They demonstrate two non-identifiabilities:

- Mono noise and a mono tone both form a line. Vastly different timbres can
  share the same basic scope shape.
- A phase-shifted tone and stereo noise can both be nearly round. One draws a
  ring; the other fills an area. Roundness alone cannot capture texture.

The two synthetic mono examples have different crest factors, so their line
lengths and lit areas need not match even though RMS does. A scope image loses
information about sample traversal speed and can map different sounds to
similar geometry.

For zero-mean audio, mean squared distance from the origin is exactly
`E[L² + R²] = 2 × stereo_RMS²`. Basic radial extent therefore partly repeats
energy information. For equal-power channels, L/R correlation also determines
the covariance ellipse's axis ratio. We should avoid treating several
mathematically related measurements as independent discovered musical factors.

Persistence introduces another confound: a long trail can keep the display
bright after the causal sound has ended. Scope window, sample density, gain,
line width, clipping, decay, and glow must accompany any rendered training label.

## Proposed next steps

1. **Audit source identities first.** Listen to the provided review reel and
   isolated stems. Hand-confirm a small set of snare, kick, hat, dry synth,
   stereo synth, sub-bass, and vocal events. Keep ambiguous cases unlabelled.
2. **Record a small interpretable descriptor set:** amplitude, attack/novelty,
   stereo breadth, texture/roughness, and channel balance, plus confidence and
   explicit timing. Keep phase/correlation as diagnostics. Do not lock the final
   model output schema solely from these three passages.
3. **Try direct mappings as baselines:** amplitude to light intensity; novelty
   to short accents; breadth to spatial spread; texture to fine modulation;
   balance to left/right emphasis. For browser fill, amplitude alone remains
   valid. Color requires a separate mapping or visual supervision—XY geometry
   supplies no inherent hue.
4. **Separate measurement from artistic policy.** These descriptors can be
   calculated directly from audio; a model is not needed merely to reproduce
   them. The learned part should earn its place by choosing useful cue timing,
   holds, combinations, and medium-independent behavior from curated examples.
5. **Test invariance and failures:** overall gain changes, mono downmix, L/R swap,
   stereo widening, clipping, compression, different trail lengths, and the same
   instrument with different effects. Evaluate new tracks/shows held out.
6. **For generated data:** retain numeric audio measurements separately from
   rendered targets and store the exact mapping/version. Do not confuse
   procedural examples with human-authored lighting decisions. RPMC-L2 remains
   excluded. No training has run in this study.

## Review artifacts

The 32-second `component_scope_review.mp4` shows four 4-second passages, each
replayed twice: original audio, then estimated isolated source audio. Each view
shows reconstructed mix / source alone / reconstruction minus source, at native
levels and at equal RMS for shape comparison. The selected “snare-like” chapter
is the counterexample passage, not a cherry-picked broad flare.

`controlled_counterexamples.png` and its JSON file document the equal-RMS tests.
`analysis.json` contains all event summaries and per-clip paired interventions;
each passage has a `features.csv` with source timestamps. The review manifest
records exact excerpts. All heavy artifacts remain on ExtremePro, with no
existing drive files deleted or overwritten.

## External references

- [Official Demucs repository](https://github.com/facebookresearch/demucs): model
  capabilities and the four estimated source categories.
- [iZotope Ozone Imager documentation](https://downloads.izotope.com/docs/ozone8/imager/index.html):
  stereo visualization and correlation context. Our plots use raw L/R XY or
  explicitly labelled mid/side coordinates, not an assumed identical orientation
  to every commercial vectorscope.
