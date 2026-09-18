# User visual review — current modulation is not meaningful

Direct conversation feedback, not an automated rating:
- Four rendered versions show no meaningful differences.
- Live View A and View B also look the same, described as “literally the exact same.”

Decision: current learned modulation fails the user's meaningful-expression
criterion. Do not ask for repeated comparisons of this same candidate as the
next research step. This is qualitative feedback, not an A/B preference count;
the exact randomized pairing and playback state were not captured.

Routing inspection: the live review selects two distinct output indices,
always learned versus one control. In the saved browser_streaming_v2/file.json
regression trace, all 64 fully warmed delayed-ready frames differ numerically
between learned and every control. This does NOT inspect the user's actual
session and cannot rule out a session-specific fault. It does show that the
implemented route is not universally duplicating the same buffer.

Structural problem: every condition shares hue, texture, balance, attacks and
the same renderer. The model only adjusts intensity and spread. Different
numbers have not translated into meaningfully different musical behavior.

Next target: a short temporal lighting sequence with separately defined base
intensity, accent envelope, spatial distribution and transition duration.
Preserve the scope's fast detail within that sequence. First author and show a
small set of clearly distinct, musically motivated target examples for the same
passage; these are design proposals, not learned output or recovered engineer
commands. Agree on the observable behavior before another training run. Then
build reviewed supervision for that contract and test causal sequence prediction
on separate music. Physical timing remains required, not a substitute for this
failed musical-expression result.
