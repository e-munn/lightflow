import Link from 'next/link';

export default function Home() {
  return (
    <main className="relative flex min-h-[100dvh] flex-col items-center justify-center bg-black px-6 text-white">
      <h1 className="font-mono text-3xl tracking-tight">lightflow</h1>
      <p className="mt-2 font-mono text-xs text-white/50">audio-reactive lighting</p>
      <nav className="mt-10 flex w-full max-w-sm flex-col gap-3">
        <Link
          href="/player"
          className="flex flex-col gap-1 rounded-2xl border border-white bg-white px-5 py-5 font-mono text-black transition-opacity hover:opacity-90 active:opacity-80"
        >
          <span className="text-base tracking-wide">PLAYER</span>
          <span className="text-[11px] opacity-60">Automated show: analyzed songs, Director, Scout, on-screen rig</span>
        </Link>
        <Link
          href="/live"
          className="flex flex-col gap-1 rounded-2xl border border-white/20 px-5 py-4 font-mono transition-colors hover:border-white/60 active:bg-white active:text-black"
        >
          <span className="text-sm tracking-wide">CONTROLLER</span>
          <span className="text-[11px] opacity-60">Live console: mic + tap tempo, scenes, AutoPilot, DMX out</span>
        </Link>
      </nav>
      <a
        href="https://github.com/e-munn/lightflow"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-5 left-6 font-mono text-[11px] text-white/40 hover:text-white"
      >
        github
      </a>
      <Link href="/docs" className="absolute bottom-5 right-6 font-mono text-[11px] text-white/40 hover:text-white">
        docs
      </Link>
    </main>
  );
}
