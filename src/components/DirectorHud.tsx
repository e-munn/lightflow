'use client';

/**
 * Claude Director HUD — display-only panel showing:
 *  - overall style + arc narrative
 *  - per-section plan + Claude's intent override
 *  - upcoming hit cues (highlighted when firing)
 *  - warnings Claude raised
 *
 * Non-blocking: fetched in parallel with song analysis. Does not drive
 * playback yet — that's gated behind the engine adapter wiring in a
 * follow-up (src/lib/director/engineAdapter.ts is ready for it).
 */

import { useMemo, useState } from 'react';
import { Sparkles, Copy, Check, ChevronDown } from 'lucide-react';
import type { ShowPlan, HitCue } from '@/lib/director/schema';

function planToMarkdown(plan: ShowPlan): string {
  const fmt = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };
  const lines: string[] = [];
  lines.push(`# ${plan.song}`);
  lines.push('');
  lines.push(`**Style:** ${plan.style}`);
  lines.push(`**BPM:** ${plan.bpm}`);
  lines.push(`**Director version:** ${plan.directorVersion}`);
  lines.push('');
  lines.push('## Arc');
  lines.push(plan.arc);
  lines.push('');
  if (plan.claudeWarnings.length) {
    lines.push('## Warnings');
    for (const w of plan.claudeWarnings) lines.push(`- ${w}`);
    lines.push('');
  }
  lines.push('## Sections');
  plan.sections.forEach((s, i) => {
    lines.push(
      `${i + 1}. **${s.sectionLabel}** [${fmt(s.start)}–${fmt(s.end)}] · focus: ${s.focusStem} · mod: ${s.modulator}`,
    );
    lines.push(`   - ${s.intent}`);
    if (s.effects.length) {
      lines.push(
        `   - effects: ${s.effects.map((e) => e.effect).join(', ')}`,
      );
    }
  });
  lines.push('');
  if (plan.hitCues.length) {
    lines.push('## Hit cues');
    for (const c of plan.hitCues) {
      lines.push(
        `- ${fmt(c.t)} · **${c.label}** → ${c.effect.effect} (intensity ${c.effect.intensity.toFixed(2)}, ${c.duration.toFixed(2)}s)`,
      );
    }
  }
  return lines.join('\n');
}

