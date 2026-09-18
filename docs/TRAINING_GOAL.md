# Training goal — read before any training run

Updated 2026-09-17 from the user's clarified output contract.

## Current output contract — takes precedence over earlier multi-output proposals

The immediate model output is exactly one continuous scalar: `brightness` in [0, 1], where 0 is dark and 1 is maximum requested brightness. It is independent of fixture count and medium. Optional color, motion, texture or other descriptive channels are deferred. Do not make multichannel lighting arrangements the training target.

Evaluate this signal as one uniform brightness field with a synchronized trace. D / movement was the preferred responsiveness reference, not a request for fixture positions as model outputs. Preserve detailed musical response while working toward intentional timing, accents, holds, builds and releases. A simple amplitude envelope is only a baseline; it does not fulfill the predictive human-level goal.


## Goal

Build a model that takes live microphone or system audio and outputs one continuous brightness signal (0–1) that follows music with the fine sensitivity of the stereo scope, while learning when to accent, sustain, build, release and leave darkness.

Use the stereo scope as the foundation and comparison standard. Preserve its rich audio information internally; simplify only the output. First establish a useful scope-derived brightness baseline, then train a temporal model to improve its musical timing and expression. Add anticipation only where it demonstrably helps.

Success requires clearly useful musical response on unfamiliar electronic music beyond volume, noticeable improvement over the direct baseline on the same display, reliable live operation with measured latency and darkness on stop, and a saved model with reproducible evaluation and a working live demo.

Color, spatial lighting and additional output channels are deferred. Concert footage is optional supporting evidence, not reliable ground truth. The immediate target is a demonstrably musical single-channel model; human-level direction remains the longer-term ambition. A saved checkpoint or forecast error improvement does not establish musical usefulness. Personalization remains out of scope.

Current corpus is **electronic-first**. Evaluate unfamiliar electronic tracks,
artists and shows as the immediate research domain. Do not infer broad musical
competence from that corpus. Other genres remain an explicit generalization gap;
the user's observation about the corpus is not evidence that all music is covered.
The user subsequently supplied Jack White at Pine Knob (filename attribution),
our first rock reference. Reserve it as a separate exploratory genre holdout;
do not change the already specified electronic pilot splits. One rock show is
not broad genre validation. Its sampled frames are monochrome: color targets
are unavailable in those samples, rather than evidence for white-only lighting.

## Redirection after rejected brightness baseline (2026-09-17)

The user rejected the smoothed amplitude-only scalar. Do not treat that simplification as progress toward the goal. Restore the actual stereo waveform as the visible reference alongside every candidate brightness signal. The live `/scope/brightness` experiment measures illuminated trace coverage at fixed 256×256 resolution and converts it to one scalar. This is a hypothesis, not an approved target or a completed model. It loses geometric information and may remain musically inadequate.

Before another training run: establish that a scalar projection retains useful scope response on multiple passages; freeze its definition and evaluation criteria; then test causal learned anticipation against that same unmodified reference, including wrong-history and held-out-show controls. Do not train on arbitrary hand-mixed lighting sequences and call that human lighting judgment. Completion still requires demonstrated musical usefulness and measured live timing, not just a saved checkpoint.

## Guiding foundation: stereo scope

The next user-proposed experiment is a circular scope threshold: reduce or cut contributions inside it, compress or emphasize contributions outside it, and test slow adaptation. The working comparison is `/scope/threshold`; details and limitations are in [CIRCLE_THRESHOLD.md](../research/brightness/CIRCLE_THRESHOLD.md). Establish a perceptual benefit at fixed settings before training an adaptive controller. A change in average brightness alone is not success; meaningful quiet scope detail must survive.

The user identifies the stereo scope as the **most successful and reliable
program tried so far**. Its immediate, sensitive response to small musical
details is the foundation and quality baseline for this research. This is the
desired behavior to preserve and build on, not merely another reference effect.

The model should extend that responsiveness with more controlled expression:
intentional temporal expression in a single brightness signal. Other output
dimensions are deferred. It should not collapse rich musical detail into a coarse energy
meter. Instrument recognition is useful only insofar as it improves this goal;
classifying a snare or vocal is not a prerequisite for responding expressively.

A promising architecture to investigate is a fast deterministic signal path
inspired by the stereo scope, with learned modulation and expressive controls
on top. This is a proposal, not a settled architecture. Preserve a direct scope
baseline so every learned addition can demonstrate what it improves.

Evaluate extensions on the same audio and, where applicable, the same renderer:
do subtle changes remain visible, do transients retain their timing, and does
musical direction improve expression without losing sensitivity? Include quiet detail,
dense passages, and unfamiliar music. Added control must earn its place without
regressing the responsiveness that makes the scope successful.

## Medium-independent output

The model should output a **medium-independent light-behavior signal**:
primarily an amplitude/intensity signal, accompanied by additional dimensions.
A renderer or fixture adapter maps those dimensions to the available medium.
The model should not be tied to a particular browser effect or DMX fixture.

## Working output contract

The user proposes amplitude as the central output. The remaining dimensions
must be honed before training; the list below is a candidate vocabulary, not a
settled label schema or a claim that these labels have already been extracted.

| Candidate output | Meaning | Possible use |
|---|---|---|
| Amplitude / intensity | Desired light intensity over time, provisionally 0–1 | Full-screen brightness; fixture dimmer |
| Color | Desired hue or palette state; decide encoding before training | Browser fill; RGB/RGBW color or fixture color wheel |
| Spatial behavior | Position, spread, direction, or distribution across regions | Canvas geometry; fixture groups; calibrated pan/tilt mappings |
| Motion / modulation | Speed, pulse shape, repetition rate, or movement character | Animation controls; supported fixture effects |
| Timing / state | Holds, rests, transitions, accents, and their durations | Coherent sequences rather than independent per-frame reactions |

