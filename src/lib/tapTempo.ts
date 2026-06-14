// Tempo clock with two inputs: tap (T) and a direct numeric set (e.g. 130.1).
//
// PHASE-CONTINUOUS: the beat counter is accumulated incrementally each frame
// (accum += dt / beatLen), NOT computed as elapsed/beatLen from an anchor. This
// matters for auto-BPM follow — a tempo change only alters the future rate of
// advance, so the beat phase never jumps and motion stays smooth. tap()/set()
// snap the downbeat (a small fractional nudge); setRate() changes tempo with no
// phase jump at all. Times in ms (performance.now()).

const RESET_GAP_MS = 2000; // a pause longer than this starts a fresh tap series
const MAX_TAPS = 6;

export class TapTempo {
  bpm: number | null = null;
  private beatLen = 0; // seconds per beat (0 = unset → free-run default)
  private accum = 0; // continuous beat count
  private lastNow = 0;
  private taps: number[] = [];

  private bl() {
    return this.beatLen || 0.5; // default 120 BPM so motion free-runs before any tap
  }

  // Advance the continuous beat counter. Call once per frame (the render loop).
  beats(now: number): number {
    if (this.lastNow === 0) this.lastNow = now;
    const dt = (now - this.lastNow) / 1000;
    this.lastNow = now;
    if (dt > 0 && dt < 1) this.accum += dt / this.bl(); // skip huge gaps (tab was hidden)
    return this.accum;
  }

  phase(): number {
    return this.accum - Math.floor(this.accum);
  }

  tap(now: number) {
    if (this.taps.length && now - this.taps[this.taps.length - 1] > RESET_GAP_MS) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > MAX_TAPS) this.taps.shift();
    if (this.taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < this.taps.length; i++) sum += this.taps[i] - this.taps[i - 1];
      this.beatLen = sum / (this.taps.length - 1) / 1000;
      this.bpm = Math.round((60 / this.beatLen) * 10) / 10;
    }
    this.accum = Math.round(this.accum); // snap the downbeat to this tap
  }

  // Set BPM directly (numeric input). Aligns the downbeat to now.
  set(bpm: number) {
    if (!(bpm > 0)) return;
    this.bpm = Math.round(bpm * 10) / 10;
    this.beatLen = 60 / this.bpm;
    this.accum = Math.round(this.accum);
    this.taps = [];
  }

  // Change tempo WITHOUT touching the phase — for auto-BPM follow. Because accum
  // is integrated per frame, this is seamless (no jump, no jitter).
  setRate(bpm: number) {
    if (!(bpm > 0)) return;
    this.bpm = Math.round(bpm * 10) / 10;
    this.beatLen = 60 / this.bpm;
  }

  // Re-align the downbeat to now without changing tempo (a "sync" nudge).
  resync() {
    this.accum = Math.round(this.accum);
  }
}
