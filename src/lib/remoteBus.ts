// Tiny in-process pub/sub that relays phone-remote commands to the console.
// The phone POSTs to /api/remote/send → emit(); the laptop /live page holds an
// SSE connection to /api/remote/stream → subscribe(). Both run against the same
// Next dev server (one Node process), so a module singleton is all we need.
// Kept on globalThis so it survives dev HMR module reloads.

type Listener = (data: string) => void;

const g = globalThis as unknown as { __lf_remoteBus?: Set<Listener> };
const listeners: Set<Listener> = g.__lf_remoteBus ?? (g.__lf_remoteBus = new Set());

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emit(data: string): void {
  for (const fn of listeners) {
    try {
      fn(data);
    } catch {
      /* a dead stream — ignore */
    }
  }
}
