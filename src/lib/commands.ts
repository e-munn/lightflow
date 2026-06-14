// Single registry of commands — the source of truth for BOTH the on-screen
// keyboard map and the Cmd+Space palette. Each command has a keycap, a small
// caption, and a typed action the console dispatches.

import { SCENES } from './scenes';
import { COLOR_KEYS } from './fixtures';

export type Action =
  | { kind: 'scene'; key: string }
  | { kind: 'color'; color: string }
  | { kind: 'colorClear' }
  | { kind: 'tap' }
  | { kind: 'strobe' }
  | { kind: 'pulse' } // momentary one-tap swell (not a toggle)
  | { kind: 'mic' }
  | { kind: 'autopilot' }
  | { kind: 'autoBias'; dir: number } // ↑ more intense / ↓ less intense
  | { kind: 'blackout' }
  | { kind: 'toggleLive' };

export interface Command {
  id: string;
  cap: string; // keycap label
  eventKey: string; // normalized KeyboardEvent.key (lowercased; ' ' for space)
  label: string; // palette title
  caption: string; // small text under the key
  group: 'Scenes' | 'Color' | 'Transport' | 'System';
  action: Action;
  accent?: string; // css colour for the keycap (colour keys -> coloured dot)
  icon?: string; // lucide-react icon name (rendered on the keyboard map)
  level?: number; // 0..1 energy — scenes render a growth glyph from this
}

// lucide icon per scene id. 1-3 isolation · 4-7 ramp · 8-0 max.
const SCENE_ICONS: Record<string, string> = {
  halo: 'Sunrise', // 1 — halo solo (warm wash)
  spots: 'Disc', // 2 — spots solo (moving beams)
  shockers: 'Flame', // 3 — shockers solo (panel blaze)
  rise: 'TrendingUp', // 4 — ramp begins
  surge: 'Sunset', // 5
  drive: 'Snowflake', // 6 — cool, driving
  pulse: 'Activity', // 7 — rhythmic top of ramp
  peak: 'Mountain', // 8 — max + strobe
  blinder: 'Sun', // 9 — max + strobe
  party: 'PartyPopper', // 0 — max + strobe
};

const sceneCmds: Command[] = SCENES.map((s) => ({
  id: `scene-${s.id}`,
  cap: s.key,
  eventKey: s.key.toLowerCase(),
  label: s.name,
  caption: 'scene',
  group: 'Scenes',
  action: { kind: 'scene', key: s.key },
  icon: SCENE_ICONS[s.id] ?? 'Disc',
  level: s.energy,
}));

const colorCmds: Command[] = Object.entries(COLOR_KEYS).map(([k, c]) => ({
  id: `color-${k}`,
  cap: k.toUpperCase(),
  eventKey: k,
  label: c.name,
  caption: 'color',
  group: 'Color',
  action: { kind: 'color', color: k },
  accent: `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})`,
}));

const otherCmds: Command[] = [
  { id: 'tap', cap: 'T', eventKey: 't', label: 'Tap Tempo', caption: 'tap beat', group: 'Transport', action: { kind: 'tap' }, icon: 'Music' },
  { id: 'strobe', cap: 'S', eventKey: 's', label: 'Strobe', caption: 'strobe', group: 'Transport', action: { kind: 'strobe' }, icon: 'Zap' },
  { id: 'pulse', cap: 'P', eventKey: 'p', label: 'Pulse', caption: 'pulse', group: 'Transport', action: { kind: 'pulse' }, icon: 'Waves' },
  { id: 'mic', cap: 'M', eventKey: 'm', label: 'Mic Reactive', caption: 'mic react', group: 'System', action: { kind: 'mic' }, icon: 'Mic' },
  { id: 'autopilot', cap: 'A', eventKey: 'a', label: 'AutoPilot', caption: 'auto show', group: 'System', action: { kind: 'autopilot' }, icon: 'Bot' },
  { id: 'blackout', cap: 'Space', eventKey: ' ', label: 'Blackout', caption: 'all off', group: 'Transport', action: { kind: 'blackout' }, icon: 'Power' },
  { id: 'colorClear', cap: 'X', eventKey: 'x', label: 'Clear Color', caption: 'clear override', group: 'Color', action: { kind: 'colorClear' }, icon: 'Eraser' },
];

export const COMMANDS: Command[] = [...sceneCmds, ...colorCmds, ...otherCmds];
export const COMMAND_BY_KEY: Record<string, Command> = Object.fromEntries(COMMANDS.map((c) => [c.eventKey, c]));
