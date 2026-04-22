/**
 * Minimal Web MIDI wrapper for show recording.
 *
 * Scope: detect connected input devices, subscribe to MIDI messages,
 * parse them into a simple event shape. No recording logic here —
 * callers handle that.
 *
 * Web MIDI API is Chromium-only without flags (Chrome / Edge / Arc).
 * Safari and Firefox users will see "unsupported".
 */

export type MidiMessageKind =
  | 'noteOn'
  | 'noteOff'
  | 'cc'          // control change (encoders, faders)
  | 'pitchBend'
  | 'unknown';

export interface MidiEvent {
  /** Which device sent the event */
  deviceId: string;
  deviceName: string;
  /** When the event fired (performance.now() coordinates, ms) */
  timestamp: number;
  kind: MidiMessageKind;
  /** Note number for noteOn/noteOff, CC number for cc, unused for others */
  key: number;
  /** Velocity for notes (0-127), value for CC (0-127), pitch bend value */
  value: number;
  /** MIDI channel 1-16 */
  channel: number;
  /** Raw status byte — exposed for edge cases */
  status: number;
}

export function isMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

/**
 * Request MIDI access. Resolves to the MIDIAccess object, or rejects if
 * the browser doesn't support Web MIDI or the user denied permission.
 */
export async function requestMidi(): Promise<MIDIAccess> {
  if (!isMidiSupported()) {
    throw new Error('Web MIDI API not supported in this browser');
  }
  return navigator.requestMIDIAccess({ sysex: false });
}

/**
 * Parse a raw 3-byte MIDI message into a typed event.
 */
export function parseMidiMessage(
  data: Uint8Array,
  deviceId: string,
  deviceName: string,
  timestamp: number,
): MidiEvent {
  const status = data[0] ?? 0;
  const type = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const key = data[1] ?? 0;
  const value = data[2] ?? 0;

  let kind: MidiMessageKind = 'unknown';
  if (type === 0x90) {
    // Note on — velocity 0 is actually note off per MIDI spec
    kind = value > 0 ? 'noteOn' : 'noteOff';
  } else if (type === 0x80) {
    kind = 'noteOff';
  } else if (type === 0xb0) {
    kind = 'cc';
  } else if (type === 0xe0) {
    kind = 'pitchBend';
  }

  return { deviceId, deviceName, timestamp, kind, key, value, channel, status };
}

/**
 * List currently-connected input devices with a stable id/name.
 */
export function listInputs(access: MIDIAccess): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  access.inputs.forEach((input) => {
    out.push({ id: input.id, name: input.name ?? 'Unknown MIDI input' });
  });
  return out;
}

/**
 * Subscribe to every incoming message from every input device.
 * Returns an unsubscribe function.
 *
 * On MIDIAccess.statechange we resubscribe so hot-plugged devices
 * start flowing without page reload.
 */
export function onAllMessages(
  access: MIDIAccess,
  handler: (event: MidiEvent) => void,
): () => void {
  const handlers = new Map<string, (e: Event) => void>();

  const attach = () => {
    access.inputs.forEach((input) => {
      if (handlers.has(input.id)) return;
      const fn = (e: Event) => {
        const me = e as unknown as { data: Uint8Array; timeStamp?: number };
        if (!me.data || me.data.length < 1) return;
        const ts =
          typeof me.timeStamp === 'number'
            ? me.timeStamp
            : performance.now();
        handler(
          parseMidiMessage(me.data, input.id, input.name ?? '?', ts),
        );
      };
      input.addEventListener('midimessage', fn);
      handlers.set(input.id, fn);
    });
  };

  const detach = () => {
    access.inputs.forEach((input) => {
      const fn = handlers.get(input.id);
      if (fn) {
        input.removeEventListener('midimessage', fn);
        handlers.delete(input.id);
      }
    });
  };

  attach();
  const onState = () => {
    detach();
    attach();
  };
  access.addEventListener('statechange', onState);

  return () => {
    detach();
    access.removeEventListener('statechange', onState);
  };
}
