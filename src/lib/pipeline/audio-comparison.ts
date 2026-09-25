import { ScopeBrightness, SCOPE_BRIGHTNESS_VERSION } from '../../../public/scope-brightness.mjs';

export type AudioReference = { t: number; scope: number; loudness: number; rms: number };
export type AudioComparison = { frames: AudioReference[]; sampleRate: number; channels: number; scopeVersion: string };

/** Offline reference only. Never connects another audible source or advances the video. */
export async function compareAudio(url: string, signal: AbortSignal): Promise<AudioComparison> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('Source audio unavailable');
  const context = new OfflineAudioContext(2, 1, 48000);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  signal.throwIfAborted();
  if (buffer.numberOfChannels > 2) throw Error('Comparison currently supports mono or stereo sources');
  const left = buffer.getChannelData(0), right = buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1));
  const scope = new ScopeBrightness(document.createElement('canvas'), 40);
  scope.soft = true; // Unchanged default used in /scope/brightness.
  const windowSize = Math.round(buffer.sampleRate * .02), frames: AudioReference[] = [];
  for (let end = windowSize; end <= buffer.length; end += windowSize) {
    signal.throwIfAborted();
    const l = left.subarray(end - windowSize, end), r = right.subarray(end - windowSize, end);
    let squares = 0;
    for (let i = 0; i < windowSize; i++) squares += (l[i] ** 2 + r[i] ** 2) / 2;
    const rms = Math.sqrt(squares / windowSize);
    frames.push({ t: end / buffer.sampleRate, scope: scope.frame(l, r).brightness, loudness: 1 - Math.exp(-4 * rms), rms });
    if (frames.length % 30 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { frames, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, scopeVersion: SCOPE_BRIGHTNESS_VERSION };
}

export function atTime<T extends { t: number }>(frames: T[], time: number | null, maxAge = .15): T | null {
  if (time === null) return null;
  let low = 0, high = frames.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (frames[middle].t <= time + .001) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found >= 0 && time - frames[found].t <= maxAge ? frames[found] : null;
}
