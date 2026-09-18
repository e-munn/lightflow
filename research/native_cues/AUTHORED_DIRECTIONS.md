# Authored lighting directions — September 17, 2026

Following direct user feedback that the learned/direct/delayed comparisons looked identical, this experiment changes the temporal and spatial output behavior. It does not train or promote a model.

A single 60-second video presents four proposals on the same Of The Trees Electric Forest audio passage (source 31:00–32:00), using identical fixture geometry and palette:

- Sustain: broad, held field with energy detail.
- Build/release: deliberately authored 12-second rise and 4-second release cycle. This is not a detected musical phrase or prediction.
- Accent/rest: strong audio attack threshold, refractory period and short decay into darkness.
- Spatial transition: attacks advance between four focus positions with smooth movement.

The three audio-driven behaviors use existing past-frame scope features. Initial state is explicitly initialized at the excerpt start. No labels are recovered from a lighting engineer, and no claim of learned anticipation is made. The proposals are not four trained alternatives; their purpose is to choose a useful output vocabulary before further training.

Renderer: `render_authored_directions.py`.

New, non-overwriting artifacts:
- `/Volumes/ExtremePro/Movies/Exports/lightflow_authored_directions_forest_9-17-26.mp4`
- `/Volumes/ExtremePro/Code/lightflow/research/native_cues/authored_directions_v1/` (manifest, fixture traces and representative images).

Review: http://localhost:3001/scope/review, featured first. Previous candidate videos remain under a collapsed reference section. All pre-existing SanDisk files are preserved.

Validation: TypeScript check passed; representative rendered frame inspected for readable labels and distinct spatial states. Browser playback and media-stream checks recorded in the task output. Musical suitability still requires listening review; visible difference alone is not success.
