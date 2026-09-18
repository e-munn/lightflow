# Human comparison protocol

Purpose: collect actual judgments of musical timing, fine detail and phrasing
for the current trained modulation, rather than infer quality from prediction
metrics. This is an evaluation tool, not personalized control or preference
training. No automated test response counts as human evidence.

Open http://localhost:3001/scope/review manually in Dia. Prefer music not used in
previous model work. Select familiarity honestly; this self-report alone does not
prove that music is outside the corpus. A built-in Jack White excerpt is an
exploratory comparison already used for execution/replay, not a fresh final test.

Each trial pairs the gain-augmented trained layer with one randomly chosen
control: direct scope, simple current-context modulation, or delayed model
history. A/B position is randomized independently. Both share current direct
scope details, audio, renderer, color mapping and canvas dimensions. Identities
stay hidden in the visible UI until a judgment is saved. This is UI blinding,
not protection against inspecting the source code or stored mapping.

Both panels remain dark for 42.5 seconds of context, even if a particular control
could start earlier. At least 20 seconds of fresh, fully ready comparison frames
are required before finishing and judging. Long files are needed (roughly 63
seconds minimum). Playback duration does not prove attention or comprehension.
This protocol does not measure physical end-to-end timing.

After listening, rate A, B, no clear difference, or neither works well for:
overall musicality, timing, fine detail and phrasing. A note can identify the
moment that shaped the judgment. Record before revealing identities; answers
lock on save. Local browser storage retains judgments; export JSON to preserve
and inspect them. Source filenames, familiarity, model fingerprint, randomized
order, ready-frame duration, errors, drops and resets accompany each record.
No audio is uploaded. No automatic parameter changes follow ratings.

Interpretation: inspect ratings per control and source, not just pooled wins.
Check playback health, repeated music, exposure to identities and order effects.
A few preferences are formative evidence, not proof of human-level direction.
A proper final evaluation still needs a predeclared unfamiliar-song set, multiple
musical passages and independent human review, plus physical timing measurements.
Model errors prohibit submission; missing weights cannot masquerade as a model
trial through direct-output fallback. Storage failures offer explicit export.

## Implementation verification

TypeScript passes. Muted headless Chrome completed a real file-playback trial,
checked warm-up blackout and minimum duration, required all four judgments,
verified reveal-after-save, JSON export, reload persistence, mobile overflow,
and rejection of a missing-model trial. No page errors, context resets or
queue drops. Desktop screenshot inspected. Test evidence is on ExtremePro at
`Code/lightflow/research/native_cues/blind_review_ui_v1`. The exported answers
are explicitly AUTOMATED TEST ONLY and are not human evaluation, regardless
of the normal submission field in their schema. No real microphone was used
and no user browser was opened. Later copy-only change says seconds compared
rather than seconds heard, since playback does not prove listening.

## Version 2: visibility and evidence audit

Ready comparison time now counts only while the document is visible and at least
90% of each canvas is in the viewport. Mobile keeps both views side by side.
The export declares evaluationVersion 2, visibleOnly, navigator.webdriver's
automation flag, and gaps greater than 100 ms between counted audio frames.
The UI does not prove attention, audibility or human identity; these fields
make known problems explicit. This changes evaluation instrumentation only,
not the model, renderer or musical output.

`audit_human_reviews.py export1.json export2.json --out <NEW_REPORT.json>`
conservatively excludes known automated/test answers, legacy exports missing
provenance, incomplete or invalid ratings, invalid model hashes or pairings,
short comparison duration, playback errors, gaps, resets and queue drops.
Exact duplicate trial exports count once; conflicting copies exclude both.
Descriptive counts are separated by model fingerprint, control and declared
music familiarity. No significance test, independent-song count, physical
latency or success claim is inferred. A source filename is not a track identity.
Five unit tests cover mapping in both A/B orders, duplicate handling, conflicts,
invalid playback/schema values and automated-data exclusions.

The version-2 real-playback browser test passed, including reducing the viewport
until panels were off-screen and restoring it. Export correctly marks automation.
The audit of both existing automated exports reports zero eligible human trials.
Evidence: ExtremePro `Code/lightflow/research/native_cues/blind_review_ui_v2/`
(test-report.json and evidence-audit.json). No human result has been collected.
Visible duration is cumulative, not a guarantee of one continuous observed
passage; leaving the viewport pauses counting, and later visible playback can
resume. Discontinuities during otherwise eligible playback are recorded.
