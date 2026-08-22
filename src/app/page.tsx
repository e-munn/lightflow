import Link from 'next/link';

const LINKS = [
  { href: '/live', label: 'LIVE', desc: 'Live console: mic + tap tempo, scenes, AutoPilot, DMX out' },
  { href: '/player', label: 'PLAYER', desc: 'Automated show: analyzed songs, Director, Scout, on-screen rig' },
  { href: '/docs', label: 'DOCS', desc: 'How it works: architecture, signal pipeline, roadmap' },
];

export default function Home() {
  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-black px-6 text-white">
      <h1 className="font-mono text-3xl tracking-tight">lightflow</h1>
      <p className="mt-2 font-mono text-xs text-white/50">audio-reactive lighting</p>
      <nav className="mt-10 flex w-full max-w-sm flex-col gap-3">
        {LINKS.map(({ href, label, desc }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col gap-1 rounded-2xl border border-white/15 px-5 py-4 font-mono transition-colors hover:bg-white hover:text-black active:bg-white active:text-black"
          >
            <span className="text-sm tracking-wide">{label}</span>
            <span className="text-[11px] opacity-60">{desc}</span>
          </Link>
        ))}
      </nav>
    </main>
  );
}
