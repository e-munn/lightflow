# Coordinated prototype — 2026-09-17

User feedback: the four behaviors serve different musical purposes; selecting one winner is inappropriate. The next output vocabulary should combine sustained presence, builds/releases, accent/rest and spatial transitions.

`render_coordinated.py` renders one 60-second view with original Forest audio (31:00–32:00). Authored rules blend all four layers. A positive difference between fast and slow energy envelopes widens the build layer; audio attacks trigger decaying accents and advance a smoothed spatial focus. A quiet-input gate reduces the held bed and movement. Ten seconds of prior features initialize state. No periodic build schedule, learned prediction, instrument isolation or inferred lighting-engineer intent is claimed.

Output levels are combined as 1 minus the product of complementary intensities. This avoids simple additive clipping. The display uses a .55-power brightness transfer for visibility; this is a preview, not calibrated DMX output. The v1 dim render remains preserved; v2 improves visibility. These are design prototypes, not training labels or proof of musical understanding.

New media: `/Volumes/ExtremePro/Movies/Exports/lightflow_coordinated_forest_v2_9-17-26.mp4`.
Traces and provenance: `/Volumes/ExtremePro/Code/lightflow/research/native_cues/coordinated_v2/`.
Page: http://localhost:3001/scope/review. Earlier examples remain available below.

Review prompt: note approximate timestamps where the unified behavior feels connected or arbitrary. Do not require choosing one behavior to the exclusion of others.