Amplitude is **desired visual intensity**, not automatically the audio's
instantaneous loudness. It must be able to express deliberate holds, contrast,
accents, and blackouts. A simple full-screen brightness output remains a valid
first deployment and evaluation surface.

## One signal, several adapters

- **Minimal browser:** amplitude controls full-screen brightness. A second
  dimension can determine color. Additional channels can be ignored.
- **Richer browser visuals:** the same channels can also control geometry,
  motion, density, and transitions where those meanings are defined.
- **DMX kit:** use more of the shared dimensions, with a fixture-specific adapter
  for channel layouts, supported capabilities, physical ranges, and calibration.
  Do not assume a learned scalar is already a pan/tilt or strobe command.

Start with a small interpretable contract and extend it when the source data
and target medium justify the extra dimensions. Avoid arbitrary extra outputs
with no defined meaning or dependable supervision. Do not force every medium
to consume every dimension.

## Data direction

- User-selected Of The Trees live performances: Ultra Miami 2026 and Electric
  Forest. Raw video supplies observed lighting/visual behavior; full-show audio
  also drives controlled visual-generation experiments.
- Creator-made song-to-visual references, including the supplied @syncopamusic
  TikTok. The linked clip has not yet been viewed by the agent.
- TouchDesigner oscilloscope and other audio-signal views as a controllable
  source of generated examples, with explicit audio-to-visual mappings.
- The edited concert video itself is also a potential teacher: shot timing,
  duration, close-ups, wide reveals, cutting pace and attention changes may
  express musical emphasis and phrasing. Preserve these as **editorial targets**,
  separate from observed lighting. A camera cut is valid editorial evidence but
  must not become a false fixture cue. Transfer to good lighting must be tested.
- **Exclude RPMC-L2 and its derived features, labels, and checkpoints.**

Keep recorded human visual decisions, inferred labels, procedural/generated
examples, and model predictions separately identified. A deterministic waveform
or spectrum can teach a mapping, but is not evidence of learned human lighting
choreography. Audio alone from a concert is not a lighting target.
Exact reconstruction of the lighting engineer's desk commands is not required.
Learn useful musical decision structure from observable evidence, retaining
uncertainty about authorship, production and which system caused each change.

New wide-shot references can improve visibility even when their audio is rougher.
Assess audio fidelity and visual reliability separately. Where the same live
performance has another audio recording, verify content alignment, clock drift,
edits and physical audio/video delay before pairing it. Never substitute a studio
version just because it is the same song. Alternate views of the same performance
must share a dataset split. Both Forest recordings are now a known matched group.

## Before training

1. Read this document and `VISUAL_SIGNAL_RESEARCH.md`.
2. Write down the exact output channels, meanings, units/ranges, color encoding,
   temporal resolution, and missing-label/confidence handling for that run.
3. Define the minimal browser mapping and at least a conceptual DMX mapping.
   Confirm each target has a useful interpretation outside one specific effect.
4. Inspect synchronized source/target examples. Check that processing preserves
   real holds, accents, blackouts, and transitions and flags camera artifacts.
5. Record which outputs are observed, inferred, or generated, with source and
   extractor versions. Do not manufacture labels for unobservable dimensions.
6. Group train/validation/test splits by source show, creator, and track as
   appropriate; isolate duplicates and generated variants to prevent leakage.
7. Evaluate meaningful audio conditioning and temporal behavior against simple
   loudness-only baselines and the user-endorsed stereo-scope reference. Evaluate
   rendered detail, timing, sensitivity, and musical judgment with the user,
   not just scalar prediction error. Record gain, window, and persistence so
   comparisons distinguish signal behavior from rendering settings.
8. Verify causality: feature windows end at the current captured sample; future
   audio is allowed only in training targets and evaluation. Test identical
   prefixes with different futures. Measure anticipatory errors as well as hits.
   Distinguish software timing estimates from measured microphone-to-photon or
   microphone-to-fixture timing. Do not claim unknown future events are certain.

The next research milestone is to preserve a reproducible stereo-scope baseline,
define a small controllable output contract from its useful behavior, and review
examples of those targets. The scope's success establishes the guiding behavior;
the reliability of extracted training targets still needs separate validation.

## Stereo-scope evidence

Before further concert-event training, read the
[label audit](../research/label_audit/RESULTS.md). It found sampling-sensitive
flashes, screen/fixture mixtures and a 300 ms contrast definition that can mark
short-flash releases late. Preserve near-native video timestamps, separate visual
source types, and verify the event's actual meaning before calling it an on-time
lighting cue. Historical labels remain preserved for reproducibility.

Read the [component study](../research/stereo_scope_analysis/REPORT.md) before
using stereo-scope behavior as supervision. Three sampled minutes suggest
separating amplitude, stereo breadth, and texture: bass can increase amplitude
while narrowing the shape; broadband drum candidates often increase lit area,
but widening changes by passage and is not unique to snares. Rendered brightness
depends on gain, line drawing, and persistence. Instrument labels in this pilot
are separator estimates or unreviewed heuristics, not clean stem ground truth.
The user's preferred visual direction is stereo scope; the prior spectrogram
study was a misunderstanding and is not the selected direction.

## Storage constraint

Keep heavy project content on SanDisk ExtremePro: source media, full-show audio,
rendered datasets, recordings, and large training artifacts. Local code, notes,
and lightweight project files can reference those assets. **Never delete
anything on ExtremePro.** Use new destinations and preserve existing files.
