'use client';

// Cmd+K command palette — fuzzy-search every song/command/scene/colour by name,
// caption, group, or key. Songs come first (pick one to play its tailored
// show); then the live commands. Arrow keys to move, Enter to run, Esc to close.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Action, COMMANDS } from '@/lib/commands';
import { SHOW_LIST, Show } from '@/lib/shows';

interface Item {
  id: string;
  cap: string; // keycap / badge label
  label: string;
  sub?: string; // muted secondary text (e.g. song artist)
  group: string;
  accent?: string; // tinted dot for colour caps
  haystack: string; // lowercased search text
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onAction,
  onPlayShow,
}: {
  open: boolean;
  onClose: () => void;
  onAction: (a: Action) => void;
  onPlayShow?: (show: Show) => void;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Songs first, then commands — one flat, searchable list.
  const items = useMemo<Item[]>(() => {
    const songs: Item[] = SHOW_LIST.map((s) => ({
      id: `show-${s.slug}`,
      cap: '▶',
      label: s.title,
      sub: s.artist,
      group: 'Songs',
      haystack: `${s.title} ${s.artist} song show play ${s.slug}`.toLowerCase(),
      run: () => onPlayShow?.(s),
    }));
    const cmds: Item[] = COMMANDS.map((c) => ({
      id: c.id,
      cap: c.cap,
      label: c.label,
      group: c.group,
      accent: c.accent,
      haystack: [c.label, c.caption, c.group, c.cap].join(' ').toLowerCase(),
      run: () => onAction(c.action),
    }));
    return [...songs, ...cmds];
  }, [onAction, onPlayShow]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return items;
    return items.filter((it) => it.haystack.includes(t));
  }, [q, items]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      // focus after paint
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const run = (i: number) => {
    const it = results[i];
    if (!it) return;
    it.run();
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center bg-black/70 pt-[12vh]" onClick={onClose}>
      <div
        className="w-[34rem] max-w-[90vw] overflow-hidden rounded-xl border border-white/15 bg-black shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search songs, scenes, colors, commands…"
          className="w-full bg-transparent px-4 py-3 font-mono text-sm text-white outline-none placeholder:text-white/30"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, results.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(sel);
            }
          }}
        />
        <div className="max-h-[50vh] overflow-y-auto border-t border-white/10">
          {results.length === 0 && <div className="px-4 py-3 font-mono text-xs text-white/30">no matches</div>}
          {results.map((it, i) => (
            <button
              key={it.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(i)}
              className={`flex w-full items-center gap-3 px-4 py-1.5 text-left ${i === sel ? 'bg-white/10' : ''}`}
            >
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded border border-white/15 px-1 font-mono text-[10px] text-white/60"
                style={it.accent ? { background: it.accent, color: '#000', borderColor: 'transparent' } : undefined}
              >
                {it.cap}
              </span>
              <span className="font-mono text-xs text-white">{it.label}</span>
              {it.sub && <span className="font-mono text-[10px] text-white/40">{it.sub}</span>}
              <span className="ml-auto font-mono text-[9px] uppercase tracking-wide text-white/30">{it.group}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
