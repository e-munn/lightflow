'use client';

/**
 * MIDI control panel — floating in the bottom-right when open.
 * Shows connection status, the four slot bindings (Strobe / Blackout /
 * Rate / Fade), and a live readout for each.
 *
 * To assign a control: click "Assign" next to a slot, then press the
 * physical pad/knob/fader on your controller. The first matching MIDI
 * event binds it and persists to localStorage.
 */

import type { ControlSlot, MidiBinding, MidiState } from '@/hooks/useMidi';

interface Props extends MidiState {
  startLearning: (slot: ControlSlot) => void;
  clearBinding: (slot: ControlSlot) => void;
  open: boolean;
  onToggle: () => void;
}


function bindingLabel(b: MidiBinding | undefined): string {
  if (!b) return 'unassigned';
  const t = b.kind === 'note' ? 'NOTE' : 'CC';
  return `${t} ${b.key} · ch${b.channel}`;
}

const SLOT_CONFIG: Array<{
  slot: ControlSlot;
  label: string;
  hint: string;
  kind: 'pad' | 'cc';
}> = [
  { slot: 'strobe',      label: 'STROBE',       hint: 'hold a pad',   kind: 'pad' },
  { slot: 'blackout',    label: 'BLACKOUT',     hint: 'hold a pad',   kind: 'pad' },
  { slot: 'pulse',       label: 'PULSE',        hint: 'tap a pad',    kind: 'pad' },
  { slot: 'strobeRate',  label: 'STROBE RATE',  hint: 'twist a knob', kind: 'cc'  },
  { slot: 'pulseLength', label: 'PULSE LENGTH', hint: 'twist a knob', kind: 'cc'  },
  { slot: 'fade',        label: 'FADE',         hint: 'move a fader', kind: 'cc'  },
];

function formatBeatFraction(b: number): string {
  if (b >= 1) return `${b} beat${b === 1 ? '' : 's'}`;
  const denom = Math.round(1 / b);
  return `1/${denom}`;
}

export function MidiPanel({
  supported,
  connected,
  devices,
  learning,
  mapping,
  strobeHeld,
  blackoutHeld,
  strobeRate,
  fade,
  pulseLengthBeats,
  lastEvent,
  startLearning,
  clearBinding,
  open,
  onToggle,
}: Props) {
  const liveFor = (slot: ControlSlot) => {
    switch (slot) {
      case 'strobe':      return strobeHeld   ? 'HELD' : '';
      case 'blackout':    return blackoutHeld ? 'HELD' : '';
      case 'pulse':       return '';
      case 'strobeRate':  return `${strobeRate}/beat`;
      case 'pulseLength': return formatBeatFraction(pulseLengthBeats);
      case 'fade':        return `${Math.round(fade * 100)}%`;
    }
  };

  return (
    <>
      {/* Toggle button — lives bottom-right */}
      <button
        onClick={onToggle}
        className={`fixed bottom-3 right-3 z-40 text-[10px] uppercase tracking-widest px-2.5 py-1 rounded-full border font-mono ${
          supported && connected
            ? 'border-green-400 bg-green-900/40 text-green-300'
            : supported
              ? 'border-yellow-500 bg-yellow-950/40 text-yellow-400'
              : 'border-red-700 bg-red-950/40 text-red-400'
        }`}
        title={
          !supported ? 'Web MIDI not supported in this browser'
          : connected ? 'MIDI connected'
          : 'MIDI permission pending'
        }
      >
        MIDI {connected ? '·' : '—'} {devices.length}
      </button>

      {open && (
        <div className="fixed bottom-14 right-3 z-40 w-[min(360px,calc(100vw-24px))] rounded-lg bg-black/90 backdrop-blur-md border border-white/15 text-white text-xs shadow-2xl">
          <div className="sticky top-0 bg-black/95 border-b border-white/10 px-3 py-2 flex items-center justify-between">
            <span className="font-medium text-white/80 uppercase tracking-wider text-[11px]">
              MIDI Control
            </span>
            <button
              onClick={onToggle}
              className="text-white/40 hover:text-white text-[10px] uppercase tracking-wider"
            >
              close
            </button>
          </div>

          <div className="p-3 space-y-3">
            {!supported && (
              <div className="text-red-400 text-[11px] leading-snug">
                Web MIDI isn&rsquo;t supported in this browser. Use Chrome,
                Edge, or Arc for MIDI input.
              </div>
            )}

            {supported && (
              <>
                <div>
                  <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">
                    Devices
                  </div>
                  {devices.length === 0 ? (
                    <div className="text-white/40 italic text-[11px]">
                      {connected ? 'no input devices detected' : 'connecting…'}
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {devices.map((d) => (
                        <li key={d.id} className="text-white/80 text-[11px] truncate">
                          · {d.name}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <div className="text-[9px] uppercase tracking-widest text-white/40 mb-1">
                    Mapping
                  </div>
                  <ul className="space-y-1">
                    {SLOT_CONFIG.map(({ slot, label, hint }) => {
                      const isLearning = learning === slot;
                      const live = liveFor(slot);
                      const active = live === 'HELD';
                      return (
                        <li
                          key={slot}
                          className={`flex items-center gap-2 px-2 py-1.5 rounded border ${
                            active
                              ? 'border-purple-400 bg-purple-900/40'
                              : isLearning
                                ? 'border-yellow-400 bg-yellow-950/40 animate-pulse'
                                : 'border-white/10 bg-black/30'
                          }`}
                        >
                          <span className="font-medium w-16 text-white">
                            {label}
                          </span>
                          <span className="flex-1 text-[10px] font-mono text-white/50 truncate">
                            {isLearning ? `press a ${hint}…` : bindingLabel(mapping[slot])}
                          </span>
                          {live && !isLearning && (
                            <span className={`text-[10px] font-mono ${active ? 'text-white' : 'text-white/60'}`}>
                              {live}
                            </span>
                          )}
                          <button
                            onClick={() => startLearning(slot)}
                            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
                              isLearning
                                ? 'border-yellow-400 text-yellow-300'
                                : 'border-white/15 text-white/60 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {isLearning ? 'cancel' : mapping[slot] ? 'remap' : 'assign'}
                          </button>
                          {mapping[slot] && !isLearning && (
                            <button
                              onClick={() => clearBinding(slot)}
                              className="text-[10px] uppercase tracking-wider px-1 text-white/40 hover:text-red-300"
                              title="Clear binding"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {lastEvent && (
                  <div className="text-[10px] font-mono text-white/40">
                    last: {lastEvent.kind} {lastEvent.key} v{lastEvent.value} ch{lastEvent.channel}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
