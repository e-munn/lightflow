// Direct DMX test — bypasses the /live UI. Lights both Spot 160s (ch 1 and ch
// 12, 11CH mode) full open and sweeps pan, so we can confirm the
// bridge → Enttec → fixture path independent of the app.
//   node scripts/dmx-test.mjs
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:7777');
const BASES = [0, 11]; // 0-based universe index for ch1 and ch12

ws.on('open', () => {
  console.log('connected to bridge — sweeping both spots full-open for 12s');
  let t = 0;
  const iv = setInterval(() => {
    t += 0.1;
    const u = new Uint8Array(128);
    const pan = Math.round(128 + 110 * Math.sin(t)); // visible pan sweep
    for (const b of BASES) {
      u[b + 0] = pan; // pan coarse
      u[b + 2] = 128; // tilt coarse (mid)
      u[b + 4] = 0; // pan/tilt speed (fastest)
      u[b + 5] = 3; // colour wheel = white
      u[b + 7] = 255; // dimmer full
      u[b + 8] = 5; // shutter open (4-7)
    }
    ws.send(u);
  }, 100);
  setTimeout(() => {
    clearInterval(iv);
    ws.send(new Uint8Array(128)); // blackout
    ws.close();
    console.log('done');
  }, 12000);
});
ws.on('error', (e) => console.error('ws error:', e.message));
