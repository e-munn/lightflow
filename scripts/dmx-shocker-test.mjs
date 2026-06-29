import WebSocket from 'ws';
const ws = new WebSocket('ws://localhost:7777');
const BASES = [0, 8]; // addr 1 and 9 (8CH each)
ws.on('open', () => {
  console.log('blinking both shockers full WHITE for ~15s (addr 30 & 40)');
  let on = true, n = 0;
  const iv = setInterval(() => {
    const u = new Uint8Array(128);
    if (on) for (const b of BASES) {
      u[b+0] = 255; // master dimmer
      u[b+2] = 255; // red
      u[b+3] = 255; // green
      u[b+4] = 255; // blue
      u[b+5] = 255; // white
      // b+1 strobe=0, b+6 program=0, b+7 speed=0
    }
    ws.send(u);
    on = !on; n++;
    if (n > 30) { clearInterval(iv); ws.send(new Uint8Array(128)); ws.close(); console.log('done'); }
  }, 500);
});
ws.on('error', e => console.error('ws error:', e.message));
