# V2/V3 preregistration — 2026-09-21 overnight

V0 and V1 remain frozen references. Do not tune against the reserved sources.

V2 first hypothesis: retaining a Snap event only when the audio provides a recent
accent will remove unsupported flashes. Keep accepted events at their original
movement timestamps. Do not quantize to a BPM oscillator or generate replacement
events. Use a fixed 120 ms backward support window (analysis delay included).
Spectral accents require a locally prominent peak and 100 ms refractory spacing;
peak confirmation uses one 20 ms future analysis frame, represented explicitly
as availability time. No support before that availability time is allowed.

V3 tests one expression role: at those SAME retained event times, use observed
Open to scale accent amplitude. Use the SAME release duration as V2 to isolate
amplitude shaping. Keep V3 constrained to 25–100% of V2 event amplitude so an
unextended pose does not erase every accent. This floor is an authored policy,
not learned truth. No motion means no new hit; a wide held pose alone cannot keep
the light on. Missing pose/Open evidence blanks output instead of freezing it.

Ablations: ungated Snap with matched fade, audio-transient-only light, RMS-only
light, and V3 without Open (exactly V2). Inspect original Open separately. Keep
native gain and equal-mean summaries. An amplitude-shaping experiment may fail
to preserve the original Open's sustained feel; do not hide that tradeoff.

Timing diagnostics: compare accent onsets with independently computed RMS-rise
anchors (120 ms tolerance) as well as the construction detector, and with an
audio-only phase grid if sufficiently supported. RMS anchors and an estimated
grid are NOT ground-truth beats. Report coverage, event retention, saturation,
one-frame pulses, and brightness. Wrong-audio controls pair each development
clip with the next fixed development source. Shift controls use a fixed +0.7 s
cue shift (discard edges, never wrap). A gate must demonstrate that real support
differs from unrelated support. Do not automatically prefer a sparser/darker
output; zero events has no defined timing precision.

Reject as a general replacement if it removes most observed Snap events on most
development passages or cannot distinguish true from mismatched support. A
rejected result remains playable and documented. Only after V2/V3 are frozen,
evaluate the reserved sources ONCE. No tuning after opening reserved results.
Perceptual success remains an audition decision.
