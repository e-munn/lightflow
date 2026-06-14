'use client';

// Phone remote — open on the phone BROWSER at http://<laptop-ip>:3000/remote
// (same WiFi). Commands POST to the Next server, which relays them to the laptop
// console over SSE. No app, no pairing, no bridge.
//
// Layout: everything sits in the bottom ~60% (thumb reach). Scenes are the big,
// most-reachable buttons at the very bottom; colours are small dots above.

import { useCallback, useEffect, useState } from 'react';
import { SCENES } from '@/lib/scenes';
import { COLOR_KEYS } from '@/lib/fixtures';

export default function RemotePage() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/remote/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const send = useCallback(
    (key: string) => {
      if (!connected) return;
      fetch('/api/remote/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }).catch(() => {});
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(12);
    },
    [connected],
  );

  const live = connected ? '' : 'pointer-events-none opacity-30';

  return (
    <div className="flex h-[100dvh] flex-col bg-black text-white">
      {/* status — pinned top, out of the way */}
      <div className="flex items-center justify-between px-4 pt-4">
        <span className="font-mono text-xs tracking-tight text-white/50">lightflow remote</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-white/50">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-white/25'}`} />
          {connected ? 'connected' : 'connecting…'}
        </span>
      </div>

      {/* empty top 40% keeps controls in thumb reach */}
      <div className="flex-1" />

      {/* control zone — bottom, least → most important top → bottom */}
      <div className={`flex flex-col gap-3 px-3 pb-4 ${live}`}>
        {/* colours — least important: small dots */}
        <div className="flex items-center justify-center gap-3">
          {Object.entries(COLOR_KEYS).map(([k, c]) => (
            <button
              key={k}
              onClick={() => send(k)}
              aria-label={c.name}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 active:border-white"
            >
              <span className="h-4 w-4 rounded-full" style={{ background: `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})` }} />
            </button>
          ))}
        </div>

        {/* transport */}
        <div className="grid grid-cols-3 gap-2.5">
          <button onClick={() => send(' ')} className="h-12 rounded-xl border border-white/15 font-mono text-xs text-white/70 active:bg-white active:text-black">BLACKOUT</button>
          <button onClick={() => send('s')} className="h-12 rounded-xl border border-white/15 font-mono text-xs text-white/70 active:bg-white active:text-black">STROBE</button>
          <button onClick={() => send('p')} className="h-12 rounded-xl border border-white/15 font-mono text-xs text-white/70 active:bg-white active:text-black">PULSE</button>
        </div>

        {/* scenes — most important: big buttons at the very bottom */}
        <div className="grid grid-cols-2 gap-2.5">
          {SCENES.map((s) => (
            <button
              key={s.key}
              onClick={() => send(s.key.toLowerCase())}
              className="flex h-[3.5rem] flex-col items-center justify-center gap-0.5 rounded-2xl border border-white/15 font-mono active:bg-white active:text-black"
            >
              <span className="text-xl font-semibold leading-none">{s.key}</span>
              <span className="text-[10px] uppercase tracking-wide text-white/40">{s.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
