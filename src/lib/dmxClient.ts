// Browser-side DMX client. Connects to the bridge sidecar over WebSocket and
// sends per-frame channel values. Auto-reconnects; silently no-ops if the
// bridge isn't running.
//
// Auto-connects only when the page itself is served from localhost. On a
// hosted origin, dialing ws://localhost triggers Chrome's "access other apps
// and services on this device" prompt for every visitor, so there the
// connection is opt-in: call connectDMX() from a user gesture (the /live
// console does this when output is switched to 'live').

const URL = 'ws://localhost:7777';
const RECONNECT_MS = 2000;

let ws: WebSocket | null = null;
let connecting = false;
let wanted = false; // set by connectDMX(); gates the reconnect loop

function isLocalOrigin() {
  const h = typeof window !== 'undefined' ? window.location.hostname : '';
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function connect() {
  if (!wanted) return;
  if (connecting || (ws && ws.readyState <= 1)) return;
  connecting = true;
  try {
    const sock = new WebSocket(URL);
    sock.binaryType = 'arraybuffer';
    sock.onopen = () => {
      connecting = false;
      ws = sock;
      console.log('[dmx] bridge connected');
    };
    sock.onclose = () => {
      connecting = false;
      ws = null;
      setTimeout(connect, RECONNECT_MS);
    };
    sock.onerror = () => {
      sock.close();
    };
  } catch {
    connecting = false;
    setTimeout(connect, RECONNECT_MS);
  }
}

/** Start (or retry) the bridge connection. Safe to call repeatedly. */
export function connectDMX() {
  wanted = true;
  connect();
}

if (typeof window !== 'undefined' && isLocalOrigin()) connectDMX();

const buf = new Uint8Array(128);

export function sendDMX(values: number[] | Uint8Array) {
  if (!ws || ws.readyState !== 1) return;
  const len = Math.min(values.length, buf.length);
  for (let i = 0; i < len; i++) {
    const v = values[i] | 0;
    buf[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  for (let i = len; i < buf.length; i++) buf[i] = 0;
  ws.send(buf);
}

export function isDMXConnected() {
  return !!ws && ws.readyState === 1;
}
