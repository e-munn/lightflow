'use client';

// Phone-as-remote over Bluetooth MIDI. The phone (a BLE-MIDI pad app) pairs to
// the Mac in Audio MIDI Setup; its note messages arrive here via Web MIDI and
// map to the SAME command Actions as the keyboard. No WiFi involved.
//
// Each incoming note maps to a command's eventKey (e.g. note 36 -> '1' -> scene
// 1). A default note map covers everything; `arm(eventKey)` rebinds the next
// pad you press (MIDI-learn), persisted to localStorage. Web MIDI is
// Chromium-only — Safari/Firefox report unsupported.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isMidiSupported, listInputs, onAllMessages, requestMidi, type MidiEvent } from '@/lib/midi';
import { Action, COMMAND_BY_KEY } from '@/lib/commands';

// note number -> command eventKey (matches COMMAND_BY_KEY). 36-based pad layout
// (the common default for pad apps): 36-45 scenes, 48-53 colours, then controls.
const DEFAULT_MAP: Record<number, string> = {
  36: '1', 37: '2', 38: '3', 39: '4', 40: '5', 41: '6', 42: '7', 43: '8', 44: '9', 45: '0',
  48: 'r', 49: 'g', 50: 'b', 51: 'y', 52: 'o', 53: 'w',
  54: 't', 55: 's', 56: ' ', 57: 'm', 58: 'a', 59: 'p', 60: 'x',
};

const STORAGE_KEY = 'lightflow:remoteMidiMap';

function loadOverrides(): Record<number, string> {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') ?? {};
  } catch {
    return {};
  }
}

export function useRemoteControl({ onAction }: { onAction: (a: Action) => void }) {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<Array<{ id: string; name: string }>>([]);
  const [learning, setLearning] = useState<string | null>(null); // eventKey awaiting a pad
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onActionRef = useRef(onAction);
  const learningRef = useRef<string | null>(null);
  const overridesRef = useRef<Record<number, string>>({});
  const unsubRef = useRef<(() => void) | null>(null);
  useEffect(() => { onActionRef.current = onAction; }, [onAction]);
  useEffect(() => { learningRef.current = learning; }, [learning]);
  useEffect(() => { overridesRef.current = loadOverrides(); }, []);
  useEffect(() => { setSupported(isMidiSupported()); }, []);

  const arm = useCallback((eventKey: string) => {
    setLearning((prev) => (prev === eventKey ? null : eventKey));
  }, []);
  const cancelLearn = useCallback(() => setLearning(null), []);

  const handle = useCallback((ev: MidiEvent) => {
    if (ev.kind !== 'noteOn') return;
    setLastNote(ev.key);

    // learn: bind this pad to the armed command
    if (learningRef.current) {
      const next = { ...overridesRef.current, [ev.key]: learningRef.current };
      overridesRef.current = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      setLearning(null);
      return;
    }

    const eventKey = overridesRef.current[ev.key] ?? DEFAULT_MAP[ev.key];
    const cmd = eventKey != null ? COMMAND_BY_KEY[eventKey] : undefined;
    if (cmd) onActionRef.current(cmd.action);
  }, []);

  // Request Web MIDI access and subscribe. Safe to call repeatedly (e.g. from a
  // button click — a user gesture, which some browsers require for the prompt).
  const connect = useCallback(async () => {
    if (!isMidiSupported()) {
      setSupported(false);
      setError('Web MIDI not supported — use Chrome / Arc / Edge');
      return;
    }
    setSupported(true);
    try {
      const access = await requestMidi();
      setConnected(true);
      setError(null);
      setDevices(listInputs(access));
      access.addEventListener('statechange', () => setDevices(listInputs(access)));
      unsubRef.current?.();
      unsubRef.current = onAllMessages(access, handle);
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [handle]);

  // best-effort auto-connect on mount (may be a no-op without a user gesture)
  useEffect(() => {
    if (supported) connect();
    return () => unsubRef.current?.();
  }, [supported, connect]);

  return { supported, connected, devices, learning, lastNote, error, arm, cancelLearn, connect };
}
