# Wide-shot pilot and audio pairing

The 42:40–43:40 Forest replay is saved at:
`/Volumes/ExtremePro/Code/lightflow/research/concert_cues/wide_pilot_forest_v1/source_and_regions.mp4`.
It is a verified 60-second, 1280×720 stereo video, with 1,800 source observations.
The user-facing export was copied with verified checksum to the drive's export
structure: `/Volumes/ExtremePro/Movies/Exports/lightflow_wide_forest_regions_9-16-26.mp4`.
Four stage-interior regions exclude the header, side LED panels, audience and
foreground totem in the inspected frame; the side panels are measured separately.
Frames at 0, 15, 30 and 45 seconds show both dark and bright states preserved.
Full camera/occlusion continuity and perceptual timing have not yet been reviewed.

Regional p99 image luminance varies from roughly .01–.03 to .99. This is observed
image brightness, not calibrated fixture intensity. Bright passages clip: the
fraction of frames with more than 1% clipped RGB channel samples is 25.2%, 49.3%,
52.4% and 16.7% in the four regions. Brightest-pixel color therefore approaches
white and loses information. These observations cannot be treated as clean
fixture colors or exact intensity values. A later target should retain clipping
flags, use unsaturated chromatic evidence where available, and mark color unknown
where it is not observable; never fabricate a saturated hue.

The replay is source extraction, not model-generated light. No frames from this
pilot are admitted to training. Both Forest recordings remain in the same holdout
group. The user found the one-minute preview promising but explicitly lacked a
comparison and wondered about pixel selection. This is positive extraction
feedback, not approval of model quality. A later matched pixel-method comparison
is at `/Volumes/ExtremePro/Movies/Exports/lightflow_pixel_methods_9-16-26.mp4`.

The same-performance audio match is strong in many separated sections, but
repetitive passages create ambiguous correlation peaks. The dense anchor audit
is at `forest_recording_alignment_v2/dense_anchors.json`. Keep weakly matched
intervals out of any remux/paired dataset until checked. Matching recorded audio
waveforms does not correct audience sound travel or establish stage-light timing.
The current replay deliberately uses its original recording's audio.

Next: apply reusable regional extraction to other wide-shot shows, review actual
camera stability and exposure, define missing-label masks and coarse-to-fine
timing uncertainty, then train on shows outside the Forest holdout group. The
electronic editorial experiment is separate and must earn transfer to lighting.
