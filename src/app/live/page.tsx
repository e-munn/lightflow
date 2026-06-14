'use client';

// Live lighting console. Keyboard-map control surface over an on-screen
// playground. Same universe buffer drives the preview and (when LIVE) the
// Enttec bridge. Build/tune on a laptop; calibrate to real fixtures later.
//
// Most keys toggle: re-pressing the active scene blacks out; re-pressing the
// active colour returns to amber (the rig's always-on resting colour).
//
//   1-0 scenes · Space blackout · R/G/B/Y/O color · X back to amber
//   T tap tempo · S strobe · L live DMX · ⌘/Ctrl+K command palette

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { RIG, composeUniverse, applyColorOverride, visualFor, COLOR_KEYS, AMBER, ColorOverride, Visual, FixtureState } from '@/lib/fixtures';
import { SceneEngine, SCENE_BY_KEY } from '@/lib/scenes';
import { sendDMX, isDMXConnected } from '@/lib/dmxClient';
import { TapTempo } from '@/lib/tapTempo';
import { AudioReactor, AudioFrame } from '@/lib/liveAudio';
import { applyReactive } from '@/lib/reactive';
import { AutoPilot, AutoStatus } from '@/lib/autopilot';
import { Action, COMMAND_BY_KEY } from '@/lib/commands';
import { KeyboardMap } from '@/components/KeyboardMap';
import { CommandPalette } from '@/components/CommandPalette';
import { TimelineStrip, LiveTimeline } from '@/components/TimelineStrip';
import { useRemoteControl } from '@/hooks/useRemoteControl';
import { Cue } from '@/lib/shows';
import { useShowPlayer } from '@/hooks/useShowPlayer';
import { QRCodeSVG } from 'qrcode.react';

// WebGL/3D layer — client only, no SSR.
const Rig3D = dynamic(() => import('@/components/Rig3D').then((m) => m.Rig3D), { ssr: false });
import type { RigMode } from '@/components/Rig3D';

type Output = 'preview' | 'live';

