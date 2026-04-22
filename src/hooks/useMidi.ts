'use client';

/**
 * MiniLab 3 (or any MIDI controller) hook for the show recorder.
 *
 * Scope for v1:
 *   - STROBE pad (hold): momentary strobe override
 *   - BLACKOUT pad (hold): momentary dark override
 *   - RATE encoder: strobe rate in pulses/beat (1..16)
 *   - FADE fader: global brightness multiplier (0..1)
 *
 * Mapping is learned per-control: click "Assign" for a control, then
 * press/move the physical element. Persisted to localStorage. Works
 * with any MIDI controller — the Arturia default pad note numbers
 * will just come in via the normal learn flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isMidiSupported,
  listInputs,
  onAllMessages,
  requestMidi,
  type MidiEvent,
} from '@/lib/midi';

export type ControlSlot =
  | 'strobe'       // hold → hard pulse at strobeRate
  | 'blackout'     // hold → signal = 0
  | 'pulse'        // tap  → velocity-sensitive single-shot, duration from pulseLength
  | 'strobeRate'   // encoder 1..16 pulses/beat
  | 'pulseLength'  // encoder: beat fraction for pulse envelope
  | 'fade';        // fader 0..1

/** Discrete beat-fraction steps the PULSE LENGTH knob snaps to. */
export const PULSE_LENGTH_STEPS = [1/16, 1/8, 1/4, 1/2, 1, 2, 4] as const;

/** A single normalized show event — what gets persisted for training. */
export type ShowEvent =
  | { type: 'strobeOn' }
  | { type: 'strobeOff' }
  | { type: 'blackoutOn' }
  | { type: 'blackoutOff' }
  | { type: 'pulse'; velocity: number; lengthBeats: number }
  | { type: 'strobeRate'; value: number }
  | { type: 'pulseLength'; value: number }
  | { type: 'fade'; value: number };

/** How a physical MIDI control identifies itself on the wire. */
export interface MidiBinding {
  /** 'note' for pads, 'cc' for encoders/faders */
  kind: 'note' | 'cc';
  key: number;    // note number or CC number
  channel: number;
}

export type MidiMapping = Partial<Record<ControlSlot, MidiBinding>>;

export interface MidiState {
  supported: boolean;
  connected: boolean;
  devices: Array<{ id: string; name: string }>;
  /** Which slot is currently "listening" for the next MIDI event to bind */
  learning: ControlSlot | null;
  mapping: MidiMapping;
  // Live control state
  strobeHeld: boolean;
  blackoutHeld: boolean;
  /** 1..16 pulses/beat (default 8) */
  strobeRate: number;
  /** 0..1 brightness multiplier (default 1) */
  fade: number;
  /** performance.now timestamp of the last PULSE tap */
  lastPulseAt: number;
  /** Velocity of the last pulse, 0..1 */
  pulseVelocity: number;
  /** Beat-fraction length active when the last pulse fired. Captured at
   *  trigger time so late knob changes don't warp an in-flight pulse. */
  lastPulseLengthBeats: number;
  /** Currently-selected pulse length (beat fraction) */
  pulseLengthBeats: number;
  /** Last raw event — useful for a live readout in the UI */
  lastEvent: MidiEvent | null;
}

const STORAGE_KEY = 'lightflow:midiMapping';

function loadMapping(): MidiMapping {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MidiMapping;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function saveMapping(m: MidiMapping) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(m));
  } catch {
    // noop
  }
}

/** Match an event against a binding. noteOn/noteOff/cc with same key+channel. */
function matches(ev: MidiEvent, b: MidiBinding): boolean {
  if (ev.channel !== b.channel) return false;
  if (b.kind === 'note') return ev.kind === 'noteOn' || ev.kind === 'noteOff';
  return ev.kind === 'cc' && ev.key === b.key;
}

function bindingFromEvent(ev: MidiEvent): MidiBinding | null {
  if (ev.kind === 'noteOn' || ev.kind === 'noteOff') {
    return { kind: 'note', key: ev.key, channel: ev.channel };
  }
  if (ev.kind === 'cc') {
    return { kind: 'cc', key: ev.key, channel: ev.channel };
  }
  return null;
}

export interface UseMidiOptions {
  /** Fires for each user-meaningful show event (pad press, knob turn, etc.)
   *  Caller decides whether to buffer for recording. Use this for capturing
   *  performances; use the derived state (strobeHeld, etc.) for live render. */
  onShowEvent?: (event: ShowEvent) => void;
}

