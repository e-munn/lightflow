"""Embedded Script TOP callbacks. Audio measurements, no learned model."""
import numpy as np

N = 8192
W = 512
BINS = 128
ring = np.zeros((2, N), np.float32)
history = np.zeros((2, W, 4), np.float32)
waterfall = np.zeros((BINS, W), np.float32)
previous = np.zeros(BINS, np.float32)
last_frame = -1
last_source = None
last_image = np.zeros((BINS + 5, W, 4), np.float32)


def onCook(scriptOp):
    global ring, history, waterfall, previous, last_frame, last_source, last_image
    root = scriptOp.parent()
    frame = int(absTime.frame)
    if frame == last_frame or root.par.Freeze.eval():
        scriptOp.copyNumpyArray(last_image)
        return
    last_frame = frame
    source = root.op('audio_signal')
    pcm = source.numpyArray()
    source_key = (root.par.Source.eval(), root.par.Audiofile.eval(), source.rate)
    if source_key != last_source:
        ring.fill(0); history.fill(0); waterfall.fill(0); previous.fill(0)
        last_source = source_key
    if pcm is None or pcm.size == 0:
        pcm = np.zeros((2, 1), np.float32)
    if pcm.shape[0] == 1:
        pcm = np.repeat(pcm, 2, axis=0)
    pcm = np.nan_to_num(pcm[:2], copy=True)
    n = min(pcm.shape[1], N)
    ring = np.roll(ring, -n, axis=1)
    ring[:, -n:] = pcm[:, -n:]
    sr = float(source.rate or 48000)
    mid = (ring[0] + ring[1]) * .5
    side = (ring[0] - ring[1]) * .5
    span = int(np.clip(sr * root.par.Windowms.eval() / 1000, 64, N // 2))
    end = N
    if root.par.Trigger.eval():
        # Latest rising zero crossing with room for the requested trailing window.
        candidates = np.where((mid[:-1] <= 0) & (mid[1:] > 0))[0]
        candidates = candidates[(candidates >= N - span - 1024) & (candidates <= N - span)]
        if len(candidates): end = int(candidates[-1] + span)
    positions = np.linspace(end - span, end - 1, W)
    x = np.arange(N)
    image = np.zeros((BINS + 5, W, 4), np.float32)
    for c, values in enumerate([ring[0], ring[1], mid, side]):
        image[0, :, c] = np.interp(positions, x, values)
    # Stereo power averaging prevents cancellation of anti-phase content.
    fft_n = 4096
    window = np.hanning(fft_n)
    fft = np.fft.rfft(ring[:, -fft_n:] * window, axis=1)
    amp = np.sqrt(np.mean(np.abs(fft) ** 2, axis=0)) * 2 / window.sum()
    hz = np.fft.rfftfreq(fft_n, 1 / sr)
    edges = np.geomspace(20, min(20000, sr / 2), BINS + 1)
    spectrum = np.empty(BINS)
    for i in range(BINS):
        bins = (hz >= edges[i]) & (hz < edges[i + 1])
        spectrum[i] = np.sqrt(np.mean(amp[bins] ** 2)) if np.any(bins) else np.interp(np.sqrt(edges[i] * edges[i + 1]), hz, amp)
    db = 20 * np.log10(np.maximum(spectrum, 1e-9))
    display = np.clip((db + 72) / 72, 0, 1)
    flux = np.maximum(spectrum - previous, 0)
    previous = spectrum.copy()
    image[1, :, 0] = np.interp(np.linspace(0, BINS - 1, W), np.arange(BINS), display)
    image[1, :, 1] = np.interp(np.linspace(0, BINS - 1, W), np.arange(BINS), np.clip(flux * 15, 0, 1))
    # Three explicitly frequency-defined bands, not isolated instruments/stems.
    bands = [(20, 250), (250, 2000), (2000, min(20000, sr / 2))]
    full_hz = np.fft.rfftfreq(N, 1 / sr)
    full_fft = np.fft.rfft(ring, axis=1)
    levels = []
    for i, (lo, hi) in enumerate(bands):
        filtered = np.fft.irfft(full_fft * ((full_hz >= lo) & (full_hz < hi)), n=N, axis=1)
        image[2, :, i] = np.interp(positions, x, filtered.mean(axis=0))
        levels.append(float(np.sqrt(np.mean(filtered[:, -2048:] ** 2))))
    recent = ring[:, -2048:]
    rms = float(np.sqrt(np.mean(recent ** 2)))
    peak = float(np.max(np.abs(recent)))
    denom = np.sqrt(np.sum(recent[0] ** 2) * np.sum(recent[1] ** 2))
    correlation = float(np.sum(recent[0] * recent[1]) / denom) if denom > 1e-10 else 0
    side_rms = float(np.sqrt(np.mean(side[-2048:] ** 2)))
    mid_rms = float(np.sqrt(np.mean(mid[-2048:] ** 2)))
    width = side_rms / max(side_rms + mid_rms, 1e-9)
    history = np.roll(history, -1, axis=1)
    history[0, -1] = levels + [rms]
    history[1, -1] = [float(np.clip(flux.sum() * 3, 0, 1)), correlation, width, peak]
    image[3:5] = history
    waterfall = np.roll(waterfall, -1, axis=1)
    waterfall[:, -1] = display
    image[5:, :, 0] = waterfall
    image[5:, :, 3] = 1
    last_image = image
    root.store('metrics', dict(rms=rms, peak=peak, correlation=correlation, width=width, bass=levels[0], mid=levels[1], high=levels[2], sample_rate=sr, onset=float(history[1, -1, 0])))
    scriptOp.copyNumpyArray(image)
