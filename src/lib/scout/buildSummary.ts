import type { AnalysisResult, Section } from '@/types/v3';

interface SectionStats {
  meanBass: number;
  meanKick: number;
  meanSnare: number;
  meanHat: number;
  meanVocals: number;
  meanOther: number;
  meanCentroid: number;
  meanSpectralFlux: number;
  variance: number;
  bassSustainFraction: number;
  drumActivityFraction: number;
}

interface ScoutSectionSummary {
  index: number;
  start: number;
  end: number;
  label: string;
  energyLevel: number;
  bassPresence: number;
  hasVocals: boolean;
  stats: SectionStats;
  energyDelta: number;
}

interface DetectedEvent {
  t: number;
  type: string;
  confidence: number;
}

export interface ScoutSummary {
  song: string;
  duration: number;
  bpm: number;
  bpmConfidence: number;
  patterns: {
    fourOnFloor: boolean;
    backbeat: boolean;
    hatRate: string;
    syncopation: number;
  };
  sections: ScoutSectionSummary[];
  events: DetectedEvent[];
}

function computeSectionStats(
  frames: AnalysisResult['frames'],
  start: number,
  end: number,
): SectionStats {
  const slice = frames.filter(f => f.time >= start && f.time < end);
  if (slice.length === 0) {
    return {
      meanBass: 0, meanKick: 0, meanSnare: 0, meanHat: 0,
      meanVocals: 0, meanOther: 0, meanCentroid: 0, meanSpectralFlux: 0,
      variance: 0, bassSustainFraction: 0, drumActivityFraction: 0,
    };
  }

  const stems = (s: string) => slice.reduce((sum, f) => {
    const st = f.stems as unknown as Record<string, number>;
    return sum + (st[s] ?? 0);
  }, 0) / slice.length;

  const meanBass = stems('bass');
  const meanKick = stems('kick');
  const meanSnare = stems('snare');
  const meanHat = stems('hat');
  const meanVocals = stems('vocals');
  const meanOther = stems('other');
  const meanCentroid = slice.reduce((s, f) => s + (f.centroid ?? 0), 0) / slice.length;
  const meanSpectralFlux = slice.reduce((s, f) => s + (f.spectral_flux ?? 0), 0) / slice.length;

  const totals = slice.map(f => {
    const st = f.stems as unknown as Record<string, number>;
    return Math.max(st.kick ?? 0, st.snare ?? 0, st.bass ?? 0, st.hat ?? 0);
  });
  const totalMean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((s, v) => s + Math.abs(v - totalMean), 0) / totals.length;

  const bassSustainFraction = slice.filter(f => {
    const st = f.stems as unknown as Record<string, number>;
    return (st.bass ?? 0) > 0.45;
  }).length / slice.length;

  const drumActivityFraction = slice.filter(f => {
    const st = f.stems as unknown as Record<string, number>;
    return Math.max(st.kick ?? 0, st.snare ?? 0, st.hat ?? 0) > 0.3;
  }).length / slice.length;

  return {
    meanBass: +meanBass.toFixed(3),
    meanKick: +meanKick.toFixed(3),
    meanSnare: +meanSnare.toFixed(3),
    meanHat: +meanHat.toFixed(3),
    meanVocals: +meanVocals.toFixed(3),
    meanOther: +meanOther.toFixed(3),
    meanCentroid: +meanCentroid.toFixed(0),
    meanSpectralFlux: +meanSpectralFlux.toFixed(3),
    variance: +variance.toFixed(3),
    bassSustainFraction: +bassSustainFraction.toFixed(2),
    drumActivityFraction: +drumActivityFraction.toFixed(2),
  };
}

function nearestBeat(t: number, bpm: number): number {
  const beatSec = 60 / bpm;
  return Math.round(t / beatSec) * beatSec;
}