interface Props {
  plan: ShowPlan | null;
  status: 'idle' | 'loading' | 'streaming' | 'ready' | 'error';
  error: string | null;
  currentTime: number;
  open: boolean;
  onToggle: () => void;
  /** Whether playback is currently driven by Claude's plan. */
  useClaudePlan: boolean;
  onToggleUseClaudePlan: () => void;
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function colorCss(c: { r: number; g: number; b: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

export function DirectorHud({
  plan,
  status,
  error,
  currentTime,
  open,
  onToggle,
  useClaudePlan,
  onToggleUseClaudePlan,
}: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(planToMarkdown(plan));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // noop
    }
  };
  const activeIndex = useMemo(() => {
    if (!plan) return -1;
    return plan.sections.findIndex(
      (s) => currentTime >= s.start && currentTime < s.end,
    );
  }, [plan, currentTime]);

  const upcomingCues = useMemo<HitCue[]>(() => {
    if (!plan) return [];
    return plan.hitCues
      .filter((c) => c.t >= currentTime - 0.5 && c.t <= currentTime + 10)
      .slice(0, 6);
  }, [plan, currentTime]);

  // The trigger is now the DirectorBadge exported below (mounted in the
  // top bar next to the song title). This component only renders the panel.
  return (
    <>
      {open && (
        <div className="fixed top-16 left-3 z-40 w-[min(420px,calc(100vw-24px))] max-h-[70vh] overflow-y-auto rounded-lg bg-black/90 backdrop-blur-md border border-purple-700/40 text-white text-xs shadow-2xl">
          <div className="sticky top-0 bg-black/95 border-b border-purple-800/50 px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-purple-300" />
              <span className="font-medium text-purple-200">Claude Director</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={copy}
                disabled={!plan}
                className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border border-purple-700 text-purple-300 hover:bg-purple-900/50 disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                title="Copy director results as markdown"
              >
                {copied ? <Check size={10} /> : <Copy size={10} />}
                {copied ? 'copied' : 'copy'}
              </button>
              <button
                onClick={onToggleUseClaudePlan}
                disabled={!plan}
                className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                  useClaudePlan
                    ? 'bg-purple-500 border-purple-300 text-white'
                    : 'border-purple-700 text-purple-300 hover:bg-purple-900/50'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
                title={
                  plan
                    ? useClaudePlan
                      ? 'Playback is using Claude\u2019s plan. Click to switch back to engine.'
                      : 'Click to drive playback from Claude\u2019s plan'
                    : 'No plan loaded yet'
                }
              >
                {useClaudePlan ? 'claude on' : 'claude off'}
              </button>
              <button
                onClick={onToggle}
                className="text-purple-400 hover:text-white text-[10px] uppercase tracking-wider"
              >
                close
              </button>
            </div>
          </div>

          <div className="p-3 space-y-3">
            {status === 'loading' && (
              <div className="text-purple-300 italic">
                Reading stems, drafting plan…
              </div>
            )}

            {status === 'streaming' && !plan && (
              <div className="text-purple-300 italic">
                Claude is thinking — sections will stream in…
              </div>
            )}

            {status === 'error' && (
              <div className="text-red-400">
                Error: {error ?? 'unknown'}
              </div>
            )}

            {(status === 'ready' || status === 'streaming') && plan && (
              <>
                {/* Arc */}
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-purple-400 mb-1">
                    Arc
                  </div>
                  <div className="text-purple-100 italic leading-snug">
                    {plan.arc}
                  </div>
                </div>

                {error && (
                  <div className="text-yellow-400 text-[10px]">
                    {error}
                  </div>
                )}

                {/* Warnings */}
                {plan.claudeWarnings.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-amber-400 mb-1">
                      Warnings
                    </div>
                    <ul className="space-y-0.5 text-amber-200">
                      {plan.claudeWarnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Hit cues upcoming */}
                {upcomingCues.length > 0 && (
                  <div>
                    <div className="text-[9px] uppercase tracking-widest text-purple-400 mb-1">
                      Upcoming hits
                    </div>
                    <ul className="space-y-0.5">
                      {upcomingCues.map((cue, i) => {
                        const dt = cue.t - currentTime;
                        const firing = dt >= -cue.duration && dt <= 0.1;
                        return (
                          <li
                            key={i}
                            className={`flex items-center gap-2 ${
                              firing ? 'text-white font-medium' : 'text-purple-200'
                            }`}
                          >
                            <span
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: colorCss(cue.effect.color) }}
                            />
                            <span className="tabular-nums w-10">{fmt(cue.t)}</span>
                            <span className="truncate">
                              {cue.label} · {cue.effect.effect}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {/* Sections */}
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-purple-400 mb-1">
                    Sections
                  </div>
                  <ul className="space-y-1.5">
                    {plan.sections.map((s, i) => {
                      const active = i === activeIndex;
                      return (
                        <li
                          key={i}
                          className={`rounded border px-2 py-1.5 ${
                            active
                              ? 'border-purple-400 bg-purple-900/40'
                              : 'border-purple-900/40 bg-black/30'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-purple-100">
                              {s.sectionLabel}
                            </span>
                            <span className="tabular-nums text-purple-400 text-[10px]">
                              {fmt(s.start)}–{fmt(s.end)}
                            </span>
                          </div>
                          <div className="text-purple-300 leading-snug mt-0.5 text-[11px]">
                            {s.intent}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                            <span className="text-[9px] uppercase tracking-wider text-purple-500">
                              {s.focusStem}
                            </span>
                            <span className="text-[9px] text-purple-600">·</span>
                            <span className="text-[9px] text-purple-500">
                              {s.modulator}
                            </span>
                            {s.effects.slice(0, 4).map((e, j) => (
                              <span
                                key={j}
                                className="text-[9px] px-1 py-0.5 rounded bg-purple-950 text-purple-300"
                                style={{
                                  borderLeft: `2px solid ${colorCss(e.color)}`,
                                }}
                              >
                                {e.effect}
                              </span>
                            ))}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// DirectorBadge — small pill mounted in the top bar next to the song title.
// Shows live status and opens the HUD panel when clicked.
// ---------------------------------------------------------------------------

interface BadgeProps {
  plan: ShowPlan | null;
  status: Props['status'];
  live: boolean;
  onOpenPanel: () => void;
  onToggleLive: () => void;
}

/**
 * Compound pill with two click zones:
 *   - main button (icon + label): toggles Claude live on/off
 *   - chevron button: opens the HUD details panel
 *
 * Color rule: main zone is purple ONLY when Claude is actively driving
 * the signal. Gray otherwise — because the engine is in charge.
 */
export function DirectorBadge({
  plan,
  status,
  live,
  onOpenPanel,
  onToggleLive,
}: BadgeProps) {
  const canToggle = !!plan;

  const label = (() => {
    if (live) return 'LIVE';
    if (status === 'idle') return 'Director';
    if (status === 'loading') return 'reading…';
    if (status === 'streaming') {
      if (!plan) return 'thinking…';
      return `${plan.sections.length}·${plan.hitCues.length} ✎`;
    }
    if (status === 'ready') return plan?.style ?? 'ready';
    if (status === 'error') return 'error';
    return 'Director';
  })();

  const toggleTone = live
    ? 'border-purple-400 bg-purple-600/70 text-white hover:bg-purple-500/80'
    : status === 'error'
      ? 'border-red-800 bg-red-950/60 text-red-300'
      : status === 'streaming' || status === 'loading'
        ? 'border-white/15 bg-white/[0.04] text-white/60 animate-pulse'
        : canToggle
          ? 'border-white/15 bg-black/40 text-white/55 hover:bg-white/10 hover:text-white/80'
          : 'border-white/10 bg-black/30 text-white/35 cursor-not-allowed';

  return (
    <div className="flex items-stretch rounded-full border border-white/10 shrink-0 overflow-hidden">
      <button
        type="button"
        onClick={onToggleLive}
        disabled={!canToggle}
        className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-medium border-r ${toggleTone}`}
        title={
          canToggle
            ? live
              ? 'Click to stop Claude driving the scene'
              : 'Click to let Claude drive the scene'
            : 'No plan yet'
        }
      >
        <Sparkles size={9} className="shrink-0" />
        <span className="truncate max-w-[90px]">{label}</span>
      </button>
      <button
        type="button"
        onClick={onOpenPanel}
        className="flex items-center px-1 text-white/40 hover:text-white/80 hover:bg-white/5"
        title="Open director details"
      >
        <ChevronDown size={9} />
      </button>
    </div>
  );
}
