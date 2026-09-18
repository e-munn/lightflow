# Physical timing measurement kit — awaiting a real recording

The prior turn completed the fixture dry run. This kit prepares the missing
physical timing evaluation; it does not measure the system merely by existing.
No microphone/camera was opened, audio played, or DMX fixture driven by this work.

## Probe

ExtremePro: `Code/lightflow/research/physical_timing/probe_v1/timing-probe.wav`.
Stereo 48 kHz PCM, identical channels, 45 seconds of silence to fill model
context, then 20 irregularly spaced 40 ms tone bursts at three amplitudes.
Its SHA and exact source samples are in stimulus.json. The file's scheduled
sample times are NOT measured acoustic or optical onsets. This probe tests
transport/response timing, not musical intelligence or anticipation of songs.

For microphone testing, an external source can play the probe near the tested
microphone while an independent recording captures the audible source and
screen/fixture response. Keep the reference acoustic point near the tested
microphone or quantify the path difference. Record the actual app input mode,
renderer/model, output target and physical setup. For system-audio testing,
identify the reference point explicitly; source-file sample times alone do not
establish when a DAC or speaker emitted the sound. Repeat levels and retain
misses instead of discarding them as outliers.

A shared-clock audio-reference/photodiode recording is a candidate setup if
appropriate sensors and interfaces are available. A phone view of sound and
screen can provide a coarser exploratory recording, but camera A/V offset,
exposure, rolling readout and acoustic paths need calibration/bounds before
claiming input-to-photon latency. Frame PTS differences alone are insufficient.
The user's available setup is currently unknown; no equipment is assumed.

## Event input

The analyzer consumes extracted event intervals in seconds, not raw video. This
makes uncertainty explicit and avoids assuming a threshold extractor is valid
for an unknown sensor. Retain raw recordings, extraction code/thresholds and
reviewed event frames/samples alongside the JSON. The current kit does not yet
supply or validate a real-recording event extractor.

```json
{
  "provenance": "physical_recording",
  "capture_file_sha256": "<hash of retained raw recording>",
  "event_extraction_method": "<sensor, reference point, threshold, timebase and review procedure>",
  "audio": [[1.000, 1.002], [3.000, 3.002]],
  "light": [[1.080, 1.090], [3.080, 3.090]],
  "pairing_window_s": [-0.5, 0.75],
  "calibration": {
    "light_minus_audio_clock_offset_s": 0.02,
    "offset_uncertainty_s": 0.005,
    "method": "<independent calibration evidence, not inferred from desired response>"
  }
}
```

Numbers above illustrate the schema, not actual measurements. Each interval
bounds the detected event time including relevant sampling/exposure/threshold
uncertainty. Positive clock offset means the light timestamp reads later than
the audio clock for simultaneous events, so subtract it. Omit unknown calibration;
the output then reports raw differences only. Unknown sensor/path delay must
not be silently treated as zero. Intervals and clock offsets require independent
physical justification; the analyzer cannot provide it from numeric fields.

Run `python3 research/physical_timing/analyze.py events.json --out <NEW_EXTERNAL_RESULT.json>`.
Output refuses an existing file. Pairing must be unique in both directions and
monotonic within a predeclared broad window. Calibration is applied before
matching; uncertainty expands bounds. Ambiguous events are excluded and counted,
not assigned to whichever match improves latency. Report missing/extra events
alongside median/p95, which describe matched events only. Negative delays remain
visible for investigation. Declared physical provenance is explicitly not
independent verification or completion of the goal.

## Tests and current result

Seven unit tests cover known interval delay, calibration sign and uncertainty,
large known clock offsets, ambiguity, misses/extras, negative delays and malformed
events. Probe waveform verifies stereo equality, silence, 20 bursts and hash.
Synthetic input recovers a 65 ms corrected midpoint with a 20 ms interval width;
these numbers are deliberately constructed and say NOTHING about Lightflow's
physical latency. Saved synthetic results declare physical_measurement_declared
false. Human musical review and real capture remain outstanding. All SanDisk
assets are additive; no earlier file was changed or deleted.
