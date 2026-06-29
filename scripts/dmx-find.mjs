// DMX channel finder — walks one channel at a time to full so you can SEE which
// channel does what on an unknown fixture. Set /live to PREVIEW first (so it
// isn't also sending), then:
//   START=26 node scripts/dmx-find.mjs      (scans channels 26..26+15)
import WebSocket from 'ws';

const START = Number(process.env.START ?? 1);
const COUNT = Number(process.env.COUNT ?? 16);
const HOLD_MS = Number(process.env.HOLD ?? 2500);

const ws = new WebSocket('ws://localhost:7777');
ws.on('open', () => {
  console.log(`channel finder — full on, one channel at a time, ${HOLD_MS}ms each`);
  let ch = START;
  const step = () => {
    if (ch >= START + COUNT) {
      ws.send(new Uint8Array(128));
      ws.close();
      console.log('done');
      return;
    }
    const u = new Uint8Array(128);
    u[ch - 1] = 255; // DMX channel ch (1-based) → index ch-1
    ws.send(u);
    console.log(`>>> DMX channel ${ch} = FULL`);
    ch++;
    setTimeout(step, HOLD_MS);
  };
  step();
});
ws.on('error', (e) => console.error('ws error:', e.message));
