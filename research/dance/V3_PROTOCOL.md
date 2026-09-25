# V3 preregistration — audio-timed Open

This replaces the planned Open multiplier on rejected V2. Keep V2 frozen and
playable. V3 is a new timing architecture, not a tuned V2 gate.

## Fixed policy before development results

- Reuse the recorded audio-accent candidates, but admit only strength >= 0.9
  (strength is positive spectral change divided by the excerpt's 95th percentile,
  capped at one). A greedy refractory interval is half the estimated beat,
  bounded to 180–300 ms, or 250 ms when BPM is uncertain. No generated beat grid.
  This removes weak/dense novelty; it does not establish true beat identity.
- Emit on the first source-pose frame at/after the accent's explicit availability
  time. Availability includes one 20 ms peak-confirmation frame. Do not shift
  audio/video. Additional quantization is at most one valid pose-frame interval.
  The spectral feature uses a trailing 32 ms window. Complete excerpt scaling
  and BPM estimation use future data, so this remains an offline teacher study.
- Causally smooth normalized Open with a 200 ms time constant; reset at gaps,
  cuts, non-increasing timestamps and identity changes (raw reset flag). At each
  selected audio accent, amplitude = 0.25 + 0.75 × smoothed Open. Emit no new
  light from an open posture by itself. Confidence loss means unavailable, not
  a held brightness or a zero-value pose observation.
- The constant-amplitude ablation uses exactly the same event timestamps,
  validity mask, and fade. Fixed amplitude 0.625 corresponds to Open=0.5.
  Native and mean-brightness-matched results are both reported. In the player,
  mean matching defaults on for comparing the constant control against V3.
- Sensitivity targets 90% at the 90th percentile of event amplitudes, bounded
  to 0.65–1.5. Fade follows the existing Open BPM/texture policy. If tempo is
  unknown, use half the median selected-event spacing as the time to lose 90%,
  bounded to 50–350 ms; 160 ms fallback if fewer than four events.

## Controls and acceptance limits

Run development/stress sources first. Before opening reserved sources, freeze
code hashes. Run reserved sources once; no tuning from reserved results.

Wrong-movement control pairs each source with the next source within its split.
Use target-audio event times and sample the other passage's Open at those times.
Report shared-visibility coverage; do not treat missing wrong poses as zero.
Record amplitude variation and relationships to audio level on common events.
These are diagnostics, not aesthetic objectives. Neither detector alignment nor
a correct BPM demonstrates the expressive contribution of Open, because the
candidate and its ablation deliberately have identical audio timing.

Report broad/selected/visible event counts, cue density, confirmation and display
latency, saturation, mean brightness, peak range, isolated-frame pulses, masked
gaps, and constant/mismatched movement comparisons. Avoid claiming improvement
solely because the new result is sparser, darker, or closer to its own detector.
Synthetic tests cover silence, sustained tones, weak events, dense events,
known-tempo pulses, missing joints, cut/track resets and no pre-confirmation hit.

V3 can be offered as a listening candidate if these functional guarantees hold.
It is not approved for training until the user prefers its expression over the
constant-amplitude control on several passages. If the difference is unhelpful,
retain the simpler audio-only clock and reject the extra motion dependency.
