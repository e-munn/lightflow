import { DanceAudio, HOP, RATE } from '../../../public/dance-audio.mjs';
import { analyzeMusic, type MusicEvidence } from './music-context';
import { audioTiming } from './brightness-timing';

/** Decode quietly. The video's original audio remains the only audible source. */
export async function loadMusicContext(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw Error('Audio analysis unavailable');
  const context = new OfflineAudioContext(1, 1, RATE);
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  signal.throwIfAborted();
  const channels = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
  const engines = channels.map(() => new DanceAudio());
  const frames: MusicEvidence[] = [];
  for (let start = 0; start + HOP <= buffer.length; start += HOP) {
    signal.throwIfAborted();
    const evidence = engines.map((engine, i) => engine.step(channels[i].subarray(start, start + HOP)));
    frames.push({ t: evidence[0].t, rms: Math.sqrt(evidence.reduce((sum, f) => sum + f.rms ** 2, 0) / evidence.length), flux: evidence.reduce((sum, f) => sum + f.features[9], 0) / evidence.length });
    if (frames.length % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  const music=analyzeMusic(frames);
  return {...music,timing:audioTiming(frames,music)};
}
