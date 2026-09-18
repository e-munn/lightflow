# Music encoder feasibility

The signal-only lighting baselines have not earned live promotion. Test whether
richer pretrained music representations help the eventual director recognize
musical context. This is an input-feature experiment, not lighting supervision
and not a replacement for reliable observed cues or human evaluation.

Candidate: official [MERT-v1-95M](https://huggingface.co/m-a-p/MERT-v1-95M), revision
`12af15fef9d0ac838c3f475bfbbf26d2060dd4f5`. Its [paper](https://arxiv.org/abs/2306.00107)
studies music representations learned with acoustic and pitch-oriented teachers.
The model card specifies 24 kHz audio, 95M parameters and five-second pretraining
context. Weights are CC-BY-NC-4.0: research candidate, not a cleared commercial
dependency. Record weights and source hashes. No RPMC-L2 assets/checkpoints are
introduced. MERT's published pretraining source is music audio, not our lighting
corpus; its full pretraining track list has not been independently audited.

## Causal use

MERT is bidirectional inside its input window. Feed a five-second window ending
at the most recently received sample and timestamp its output at that endpoint.
Never run it over a complete song and retrospectively call internal features
causal. Resampling and normalization must happen after slicing the past window,
so filter padding and normalization cannot read audio after the endpoint.
For this feasibility test use the left input channel, avoiding antiphase stereo
cancellation; the immediate stereo path continues using both channels.

Candidate cadence: two updates/second for musical context; direct scope remains
50 Hz. A five-second history is not five seconds of look-ahead. It does imply
warmup. Actual processing duration and scheduling add latency and must be
measured. Output window means and recent-frame means from layers 6 and 12 are
candidate features; this does not itself identify instruments or prove phrasing.

## Load and verify before extraction

Inspect official config/model source. For this exact checkpoint, CQT features,
DeepNorm and attention relaxation are disabled; projection layer normalization
is enabled. The active inference architecture matches native HuBERT modules.
Use the installed Transformers implementation with a strictly loaded state dict,
without executing downloaded custom code. Any legacy positional-convolution
weight-normalization key conversion must be explicit and reported. This is an
architecture-based compatibility check, not independent upstream output parity.

Use torch.load(weights_only=True). Benchmark actual training-source audio on MPS,
check finite outputs, record p50/p95 processing times, and test identical past
audio with different futures. Keep the source, weights and heavy outputs on
ExtremePro, in new exclusive destinations. No training or live integration until
these feasibility checks pass and feature targets/splits are specified.