export default function LivePage() {
  const frameRef = useRef<Record<string, Visual>>({});
  const engineRef = useRef<SceneEngine | null>(null);
  const tapRef = useRef<TapTempo | null>(null);
  const outputRef = useRef<Output>('preview');
  // colour override applied every frame. Defaults to AMBER — the rig's resting
  // colour — never null, so there's always a warm base. null colorKey = amber.
  const colorRef = useRef<ColorOverride>(AMBER);
  const strobeRef = useRef(false);
  const pulseStartRef = useRef(-1e9); // momentary P-key pulse (one-tap swell)
  const pulseDurRef = useRef(250); // ms — half a beat at 120 bpm by default
  const paletteOpenRef = useRef(false);
  const micRef = useRef<AudioReactor | null>(null);
  const micOnRef = useRef(false);
  const simAudioRef = useRef<HTMLAudioElement | null>(null); // file-as-live-input (desk testing)
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const autopilotRef = useRef<AutoPilot | null>(null);
  const autoOnRef = useRef(false);
  const audioRef = useRef<AudioFrame | null>(null);
  const lastTapRef = useRef(0); // manual tempo touch wins over auto-BPM for a while
  const lastSectionRef = useRef(0);
  const liveRef = useRef<LiveTimeline>({ samples: [], bpm: null, beatLen: 0.5, beats: 0, build: 0, energy: 0 });

  const [activeName, setActiveName] = useState('Blackout');
  const [activeSceneKey, setActiveSceneKey] = useState<string | null>(null);
  const [colorKey, setColorKey] = useState<string | null>(null);
  const [strobe, setStrobe] = useState(false);
  const [pulseOn, setPulseOn] = useState(false);
  const [output, setOutput] = useState<Output>('preview');
  const [connected, setConnected] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [bpmInput, setBpmInput] = useState('');
  const [bpmEditing, setBpmEditing] = useState(false);
  const [beat, setBeat] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [energy, setEnergy] = useState(0);
  const [section, setSection] = useState(false);
  const [simName, setSimName] = useState<string | null>(null); // non-null = file is driving the pipeline
  const [autoOn, setAutoOn] = useState(false);
  const [autoStatus, setAutoStatus] = useState<AutoStatus>({ rel: 0, dropping: false, suppressed: false, scene: '', bias: 0 });
  const [simTime, setSimTime] = useState(0);
  const [simDur, setSimDur] = useState(0);
  const [simPaused, setSimPaused] = useState(false);
  const [rigMode, setRigMode] = useState<RigMode>('abstract');
  const [dragging, setDragging] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');

  useEffect(() => {
    setRemoteUrl(`${window.location.protocol}//${window.location.host}/remote`);
  }, []);
  const remoteIsLocalhost = /^(localhost|127\.|\[?::1)/.test(remoteUrl.replace(/^https?:\/\//, ''));

  // Stop whatever is currently feeding the reactor (live mic OR a sim file).
  const stopListen = () => {
    micRef.current?.stop();
    micRef.current = null;
    if (simAudioRef.current) {
      simAudioRef.current.pause();
      simAudioRef.current = null;
    }
    micOnRef.current = false;
    setMicOn(false);
    setSimName(null);
  };

  const toggleMic = async () => {
    if (micOnRef.current) {
      stopListen();
      return;
    }
    try {
      micRef.current = new AudioReactor();
      await micRef.current.start();
      micOnRef.current = true;
      setMicOn(true);
    } catch {
      stopListen();
    }
  };

  // Pretend a local audio file is the live board feed: route it through the SAME
  // reactor graph, so reactive/AutoPilot/detection run off it (no hardware).
  const startSim = async (file: File) => {
    stopListen();
    try {
      const el = new Audio(URL.createObjectURL(file));
      simAudioRef.current = el;
      setSimTime(0);
      setSimDur(0);
      setSimPaused(false);
      el.addEventListener('loadedmetadata', () => setSimDur(el.duration || 0));
      el.addEventListener('play', () => setSimPaused(false));
      el.addEventListener('pause', () => setSimPaused(true));
      const r = new AudioReactor();
      micRef.current = r;
      await r.startFromElement(el);
      await el.play();
      micOnRef.current = true;
      setMicOn(true);
      setSimName(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      stopListen();
    }
  };

  // Scrub the sim file — AutoPilot reacts to whatever's now playing; reset its
  // hold/arm state so it re-evaluates cleanly from the new position.
  const seekSim = (t: number) => {
    if (simAudioRef.current) {
      simAudioRef.current.currentTime = t;
      autopilotRef.current?.reset();
      setSimTime(t);
    }
  };

  const toggleSimPlay = () => {
    const el = simAudioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  // Set AutoPilot intensity mode directly (-1 low · 0 default · +1 high) — same
  // as the ↑/↓ keys; engages AutoPilot if it's off.
  const setAutoMode = (b: number) => {
    if (!autoOnRef.current) {
      autoOnRef.current = true;
      setAutoOn(true);
    }
    autopilotRef.current?.setBias(b);
    if (autopilotRef.current) setAutoStatus(autopilotRef.current.getStatus());
  };

  useEffect(() => {
    outputRef.current = output;
  }, [output]);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
  }, [paletteOpen]);

  // dispatch is stable via ref so the keydown handler (bound once) can call it
  const dispatchRef = useRef<(a: Action) => void>(() => {});
  dispatchRef.current = (a: Action) => {
    const engine = engineRef.current!;
    const tap = tapRef.current!;
    switch (a.kind) {
      case 'scene': {
        const sc = SCENE_BY_KEY[a.key];
        if (!sc) break;
        // toggle: re-pressing the active scene turns it off (blackout)
        if (engine.activeKey === a.key) {
          engine.blackout();
          setActiveName(engine.activeName);
          setActiveSceneKey(null);
        } else {
          engine.setScene(sc);
          setActiveName(engine.activeName);
          setActiveSceneKey(engine.activeKey);
        }
        // a manual scene pick makes AutoPilot yield for a bit
        autopilotRef.current?.noteManual(performance.now(), tap.bpm, engine.activeKey ?? '');
        break;
      }
      case 'color': {
        // toggle: re-pressing the active colour comes home to amber
        const next = colorKey === a.color ? null : a.color;
        colorRef.current = next ? COLOR_KEYS[next] : AMBER;
        setColorKey(next);
        break;
      }
      case 'colorClear':
        colorRef.current = AMBER;
        setColorKey(null);
        break;
      case 'tap':
        tap.tap(performance.now());
        lastTapRef.current = performance.now(); // manual override beats auto-BPM
        setBpm(tap.bpm);
        break;
      case 'strobe':
        strobeRef.current = !strobeRef.current;
        setStrobe(strobeRef.current);
        break;
      case 'pulse':
        // one-tap momentary swell — NOT a toggle. Half a beat at the live tempo
        // (120 fallback), so it stays musical when a BPM is set.
        pulseDurRef.current = 60000 / (tap.bpm ?? 120) / 2;
        pulseStartRef.current = performance.now();
        break;
      case 'mic':
        toggleMic();
        break;
      case 'autopilot':
        autoOnRef.current = !autoOnRef.current;
        autopilotRef.current?.reset();
        setAutoOn(autoOnRef.current);
        break;
      case 'autoBias':
        // ↑/↓ lean AutoPilot more/less intense (persists). Engages it if off.
        if (!autoOnRef.current) {
          autoOnRef.current = true;
          setAutoOn(true);
        }
        autopilotRef.current?.adjustBias(a.dir);
        if (autopilotRef.current) setAutoStatus(autopilotRef.current.getStatus());
        break;
      case 'blackout':
        engine.blackout();
        setActiveName(engine.activeName);
        setActiveSceneKey(null);
        break;
      case 'toggleLive':
        setOutput((o) => (o === 'live' ? 'preview' : 'live'));
        break;
    }
  };

  // Show player applies a cue as an ABSOLUTE look — force-set the scene (no
  // toggle), set the colour (null = amber), or blackout. The per-frame loop then
  // composes it exactly like a manual keypress, so the operator can still grab it.
  const applyCue = (cue: Cue) => {
    const engine = engineRef.current!;
    if (cue.blackout) {
      engine.blackout();
      setActiveName(engine.activeName);
      setActiveSceneKey(null);
    } else if (cue.scene) {
      const sc = SCENE_BY_KEY[cue.scene];
      if (sc) {
        engine.setScene(sc);
        setActiveName(engine.activeName);
        setActiveSceneKey(engine.activeKey);
      }
    }
    if (cue.color !== undefined) {
      colorRef.current = cue.color ? COLOR_KEYS[cue.color] ?? AMBER : AMBER;
      setColorKey(cue.color ?? null);
    }
  };

  const player = useShowPlayer({
    applyCue,
    onTempo: (b) => {
      tapRef.current?.set(b); // lock scene motion to the song's tempo
      lastTapRef.current = performance.now(); // show tempo beats mic auto-BPM
      setBpm(tapRef.current?.bpm ?? b);
    },
  });

  // Phone-as-remote over Bluetooth MIDI → same command dispatch as the keyboard.
  const remote = useRemoteControl({ onAction: (a) => dispatchRef.current(a) });
  const [learnRemote, setLearnRemote] = useState(false);
  const learnRemoteRef = useRef(false);
  const remoteArmRef = useRef(remote.arm);
  useEffect(() => { learnRemoteRef.current = learnRemote; }, [learnRemote]);
  useEffect(() => { remoteArmRef.current = remote.arm; }, [remote.arm]);

  useEffect(() => {
    const engine = new SceneEngine();
    engineRef.current = engine;
    tapRef.current = new TapTempo();
    autopilotRef.current = new AutoPilot();

    // phone /remote → /api/remote/send → SSE here. A command is { key } matching
    // a keyboard command; fire the same Action so the phone mirrors the keyboard.
    const remoteEvents = new EventSource('/api/remote/stream');
    remoteEvents.onmessage = (e) => {
      try {
        const { key } = JSON.parse(e.data);
        const cmd = typeof key === 'string' ? COMMAND_BY_KEY[key] : undefined;
        if (cmd) dispatchRef.current(cmd.action);
      } catch {
        /* keepalive / malformed — ignore */
      }
    };

    const onKey = (e: KeyboardEvent) => {
      // palette toggle: Cmd/Ctrl + Space
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (paletteOpenRef.current) return; // palette owns keys while open
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      // ↑/↓ lean AutoPilot more/less intense (high / low modes)
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        dispatchRef.current({ kind: 'autoBias', dir: e.key === 'ArrowUp' ? 1 : -1 });
        return;
      }
      const cmd = COMMAND_BY_KEY[e.key.toLowerCase()] ?? (e.code === 'Space' ? COMMAND_BY_KEY[' '] : undefined);
      if (cmd) {
        if (e.key === ' ' || e.code === 'Space') e.preventDefault();
        // MIDI-learn: arm this command, then the next pad press binds to it
        if (learnRemoteRef.current) remoteArmRef.current(cmd.eventKey);
        else dispatchRef.current(cmd.action);
      }
    };
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const beats = tapRef.current!.beats(now);
      const base = engine.tick(dt, beats);
      let states = applyColorOverride(base, colorRef.current);
      if (micOnRef.current && micRef.current?.running) {
        const a = micRef.current.update(now);
        audioRef.current = a;
        states = applyReactive(states, a); // brightness/intensity ride the music
        // auto-BPM follow, but only if you haven't touched the tempo recently
        if (a.bpm && now - lastTapRef.current > 8000) {
          const cur = tapRef.current!.bpm;
          if (!cur || Math.abs(cur - a.bpm) > 2) tapRef.current!.setRate(a.bpm);
        }
        if (a.sectionChange) lastSectionRef.current = now;
        // AutoPilot: drive scene selection from the live signal (manual keys
        // still win — they just get overridden on the next qualifying change).
        if (autoOnRef.current && autopilotRef.current) {
          const d = autopilotRef.current.step(now, a, tapRef.current!.bpm);
          if (d.scene && d.scene !== engine.activeKey) {
            const sc = SCENE_BY_KEY[d.scene];
            if (sc) {
              engine.setScene(sc);
              setActiveName(engine.activeName);
              setActiveSceneKey(engine.activeKey);
            }
          }
          if (d.color !== undefined) {
            colorRef.current = d.color ? COLOR_KEYS[d.color] ?? AMBER : AMBER;
            setColorKey(d.color ?? null);
          }
        }
        // feed the timeline strip
        const L = liveRef.current;
        L.samples.push({ t: now, e: a.energy });
        while (L.samples.length && L.samples[0].t < now - 3600) L.samples.shift();
        L.bpm = tapRef.current!.bpm;
        L.beatLen = tapRef.current!.bpm ? 60 / tapRef.current!.bpm : 0.5;
        L.beats = beats;
        L.build = a.build;
        L.energy = a.energy;
      }
      // momentary pulse (P): a smooth swell to full and back over half a beat,
      // with a subtle spot swoop — emphasis on an instrument, not a strobe.
      const pulseT = (now - pulseStartRef.current) / pulseDurRef.current;
      if (pulseT >= 0 && pulseT < 1) {
        const env = Math.sin(pulseT * Math.PI); // 0 → 1 → 0, smooth
        const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
        const g: Record<string, FixtureState> = {};
        for (const f of RIG) {
          const st = { ...states[f.id] };
          st.dim = c01((st.dim ?? 0) + (1 - (st.dim ?? 0)) * env); // swell toward full
          if (f.kind === 'spot160') {
            const side = f.pos.x < 0.5 ? 1 : -1;
            st.pan = c01((st.pan ?? 0.5) + env * 0.05 * side); // subtle swoop out
            st.tilt = c01((st.tilt ?? 0.5) - env * 0.07); // ...and up
          }
          g[f.id] = st;
        }
        states = g;
      }
      if (strobeRef.current) {
        const gate = (now * 0.012) % 1 < 0.5 ? 1 : 0; // ~12 Hz manual strobe-all
        const g: Record<string, FixtureState> = {};
        for (const f of RIG) g[f.id] = { ...states[f.id], dim: (states[f.id].dim ?? 0) * gate };
        states = g;
      }
      const universe = composeUniverse(states);
      if (outputRef.current === 'live') sendDMX(universe);
      const frame: Record<string, Visual> = {};
      for (const f of RIG) frame[f.id] = visualFor(f, states[f.id]);
      frameRef.current = frame;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const meta = setInterval(() => {
      setConnected(isDMXConnected());
      setBeat(tapRef.current!.phase() < 0.16 && tapRef.current!.bpm != null);
      setBpm(tapRef.current!.bpm); // reflects auto-BPM follow too
      setEnergy(audioRef.current?.energy ?? 0);
      setSection(performance.now() - lastSectionRef.current < 700);
      if (simAudioRef.current) setSimTime(simAudioRef.current.currentTime);
      setPulseOn(performance.now() - pulseStartRef.current < pulseDurRef.current);
      if (autoOnRef.current && autopilotRef.current) setAutoStatus(autopilotRef.current.getStatus());
    }, 50);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(meta);
      window.removeEventListener('keydown', onKey);
      remoteEvents.close();
      micRef.current?.stop();
      simAudioRef.current?.pause();
      micOnRef.current = false;
    };
  }, []);

  const applyBpm = () => {
    const v = parseFloat(bpmInput);
    if (v > 0 && tapRef.current) {
      tapRef.current.set(v);
      lastTapRef.current = performance.now(); // manual entry overrides auto-BPM
      setBpm(tapRef.current.bpm);
    }
  };

  // the colour the rig is currently resting on (amber when no key is selected)
  const activeColor = colorKey ? COLOR_KEYS[colorKey] ?? AMBER : AMBER;

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // shared style for the interactive control stack (bottom-left of the keyboard)
  const stackBtn = (active: boolean) =>
    `flex items-center gap-1.5 rounded-[4px] border px-2 py-0.5 text-left font-mono text-[10px] transition-colors ${
      active ? 'border-white bg-white text-black' : 'border-white/10 text-white/45 hover:border-white/30'
    }`;

  // keys that should appear "active" on the map
  const activeKeys = new Set<string>();
  if (activeSceneKey) activeKeys.add(activeSceneKey.toLowerCase());
  if (colorKey) activeKeys.add(colorKey);
  if (strobe) activeKeys.add('s');
  if (pulseOn) activeKeys.add('p');
  if (micOn) activeKeys.add('m');
  if (autoOn) activeKeys.add('a');

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden bg-black text-white"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files?.[0];
        if (f && f.type.startsWith('audio')) startSim(f);
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-xl border-2 border-dashed border-white/40 bg-black/70 font-mono text-sm text-white/70">
          drop audio to sim
        </div>
      )}
      <header className="flex items-center gap-3.5 border-b border-white/10 px-5 py-2.5">
        <span className="font-mono text-[13px] tracking-tight text-white">lightflow</span>
        <span className="font-mono text-[11px] text-white/40">{activeName.toLowerCase()}</span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-white/40">
          <span className="h-2 w-2 rounded-full" style={{ background: `rgb(${activeColor.rgb.map((v) => Math.round(v * 255)).join(',')})` }} />
          {activeColor.name.toLowerCase()}
        </span>
        {autoOn && (
          <span
            className="flex items-center gap-1.5 font-mono text-[10px] text-white/40"
            title="AutoPilot — driving scenes from the live signal (↑/↓ intensity)"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${autoStatus.dropping ? 'bg-white' : autoStatus.suppressed ? 'bg-white/25' : 'bg-white/55'}`}
            />
            {autoStatus.dropping ? 'auto·drop' : autoStatus.suppressed ? 'auto·held' : 'auto'}
            {autoStatus.bias > 0 && <span className="text-white/70">▲high</span>}
            {autoStatus.bias < 0 && <span className="text-white/70">▼low</span>}
            <span className="h-1 w-10 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full bg-white/60" style={{ width: `${Math.round(autoStatus.rel * 100)}%` }} />
            </span>
          </span>
        )}

        {/* read-only status only — all controls live in the keyboard's bottom-left stack */}
        <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-white/40">
          {player.show && (
            <span className="flex items-center gap-2">
              <span className="max-w-[11rem] truncate text-white/60" title={`${player.show.title} · ${player.show.artist}`}>
                {player.show.title}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                {fmtTime(player.time)} / {fmtTime(player.show.duration)}
              </span>
            </span>
          )}
          {micOn && (
            <span className="flex items-center gap-1.5">
              {simName ? 'sim' : 'mic'}
              <span className={`h-1 w-10 overflow-hidden rounded-full ${section ? 'bg-white/25' : 'bg-white/10'}`}>
                <span className="block h-full rounded-full bg-white/60 transition-[width] duration-75" style={{ width: `${Math.min(100, Math.round(energy * 140))}%` }} />
              </span>
            </span>
          )}
          {remote.supported && (
            <span
              className="flex items-center gap-1.5"
              title={remote.error ? remote.error : remote.devices.length ? `MIDI: ${remote.devices.map((d) => d.name).join(', ')}` : remote.connected ? 'MIDI ready — pair a BLE-MIDI device' : 'MIDI not authorised — click phone'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${remote.devices.length ? 'bg-white' : remote.connected ? 'bg-white/40' : 'bg-white/20'}`} />
              midi{remote.devices.length ? ` ${remote.devices.length}` : ''}
              {remote.lastNote != null && <span className="tabular-nums text-white/60">· {remote.lastNote}</span>}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full transition-colors ${beat ? 'bg-white' : 'bg-white/20'}`} />
            {bpmEditing ? (
              <input
                autoFocus
                value={bpmInput}
                onChange={(e) => setBpmInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    applyBpm();
                    setBpmEditing(false);
                  } else if (e.key === 'Escape') {
                    setBpmEditing(false);
                  }
                }}
                onBlur={() => {
                  applyBpm();
                  setBpmEditing(false);
                }}
                placeholder="130.1"
                inputMode="decimal"
                className="w-14 rounded-md border border-white/10 bg-transparent px-2 py-0.5 font-mono text-[11px] text-white outline-none placeholder:text-white/20 focus:border-white/40"
              />
            ) : (
              <button onClick={() => setBpmEditing(true)} title="click to set BPM" className="hover:text-white/70">
                {bpm != null ? bpm.toFixed(1) : '—'} bpm
              </button>
            )}
          </span>
          <span className={output === 'live' ? 'text-white/70' : ''}>{output === 'live' ? 'live' : 'preview'}</span>
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-white' : 'bg-white/20'}`} />
            bridge
          </span>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        <Rig3D frameRef={frameRef} mode={rigMode} />
        <div className="absolute left-4 top-3 flex gap-1">
          {(['abstract', 'literal'] as RigMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setRigMode(m)}
              className={`rounded-[4px] border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                rigMode === m ? 'border-white bg-white text-black' : 'border-white/10 text-white/40 hover:border-white/30'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onAction={(a) => dispatchRef.current(a)} onPlayShow={(s) => player.play(s)} />
      </div>

      {micOn && (
        <div className="h-[70px] border-t border-white/10 bg-black">
          <TimelineStrip liveRef={liveRef} />
        </div>
      )}

      {/* sim scrubber — subtle, sits between the timeline and the keyboard */}
      {simName && (
        <div className="flex justify-center border-t border-white/[0.06] bg-black px-5 py-1">
          <div className="flex w-full max-w-2xl items-center gap-2.5">
            <span className="font-mono text-[9px] tabular-nums text-white/25">{fmtTime(simTime)}</span>
            <input
              type="range"
              min={0}
              max={simDur || 0}
              step={0.1}
              value={simTime}
              onChange={(e) => seekSim(Number(e.target.value))}
              className="h-0.5 flex-1 cursor-pointer accent-white/40"
            />
            <span className="font-mono text-[9px] tabular-nums text-white/25">{fmtTime(simDur)}</span>
            <span className="max-w-[8rem] truncate font-mono text-[9px] text-white/20">{simName}</span>
          </div>
        </div>
      )}

      <div className="relative border-t border-white/10 bg-black">
        <KeyboardMap activeKeys={activeKeys} onAction={(a) => dispatchRef.current(a)} />
        {/* interactive controls — bottom-left, stacked vertically */}
        <div className="absolute bottom-2 left-4 flex w-24 flex-col items-stretch gap-1">
          <button
            onClick={() => (simName ? toggleSimPlay() : fileInputRef.current?.click())}
            title={simName ? `sim: ${simName} — play/pause` : 'upload a local audio file as the live input (no hardware)'}
            className={stackBtn(!!simName && !simPaused)}
          >
            {simName ? (simPaused ? '▶ sim' : '❚❚ sim') : 'upload'}
          </button>
          <button onClick={() => dispatchRef.current({ kind: 'toggleLive' })} className={stackBtn(output === 'live')}>
            {output === 'live' ? 'live' : 'preview'}
          </button>
          <div className="relative">
            <button
              onClick={() => {
                setPhoneOpen((v) => !v);
                remote.connect(); // also (re)connect MIDI on this gesture
              }}
              title="phone remote — scan the QR to open it on your phone"
              className={`w-full ${stackBtn(phoneOpen)}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${remote.devices.length ? 'bg-white' : 'bg-white/25'}`} />
              phone
            </button>
            {phoneOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-1.5 w-56 rounded-lg border border-white/15 bg-black p-3 shadow-2xl">
                <div className="mb-2 font-mono text-[11px] text-white/60">scan to open the phone remote</div>
                {remoteUrl && (
                  <div className="flex justify-center rounded bg-white p-2">
                    <QRCodeSVG value={remoteUrl} size={150} />
                  </div>
                )}
                <div className="mt-2 break-all font-mono text-[10px] text-white/40">{remoteUrl}</div>
                {remoteIsLocalhost && (
                  <div className="mt-1 font-mono text-[10px] text-amber-400/80">open /live via your LAN IP (not localhost) so the QR is reachable from the phone</div>
                )}
                <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2">
                  <button onClick={() => setLearnRemote((v) => !v)} className="font-mono text-[10px] text-white/40 hover:text-white/70">
                    {learnRemote ? (remote.learning ? 'tap pad…' : 'tap a key…') : 'midi learn'}
                  </button>
                  <span className="font-mono text-[10px] text-white/30">{remote.devices.length ? `midi ${remote.devices.length}` : 'no midi'}</span>
                </div>
              </div>
            )}
          </div>
          {player.show && (
            <button onClick={() => player.stop()} className={stackBtn(true)}>■ stop</button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) startSim(f);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {/* AutoPilot intensity — where the arrow keys sit (bottom-right). ↑/↓ drive these. */}
        <div className="absolute bottom-2 right-4 flex flex-col items-stretch gap-1">
          <span className="text-center font-mono text-[7px] uppercase tracking-[0.15em] text-white/25">autopilot</span>
          {[
            { v: 1, label: '▲ high' },
            { v: 0, label: 'default' },
            { v: -1, label: '▼ low' },
          ].map(({ v, label }) => {
            const active = autoOn && autoStatus.bias === v;
            return (
              <button
                key={v}
                onClick={() => setAutoMode(v)}
                className={`rounded-[4px] border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors ${
                  active ? 'border-white bg-white text-black' : 'border-white/10 text-white/40 hover:border-white/30'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