function detectEvents(analysis: AnalysisResult): DetectedEvent[] {
  const events: DetectedEvent[] = [];
  const frames = analysis.frames;
  const fps = analysis.fps;
  const bpm = analysis.bpm;

  // Drop candidates: low bass/kick → sharp rise
  // Step every ~100ms (3 frames at 30fps) for tighter timing
  const lookback = fps;
  const forward = fps;
  for (let i = lookback; i < frames.length - forward; i += Math.max(1, Math.floor(fps / 10))) {
    const prevWin = frames.slice(i - lookback, i);
    const nextWin = frames.slice(i, i + forward);
    const prevLow = prevWin.reduce((s, f) => {
      const st = f.stems as unknown as Record<string, number>;
      return s + Math.max(st.bass ?? 0, st.kick ?? 0);
    }, 0) / prevWin.length;
    const nextHigh = nextWin.reduce((s, f) => {
      const st = f.stems as unknown as Record<string, number>;
      return s + Math.max(st.bass ?? 0, st.kick ?? 0);
    }, 0) / nextWin.length;
    const vocalsNext = nextWin.reduce((s, f) => {
      const st = f.stems as unknown as Record<string, number>;
      return s + (st.vocals ?? 0);
    }, 0) / nextWin.length;

    if (nextHigh - prevLow > 0.35 && nextHigh > 0.5 && vocalsNext < 0.3) {
      events.push({
        t: +nearestBeat(frames[i].time, bpm).toFixed(2),
        type: 'drop_candidate',
        confidence: +Math.min(1, (nextHigh - prevLow) * 1.5).toFixed(2),
      });
    }
    if (prevLow - nextHigh > 0.35 && prevLow > 0.5) {
      events.push({
        t: +frames[i].time.toFixed(2),
        type: 'breakdown_start',
        confidence: +Math.min(1, (prevLow - nextHigh) * 1.5).toFixed(2),
      });
    }
  }

  // Vocal entry/exit
  let vocalOn = false;
  const window = fps;
  for (let i = window; i < frames.length; i += Math.max(1, Math.floor(fps / 10))) {
    let sum = 0;
    for (let j = i - window; j < i; j++) {
      const st = frames[j].stems as unknown as Record<string, number>;
      sum += st.vocals ?? 0;
    }
    const mean = sum / window;
    if (!vocalOn && mean > 0.25) {
      vocalOn = true;
      events.push({ t: +frames[i].time.toFixed(2), type: 'vocal_entry', confidence: 0.8 });
    } else if (vocalOn && mean < 0.08) {
      vocalOn = false;
      events.push({ t: +frames[i].time.toFixed(2), type: 'vocal_exit', confidence: 0.8 });
    }
  }

  // Big transients
  for (let i = 5; i < frames.length - 1; i++) {
    const cur = frames[i].spectral_flux ?? 0;
    let prevSum = 0;
    for (let j = i - 5; j < i; j++) prevSum += frames[j].spectral_flux ?? 0;
    const prevMean = prevSum / 5;
    if (cur > 1.5 && cur > prevMean * 2.5) {
      events.push({
        t: +frames[i].time.toFixed(2),
        type: 'big_transient',
        confidence: +Math.min(1, (cur - prevMean) / 2).toFixed(2),
      });
    }
  }

  // Stem entry detection — when a stem goes from absent to present.
  // Uses a 2-second sliding window: if the previous window's mean is
  // near-zero and the next window's mean is above threshold, that stem
  // just entered the arrangement.
  const ENTRY_STEMS = ['bass', 'kick', 'snare', 'hat', 'other', 'vocals'];
  const entryWindow = fps * 2;
  const entryStep = Math.max(1, Math.floor(fps / 5));
  for (const stem of ENTRY_STEMS) {
    let lastEntryTime = -10;
    for (let i = entryWindow; i < frames.length - entryWindow; i += entryStep) {
      let prevSum = 0, nextSum = 0;
      for (let j = i - entryWindow; j < i; j++) {
        const st = frames[j].stems as unknown as Record<string, number>;
        prevSum += st[stem] ?? 0;
      }
      for (let j = i; j < i + entryWindow; j++) {
        const st = frames[j].stems as unknown as Record<string, number>;
        nextSum += st[stem] ?? 0;
      }
      const prevMean = prevSum / entryWindow;
      const nextMean = nextSum / entryWindow;
      if (prevMean < 0.05 && nextMean > 0.15 && frames[i].time - lastEntryTime > 5) {
        events.push({
          t: +nearestBeat(frames[i].time, bpm).toFixed(2),
          type: `stem_entry:${stem}`,
          confidence: +Math.min(1, (nextMean - prevMean) * 3).toFixed(2),
        });
        lastEntryTime = frames[i].time;
      }
    }
  }

  return events
    .filter(e => e.confidence >= 0.5)
    .sort((a, b) => a.t - b.t)
    .filter((e, i, arr) => i === 0 || e.t - arr[i - 1].t > 0.5 || e.type !== arr[i - 1].type)
    .slice(0, 60);
}

export function buildScoutSummary(analysis: AnalysisResult): ScoutSummary {
  const sectionSummaries: ScoutSectionSummary[] = analysis.sections.map((sec, i) => {
    const stats = computeSectionStats(analysis.frames, sec.start, sec.end);
    const prevStats = i > 0
      ? computeSectionStats(analysis.frames, analysis.sections[i - 1].start, analysis.sections[i - 1].end)
      : null;

    const prevTotalEnergy = prevStats
      ? (prevStats.meanBass + prevStats.meanKick + prevStats.meanSnare + prevStats.meanHat + prevStats.meanVocals + prevStats.meanOther)
      : 0;
    const curTotalEnergy = stats.meanBass + stats.meanKick + stats.meanSnare + stats.meanHat + stats.meanVocals + stats.meanOther;
    const energyDelta = prevStats ? +(curTotalEnergy - prevTotalEnergy).toFixed(3) : 0;

    return {
      index: i,
      start: sec.start,
      end: sec.end,
      label: sec.label,
      energyLevel: sec.energy_level,
      bassPresence: sec.bass_presence,
      hasVocals: sec.has_vocals,
      stats,
      energyDelta,
    };
  });

  const patterns = analysis.patterns;

  return {
    song: analysis.song,
    duration: analysis.duration,
    bpm: analysis.bpm,
    bpmConfidence: analysis.bpm_confidence,
    patterns: {
      fourOnFloor: patterns.four_on_floor,
      backbeat: patterns.backbeat,
      hatRate: patterns.hat_rate,
      syncopation: patterns.syncopation_level,
    },
    sections: sectionSummaries,
    events: detectEvents(analysis),
  };
}
