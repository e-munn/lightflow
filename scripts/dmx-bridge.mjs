// DMX bridge: WebSocket server → Enttec USB Pro
//
// Run alongside `pnpm dev`:
//   node scripts/dmx-bridge.mjs
//
// Webapp connects to ws://localhost:7777 and sends frames as binary Uint8Array
// (one byte per DMX channel, starting at channel 1). Last received frame is
// pushed to the Enttec at TICK_HZ. Auto-reconnects to the Enttec if it's
// unplugged and re-plugged.

import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';

// Port: an explicit DMX_PORT wins; otherwise auto-detect the Enttec (FTDI USB
// serial) so a new unit "just works" without hardcoding its serial number.
async function resolvePort() {
  if (process.env.DMX_PORT) return process.env.DMX_PORT;
  try {
    const ports = await SerialPort.list();
    const hit = ports.find(
      (p) =>
        /usbserial|usbmodem/i.test(p.path || '') ||
        /FTDI|ENTTEC/i.test(p.manufacturer || '') ||
        p.vendorId === '0403',
    );
    // macOS: use the callout device (cu.*) for output, not the dialin (tty.*),
    // which can block/not flush when sending.
    if (hit) return hit.path.replace('/dev/tty.', '/dev/cu.');
  } catch {
    /* fall through */
  }
  return null;
}
const BAUD = 250000;
const WS_PORT = Number(process.env.DMX_WS_PORT ?? 7777);
const TICK_HZ = 40;
const ENTTEC_LABEL_OUTPUT = 6;
const UNIVERSE_SIZE = 128;
const MIN_WRITE_INTERVAL_MS = 8;
const RECONNECT_MS = 1000;

const universe = new Uint8Array(UNIVERSE_SIZE);
let lastFrameAt = 0;
let lastWriteAt = 0;
let port = null;

function buildPacket(data) {
  const payload = Buffer.alloc(data.length + 1);
  payload[0] = 0x00;
  Buffer.from(data).copy(payload, 1);
  const len = payload.length;
  const packet = Buffer.alloc(5 + len);
  packet[0] = 0x7e;
  packet[1] = ENTTEC_LABEL_OUTPUT;
  packet[2] = len & 0xff;
  packet[3] = (len >> 8) & 0xff;
  payload.copy(packet, 4);
  packet[4 + len] = 0xe7;
  return packet;
}

async function openPort() {
  const path = await resolvePort();
  if (!path) {
    // no Enttec present yet — keep looking
    setTimeout(openPort, RECONNECT_MS);
    return;
  }
  const p = new SerialPort({ path, baudRate: BAUD }, (err) => {
    if (err) {
      // Don't spam — ENXIO/ENOENT just means device not present yet
      if (err.code !== 'ENOENT' && err.code !== 'ENXIO') {
        console.error(`[dmx] open error: ${err.message}`);
      }
      port = null;
      setTimeout(openPort, RECONNECT_MS);
      return;
    }
    console.log(`[dmx] opened ${path} @ ${BAUD}`);
    port = p;
  });
  // Suppress unhandled-error crash and trigger reopen on transport failure
  p.on('error', (err) => {
    console.error(`[dmx] port error: ${err.message}`);
  });
  p.on('close', () => {
    if (port === p) {
      console.warn('[dmx] port closed — reconnecting…');
      port = null;
      setTimeout(openPort, RECONNECT_MS);
    }
  });
}

function flush() {
  const now = Date.now();
  if (now - lastWriteAt < MIN_WRITE_INTERVAL_MS) return;
  if (!port || !port.isOpen) return;
  port.write(buildPacket(universe), (err) => {
    if (err) console.error(`[dmx] write failed: ${err.message}`);
  });
  lastWriteAt = now;
}

const wss = new WebSocketServer({ port: WS_PORT });
console.log(`[ws]  listening on ws://localhost:${WS_PORT}`);

wss.on('connection', (ws) => {
  console.log('[ws]  client connected');
  ws.on('message', (msg, isBinary) => {
    if (!isBinary) return;
    // binary frame = a DMX universe from the console
    const len = Math.min(msg.length, UNIVERSE_SIZE);
    for (let i = 0; i < len; i++) universe[i] = msg[i];
    lastFrameAt = Date.now();
    flush();
  });
  ws.on('close', () => console.log('[ws]  client disconnected'));
});

setInterval(() => {
  if (Date.now() - lastFrameAt > 2000) universe.fill(0);
  flush();
}, 1000 / TICK_HZ);

openPort();

const shutdown = () => {
  console.log('\n[dmx] blackout & exit');
  universe.fill(0);
  if (port && port.isOpen) port.write(buildPacket(universe));
  setTimeout(() => process.exit(0), 100);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
