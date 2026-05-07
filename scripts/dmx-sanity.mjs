// DMX sanity test for Enttec USB Pro
// Sweeps channels 1, 2, 3 individually so we can confirm Halo 100x channel map.
// Run: node scripts/dmx-sanity.mjs

import { SerialPort } from 'serialport';

const PORT_PATH = '/dev/cu.usbserial-EN518139';
const BAUD = 250000;
const ENTTEC_LABEL_OUTPUT = 6;
const UNIVERSE_SIZE = 24; // we only care about first few channels; smaller packet = faster

const universe = new Uint8Array(UNIVERSE_SIZE);

function buildPacket(data) {
  // Enttec API: 0x7E | label | len LSB | len MSB | start-code(0x00) + data | 0xE7
  const payload = Buffer.alloc(data.length + 1);
  payload[0] = 0x00; // DMX start code
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

const port = new SerialPort({ path: PORT_PATH, baudRate: BAUD }, (err) => {
  if (err) {
    console.error('Failed to open port:', err.message);
    process.exit(1);
  }
  console.log(`Opened ${PORT_PATH} @ ${BAUD}`);
  run();
});

function send() {
  port.write(buildPacket(universe));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ramp(ch, label, ms = 1500) {
  console.log(`→ ${label} (ch${ch}) 0 → 255`);
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    universe.fill(0);
    universe[ch - 1] = Math.round((i / steps) * 255);
    send();
    await sleep(ms / steps);
  }
  await sleep(400);
  console.log(`← ${label} (ch${ch}) 255 → 0`);
  for (let i = steps; i >= 0; i--) {
    universe.fill(0);
    universe[ch - 1] = Math.round((i / steps) * 255);
    send();
    await sleep(ms / steps);
  }
}

async function hold(ch, value, ms, label) {
  console.log(`= ${label} ch${ch}=${value} for ${ms}ms`);
  universe.fill(0);
  universe[ch - 1] = value;
  send();
  await sleep(ms);
}

async function run() {
  try {
    // 0. Blackout
    console.log('\n[blackout]');
    universe.fill(0);
    send();
    await sleep(800);

    // 1. Ch1 ramp — expected: dimmer
    console.log('\n[ch1 — expected: DIMMER]');
    await ramp(1, 'ch1');

    // 2. Ch2 sweep — expected: CCT (with dimmer up)
    console.log('\n[ch2 — expected: CCT (dimmer held at 200)]');
    universe.fill(0);
    universe[0] = 200; // dim up so we can see CCT
    send();
    await sleep(500);
    for (let i = 0; i <= 60; i++) {
      universe[1] = Math.round((i / 60) * 255);
      send();
      await sleep(40);
    }
    await sleep(400);
    universe[1] = 0;
    send();

    // 3. Ch3 sweep — expected: G/M (with dimmer up)
    console.log('\n[ch3 — expected: G/M (dimmer held at 200)]');
    universe.fill(0);
    universe[0] = 200;
    universe[1] = 128; // mid CCT
    send();
    await sleep(500);
    for (let i = 0; i <= 60; i++) {
      universe[2] = Math.round((i / 60) * 255);
      send();
      await sleep(40);
    }
    await sleep(400);

    // 4. Final blackout
    console.log('\n[blackout]');
    universe.fill(0);
    send();
    await sleep(500);

    console.log('\nDone.');
    port.close();
  } catch (e) {
    console.error(e);
    port.close();
    process.exit(1);
  }
}
