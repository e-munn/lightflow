// Live mic analysis. Works on a room mic (no clean line feed needed) because it
// reacts to relative dynamics, not absolute level. Produces per-frame energy +
// 3 bands for reactivity, onset detection, a best-effort BPM estimate, and a
// section-change flag. All of it is ASSISTIVE — manual tempo/scene control
// always overrides (see the page). Times in ms (performance.now()).

export interface AudioFrame {
  energy: number; // 0..1 smoothed overall loudness
  bass: number; // 0..1
  mid: number;
  high: number;
  onset: boolean; // transient detected this frame
  bpm: number | null; // best-effort estimate
  sectionChange: boolean; // sustained energy shift (verse->chorus, drop, etc.)
  build: number; // 0..1 rising-energy "tension" — heuristic, not clairvoyance
}

const EMPTY: AudioFrame = { energy: 0, bass: 0, mid: 0, high: 0, onset: false, bpm: null, sectionChange: false, build: 0 };

export class AudioReactor {
  running = false;
  bpm: number | null = null;

  private ctx?: AudioContext;
  private analyser?: AnalyserNode;
  private stream?: MediaStream;
  private freq?: Uint8Array<ArrayBuffer>;
  private prev?: Float32Array;
  private energySmooth = 0;
  private fluxSmooth = 0;
  private lastOnsetAt = 0;
  private onsets: number[] = [];
  private shortE = 0;
  private longE = 0;
  private lastSectionAt = 0;

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.attachAnalyser(src);
  }

  // Drive the SAME analysis off a playing audio file instead of the mic — lets
  // us test the whole live pipeline (reactive, AutoPilot) at the desk, no
  // hardware. The element's output is also routed to the speakers so you hear it.
  async startFromElement(el: HTMLMediaElement) {
    this.ctx = new AudioContext();
    await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaElementSource(el);
    this.attachAnalyser(src);
    src.connect(this.ctx.destination); // hear the file through the graph
  }

  private attachAnalyser(src: AudioNode) {
    const ctx = this.ctx!;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.4;
    src.connect(this.analyser);
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.running = true;
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.running = false;
  }

  update(now: number): AudioFrame {
    if (!this.analyser || !this.freq || !this.ctx) return { ...EMPTY, bpm: this.bpm };
    this.analyser.getByteFrequencyData(this.freq);
    const n = this.freq.length;
    const binHz = this.ctx.sampleRate / this.analyser.fftSize;

    const band = (lo: number, hi: number) => {
      let s = 0;
      let c = 0;
      for (let i = Math.max(1, Math.floor(lo / binHz)); i < Math.min(n, Math.ceil(hi / binHz)); i++) {
        s += this.freq![i];
        c++;
      }
      return c ? s / c / 255 : 0;
    };
    const bass = band(20, 200);
    const mid = band(200, 2000);
    const high = band(2000, 8000);

    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.freq[i];
    const energyRaw = sum / n / 255;
    this.energySmooth += (energyRaw - this.energySmooth) * 0.2;

    // spectral flux (positive changes) -> onset
    let flux = 0;
    if (this.prev) {
      for (let i = 0; i < n; i++) {
        const d = this.freq[i] - this.prev[i];
        if (d > 0) flux += d;
      }
      flux /= n * 255;
    }
    this.prev = Float32Array.from(this.freq);
    this.fluxSmooth += (flux - this.fluxSmooth) * 0.3;
    const onset = flux > this.fluxSmooth * 1.6 && flux > 0.008 && now - this.lastOnsetAt > 120;
    if (onset) {
      this.lastOnsetAt = now;
      this.pushOnset(now);
    }

    // section change: short vs long energy average
    this.shortE += (this.energySmooth - this.shortE) * 0.05;
    this.longE += (this.energySmooth - this.longE) * 0.004;
    let sectionChange = false;
    if (Math.abs(this.shortE - this.longE) > 0.1 && now - this.lastSectionAt > 4000) {
      sectionChange = true;
      this.lastSectionAt = now;
    }

    const build = Math.max(0, Math.min(1, (this.shortE - this.longE) * 4)); // rising energy = tension
    return { energy: this.energySmooth, bass, mid, high, onset, bpm: this.bpm, sectionChange, build };
  }

  private pushOnset(now: number) {
    this.onsets.push(now);
    if (this.onsets.length > 16) this.onsets.shift();
    if (this.onsets.length < 5) return;
    const iv: number[] = [];
    for (let i = 1; i < this.onsets.length; i++) iv.push(this.onsets[i] - this.onsets[i - 1]);
    iv.sort((a, b) => a - b);
    const med = iv[Math.floor(iv.length / 2)];
    if (!(med > 0)) return;
    let bpm = 60000 / med;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    this.bpm = this.bpm ? Math.round((this.bpm * 0.6 + bpm * 0.4) * 10) / 10 : Math.round(bpm * 10) / 10;
  }
}
