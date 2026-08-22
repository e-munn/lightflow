import { readFile } from 'fs/promises';
import { join } from 'path';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const dynamic = 'force-static';


async function md(rel: string): Promise<string> {
  try {
    return await readFile(join(process.cwd(), rel), 'utf8');
  } catch {
    return `_(${rel} not available)_`;
  }
}

export default async function DocsPage() {
  const [readme, roadmap] = await Promise.all([md('README.md'), md('docs/ML_ROADMAP.md')]);
  const body = `${readme}\n\n---\n\n${roadmap}`;
  return (
    <main className="min-h-[100dvh] bg-black text-white">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <nav className="mb-8 flex gap-4 font-mono text-xs text-white/50">
          <Link href="/" className="hover:text-white">← home</Link>
          <Link href="/live" className="hover:text-white">live</Link>
          <Link href="/player" className="hover:text-white">player</Link>
        </nav>
        <article className="docs">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
        </article>
      </div>
    </main>
  );
}
