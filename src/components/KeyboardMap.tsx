'use client';

// Keyboard map — minimalist, faint, wide. Each bound key shows its letter and a
// lucide icon for its action (colour keys show a tinted dot instead). Active
// keys invert to crisp white. Clicking a cap fires its action.

import {
  Flame, Sunset, Sunrise, Snowflake, TrendingUp, Palette, Activity, Mountain, Sun, PartyPopper,
  Music, Zap, Mic, Power, Eraser, Radio, Disc, Bot, Waves, type LucideIcon,
} from 'lucide-react';
import { Action, COMMAND_BY_KEY } from '@/lib/commands';

const ICONS: Record<string, LucideIcon> = {
  Flame, Sunset, Sunrise, Snowflake, TrendingUp, Palette, Activity, Mountain, Sun, PartyPopper,
  Music, Zap, Mic, Power, Eraser, Radio, Disc, Bot, Waves,
};

// The number row maps to the 10 scenes (1-0); it's grouped under a "scenes"
// label, separate from the letter/transport rows below.
const SCENE_ROW = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const ROWS: string[][] = [
  ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
  ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
];

const keyOf = (cap: string) => (cap === 'Space' ? ' ' : cap.toLowerCase());

// Growth glyph for scene keys: 5 dots growing left→right, lit up to the scene's
// energy level. Reads as a low→high ramp across the number row. Uses
// currentColor so it inverts cleanly when the key is active.
function LevelDots({ level }: { level: number }) {
  const N = 5;
  const lit = Math.max(1, Math.round(level * N));
  return (
    <svg width="26" height="8" viewBox="0 0 26 8">
      {Array.from({ length: N }).map((_, i) => (
        <circle key={i} cx={3 + i * 5} cy={4} r={1 + (i / (N - 1)) * 1.3} fill="currentColor" fillOpacity={i < lit ? 1 : 0.22} />
      ))}
    </svg>
  );
}

export function KeyboardMap({ activeKeys, onAction }: { activeKeys: Set<string>; onAction: (a: Action) => void }) {
  const renderCap = (cap: string) => {
    const cmd = COMMAND_BY_KEY[keyOf(cap)];

    if (!cmd) {
      return (
        <div
          key={cap}
          className="flex h-10 w-14 items-center justify-center rounded-[5px] border border-white/[0.04] font-mono text-[11px] text-white/15"
        >
          {cap}
        </div>
      );
    }
    const active = activeKeys.has(cmd.eventKey);
    const Icon = cmd.icon ? ICONS[cmd.icon] : undefined;
    return (
      <button
        key={cap}
        onClick={() => onAction(cmd.action)}
        title={cmd.label}
        className={`flex h-10 w-14 flex-col items-center justify-center gap-1 rounded-[5px] border transition-colors ${
          active ? 'border-white bg-white text-black' : 'border-white/10 text-white/70 hover:border-white/30'
        }`}
      >
        <span className="font-mono text-[13px] font-medium leading-none opacity-80">{cap}</span>
        {cmd.accent ? (
          <span className="h-2 w-2 rounded-full border border-black/25" style={{ background: cmd.accent }} />
        ) : cmd.action.kind === 'scene' && cmd.level != null ? (
          <LevelDots level={cmd.level} />
        ) : Icon ? (
          <Icon size={13} strokeWidth={1.75} />
        ) : (
          <span className="text-[8px] uppercase leading-none tracking-[0.1em] text-white/30">{cmd.caption}</span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col items-center gap-1 px-4 py-1">
      {/* scenes — the number row (1-0), grouped with the label to its left */}
      <div className="flex items-center gap-2.5 rounded-md border border-white/[0.06] px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.15em] text-white/30">scenes</span>
        <div className="flex gap-1">{SCENE_ROW.map(renderCap)}</div>
      </div>
      {ROWS.map((row, ri) => (
        <div key={ri} className="flex gap-1">
          {row.map(renderCap)}
        </div>
      ))}
    </div>
  );
}