export function useMidi(options: UseMidiOptions = {}) {
  const emitRef = useRef<typeof options.onShowEvent>(options.onShowEvent);
  useEffect(() => { emitRef.current = options.onShowEvent; }, [options.onShowEvent]);
  const [supported] = useState(() => isMidiSupported());
  const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [connected, setConnected] = useState(false);
  const [mapping, setMapping] = useState<MidiMapping>(() => loadMapping());
  const [learning, setLearning] = useState<ControlSlot | null>(null);
  const [strobeHeld, setStrobeHeld] = useState(false);
  const [blackoutHeld, setBlackoutHeld] = useState(false);
  const [strobeRate, setStrobeRate] = useState(8);
  const [fade, setFade] = useState(1);
  const [lastPulseAt, setLastPulseAt] = useState(-Infinity);
  const [pulseVelocity, setPulseVelocity] = useState(0);
  const [lastPulseLengthBeats, setLastPulseLengthBeats] = useState(0.25);
  const [pulseLengthBeats, setPulseLengthBeats] = useState(0.25); // default 1/4 beat
  const [lastEvent, setLastEvent] = useState<MidiEvent | null>(null);

  // Stable references inside the MIDI callback so we don't have to
  // tear-down/rebuild the subscription on every state change.
  const mappingRef  = useRef(mapping);
  const learningRef = useRef<ControlSlot | null>(null);
  useEffect(() => { mappingRef.current = mapping; }, [mapping]);
  useEffect(() => { learningRef.current = learning; }, [learning]);

  const handleEvent = useCallback((ev: MidiEvent) => {
    setLastEvent(ev);

    // Learn mode: assign whichever control fired to the learning slot
    if (learningRef.current) {
      const binding = bindingFromEvent(ev);
      if (binding) {
        const slot = learningRef.current;
        const next: MidiMapping = { ...mappingRef.current, [slot]: binding };
        // Remove this binding from any other slot (can't share controls)
        for (const k of Object.keys(next) as ControlSlot[]) {
          if (k === slot) continue;
          const b = next[k];
          if (b && b.kind === binding.kind && b.key === binding.key && b.channel === binding.channel) {
            delete next[k];
          }
        }
        mappingRef.current = next;
        setMapping(next);
        saveMapping(next);
        setLearning(null);
      }
      return;
    }

    const m = mappingRef.current;

    const emit = emitRef.current;

    // STROBE pad — momentary hold
    if (m.strobe && matches(ev, m.strobe)) {
      if (ev.kind === 'noteOn')  { setStrobeHeld(true);  emit?.({ type: 'strobeOn' }); }
      if (ev.kind === 'noteOff') { setStrobeHeld(false); emit?.({ type: 'strobeOff' }); }
      return;
    }
    // BLACKOUT pad — momentary hold
    if (m.blackout && matches(ev, m.blackout)) {
      if (ev.kind === 'noteOn')  { setBlackoutHeld(true);  emit?.({ type: 'blackoutOn' }); }
      if (ev.kind === 'noteOff') { setBlackoutHeld(false); emit?.({ type: 'blackoutOff' }); }
      return;
    }
    // PULSE pad — velocity-sensitive single-shot envelope. Captures
    // current pulseLengthBeats at trigger time so an in-flight pulse
    // isn't warped by later knob moves.
    if (m.pulse && matches(ev, m.pulse)) {
      if (ev.kind === 'noteOn') {
        const velocity = Math.min(1, ev.value / 127);
        setLastPulseAt(performance.now());
        setPulseVelocity(velocity);
        setLastPulseLengthBeats(pulseLengthBeats);
        emit?.({ type: 'pulse', velocity, lengthBeats: pulseLengthBeats });
      }
      return;
    }
    // STROBE RATE encoder — maps CC 0..127 → 1..16 pulses/beat
    if (m.strobeRate && matches(ev, m.strobeRate)) {
      const value = 1 + Math.round((ev.value / 127) * 15);
      setStrobeRate(value);
      emit?.({ type: 'strobeRate', value });
      return;
    }
    // PULSE LENGTH encoder — snaps CC 0..127 to one of the discrete
    // beat-fraction steps [1/16, 1/8, 1/4, 1/2, 1, 2, 4]
    if (m.pulseLength && matches(ev, m.pulseLength)) {
      const idx = Math.min(
        PULSE_LENGTH_STEPS.length - 1,
        Math.floor((ev.value / 128) * PULSE_LENGTH_STEPS.length),
      );
      const value = PULSE_LENGTH_STEPS[idx];
      setPulseLengthBeats(value);
      emit?.({ type: 'pulseLength', value });
      return;
    }
    // FADE fader — CC 0..127 → 0..1
    if (m.fade && matches(ev, m.fade)) {
      const value = ev.value / 127;
      setFade(value);
      emit?.({ type: 'fade', value });
      return;
    }
  }, [pulseLengthBeats]);

  // Connect on first mount (after user gesture ideally — browsers vary).
  useEffect(() => {
    if (!supported) return;
    let unsub: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const access = await requestMidi();
        if (cancelled) return;
        setConnected(true);
        setDevices(listInputs(access));
        const updateDevices = () => setDevices(listInputs(access));
        access.addEventListener('statechange', updateDevices);
        unsub = onAllMessages(access, handleEvent);
      } catch (err) {
        console.warn('[midi] access denied or failed:', err);
        setConnected(false);
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [supported, handleEvent]);

  const startLearning = useCallback((slot: ControlSlot) => {
    setLearning((prev) => (prev === slot ? null : slot));
  }, []);

  const clearBinding = useCallback((slot: ControlSlot) => {
    setMapping((prev) => {
      const next = { ...prev };
      delete next[slot];
      saveMapping(next);
      return next;
    });
  }, []);

  const state: MidiState = useMemo(
    () => ({
      supported, connected, devices, learning, mapping,
      strobeHeld, blackoutHeld,
      strobeRate, fade,
      lastPulseAt, pulseVelocity, lastPulseLengthBeats, pulseLengthBeats,
      lastEvent,
    }),
    [supported, connected, devices, learning, mapping,
      strobeHeld, blackoutHeld,
      strobeRate, fade,
      lastPulseAt, pulseVelocity, lastPulseLengthBeats, pulseLengthBeats,
      lastEvent],
  );

  return {
    ...state,
    startLearning,
    clearBinding,
  };
}
