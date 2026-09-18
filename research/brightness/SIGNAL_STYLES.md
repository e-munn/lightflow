# Ten single-channel signal styles

User request: simplify the UI using the production branch's minimal dark styling, fix square fullscreen output, and offer ten tweakable alternatives that respond to more musical components than scope amplitude alone.

Demo: http://localhost:3001/scope/styles

The implementation reads `codex/production`'s director styling: dark background, thin neutral borders, restrained mint selection, compact controls, large rectangular output, output-only fullscreen. No checkout or production deployment occurred; no production model or dataset was reused. `/scope/threshold` also uses a compact matching layout, links to the ten styles and provides the user's preferred 33% / 3.3 button. Shared scope fullscreen CSS fills the viewport independently of the square analysis raster.

## Alternatives and controls

| Style | Measurement | Controls |
|---|---|---|
| Circle | Fixed radial scope response; .33 radius, soft inside, expanded outside, strength 3.3 | Radius, strength |
| Weight | Relative 60–250 Hz energy | Low emphasis, decay |
| Snap | Positive change across bands plus amplitude onset | Accent, decay |
| Air | 4–8 kHz energy and novelty | Air emphasis, decay |
| Sustain | 250 Hz–2 kHz body and continuity, transient attenuation | Body, tail |
| Width | Stereo covariance spread and positive width change | Spread emphasis, decay |
| Grain | Normalized waveform traversal and eight-band flatness | Texture, softness |
| Space | Onset event separation; dense hits do not all open the light | Minimum space, tail |
| Swell | Short versus long energy and spectral-centroid trend | Context, release |
| Breathe | Onset-driven dip with exponential recovery | Dip depth, recovery |

All ten run on the same source and produce alternative scalar values in [0,1]. No animation, color, fixture arrangement or autonomous tempo oscillator is added. Several paths modulate the preferred circle signal; transient and high-frequency paths can act independently of its instantaneous coverage. The Circle controls establish the common radial reference for those paths. Other style controls are independent. Eight filter bands describe spectral regions, not isolated instruments; flatness across broad bands is a coarse texture measurement, not a tone/noise classifier.

These are explicitly hand-designed hypotheses, not trained musical preferences. A different waveform is evidence that the control does something, not evidence that its attitude suits a song. Modes intentionally differ in mean brightness; perceptual preferences may therefore include intensity bias. The normalized-shape diagnostic checks that differences are not solely constant gain/offset, but does not solve that perceptual confound.

## Runtime and UI

`ScopeAudio` optionally requests existing eight-band `MusicFeatures` in the audio worklet. The option defaults off, preserving earlier scope-page processing. Band measurements are causal; all context contains received audio only. The fast output is not delayed by the slower context estimator. The bank resets on invalid data, discontinuity, stop/staleness and digital silence. This is not a tested acoustic noise-floor policy.

Select any preview to show its large output and two controls. Fullscreen fills the display, hides labels and supports left/right style selection, Space blackout and Escape exit. Output intensity is common to the alternatives. Scope reference can be hidden. “Keep this moment” captures source-linked preceding observations and settings; “Export” saves `lightflow-signal-styles.json`. Exported frames include chosen style, display gain, blackout and page visibility. These session-local reactions are not verified human preferences or exact numerical targets. Automated exports are flagged and excluded from claims of musical validation. No raw microphone audio is recorded.

## Verification and evidence

- `test_attitudes.mjs`: bass, treble, midrange, width and roughness distinctions at the same RMS and scope-value input; onset versus sustained behavior; spectral-rise response; tweak response, finite bounded outputs, deterministic prefixes and silence/invalid blackout.
- TypeScript check passed.
- `attitudes_browser_test.mjs`: ten selectable displays and twenty controls, source playback, recorded variation of all ten, all 45 pairwise differences after mean/variance normalization, saved preferred circle parameters, export, stop blackout, mobile layout and browser exceptions.
- Actual fullscreen rectangles for the new style display and earlier circle canvas were measured against browser viewport dimensions. The style output filled 1440×1060 with captions hidden. Keyboard switching and blackout passed.
- UI evidence and inspected desktop/mobile/circle screenshots: `/Volumes/ExtremePro/Code/lightflow/research/brightness_attitudes_ui_v1/`.
- Synthetic mic and system capture checks: `/Volumes/ExtremePro/Code/lightflow/research/brightness_attitudes_capture_v2/`. Both produce the new measurements, clear every style on digital silence, release tracks on stop, and export display conditions. v1 incorrectly required nonempty metrics on the initial silent frame; its files remain preserved. The corrected test accepts an empty metric record only when all ten outputs are zero. These tests do not use real microphones or measure physical latency.
- In the tested Forest excerpt, the smallest pairwise normalized-shape RMS difference was .627 over 626 observed frames. Main-thread projection/bank compute p95 was 1.30 ms; this excludes worklet processing, physical input and display latency. It is not a musical-success score or an end-to-end timing claim.

New SanDisk outputs use exclusive creation. Prior files remain intact. The broad model goal remains incomplete: cross-song musical preference, learned improvement and physical timing still need evidence. These alternatives make signal-to-attitude choices concrete for the next listening comparison.
