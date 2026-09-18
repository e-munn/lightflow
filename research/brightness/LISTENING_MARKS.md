# Listening marks — 2026-09-17

Purpose: obtain observations about the current scalar's musical usefulness before inventing another numerical teacher. This does not replace the active goal with an annotation tool; it supplies missing evidence for its next training target.

At http://localhost:3001/scope/brightness, play music, keep the brightness field visible, then mark “Follows the music,” “Missed detail,” or “Stays bright.” The mark retains up to five preceding seconds of *drawn* brightness, eight audio features, display exposure/curve, source identity, approximate source position, viewport fraction and page visibility. It is a reaction window, not an exact onset or desired brightness label. An optional note applies to the most recent unsaved mark.

“Save marks to project” writes fresh UUID-named JSON files under `/Volumes/ExtremePro/Code/lightflow/research/brightness_feedback/submitted/`. Existing files are never overwritten or deleted. Automated sessions are stored separately under `automated/`. Server save-time metadata links built-in audio URLs to the current asset path, size and modification time; it is not a verified playback-time content hash. Uploaded files retain name, size and modification time; raw audio is not uploaded or recorded. Live capture observations retain features but cannot replay missing raw audio.

The browser also retains marks and saved IDs locally; “Export marks” creates a JSON copy. Successful saves make notes immutable in that browser record. Interrupted/retried saves can create duplicate records, which the audit deduplicates by mark ID. Conflicting records are excluded from automatic eligibility. The API validates bounded frame data, source types, settings and JSON size, rejects cross-origin requests, and strips unknown properties before saving.

`audit_moments.py` rejects automated/unknown interaction provenance, inadequate visible context, changed display settings, invalid timing/data, conflicting IDs and live sources without replayable audio. Passing these checks means only **candidate for manual review**. The auditor never converts a mark into a training-ready target. It does not establish unfamiliar-song status, independent human identity, a preference over another model, musical quality across a corpus, or physical latency.

Checks completed:
- Headless browser marks a visible playing source, edits a note, exports, saves on ExtremePro, reloads persisted state and verifies saved-note immutability.
- Invalid brightness and cross-origin submissions rejected.
- Correct source asset metadata stored; audio byte-range playback remains intact.
- Three unit tests cover visibility/settings/provenance, duplicate/conflicting IDs and automated exclusion.
- TypeScript check passed.

Evidence: `/Volumes/ExtremePro/Code/lightflow/research/brightness_moments_ui_v2/`.
The first test asserted browser persistence before hydration completed; that attempt was preserved. The corrected test waits for hydration and passes. Current audit: two unique automated fixture marks, one duplicate, zero candidate listener observations and zero training-ready labels. A targeted Downloads search found no `lightflow-scope-moments*.json` or `lightflow-scope-brightness-timing*.json` exports.

The previous goal turn was progress; this turn added and verified the evidence-intake path. No new model was trained or promoted. The goal remains active and incomplete. The listening question about the scalar's retained musical detail is still pending, and a real capture/display timing measurement is still missing.
