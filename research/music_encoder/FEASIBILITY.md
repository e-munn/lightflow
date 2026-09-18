# Frozen music encoder: initial feasibility passed

Pinned official MERT-v1-95M weights loaded strictly into the installed native
HuBERT implementation after inspection of the checkpoint's active config and
official inference path. Two positional-convolution weight-normalization keys
were explicitly mapped to the newer PyTorch names. Every parameter then matched.
No downloaded custom code was executed. Independent upstream output parity has
not been established; this is architecture/config/state compatibility evidence.

On 15 seconds of training-source ALLEYCVT audio, the Mac MPS GPU processed 21
trailing five-second windows at half-second steps. First-window cost was 614.6 ms;
after warmup, preprocessing plus inference p50 was 49.6 ms, p95 51.3 ms, maximum
51.9 ms. None of the 20 warm windows missed the proposed 500 ms update budget.
This is a short local benchmark, not a full live-load or physical-latency result.

The window is sliced at native sample rate before resampling and normalization.
Replacing every audio sample after a tested endpoint left both preprocessed input
and resulting features identical (maximum output error zero). Only past audio
is provided to bidirectional attention. The five-second context is history and
startup warmup; it is not access to future music. Processing time adds latency.

Candidate representation: 3,072 values from layers 6 and 12, each pooling the
whole received window and its latest 38 representation frames. Use the left
channel for this context branch; the fine stereo path keeps both channels. These
are pretrained representations, not proven instrument labels or lighting cues.

Benchmark artifacts:
`/Volumes/ExtremePro/Code/lightflow/research/music_encoder/benchmark_v1`.
Official weights and file hashes:
`/Volumes/ExtremePro/Code/lightflow/research/third_party/mert_v1_95m_2026-09-16`.
Weights are CC-BY-NC-4.0 and remain a research candidate.

Feature extraction and the first frozen-feature comparison are now complete.
All fourteen files passed shape, timestamp and finite-value checks. None of the
fresh heads passed the validation cue threshold, and combined features did not
beat signal features or wrong history on the Forest development test. See
PROBE_RESULTS.md. Input feasibility has not translated into reliable directing.
