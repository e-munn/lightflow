import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { driveReady, guard, ROOT } from '@/lib/pipeline/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    guard(request);
    if (!await driveReady()) throw Error('Connect SanDisk ExtremePro to load the research model.');
    const config = JSON.parse(await readFile(path.join(process.cwd(), 'research/dance/training.local.json'), 'utf8'));
    const directory = path.resolve(config.directory);
    if (path.dirname(directory) !== ROOT || !/^audio-model-[a-zA-Z0-9_-]+$/.test(path.basename(directory))) throw Error('Invalid model directory');
    const run = new URL(request.url).searchParams.get('run');
    if (run) {
      if (!/^[0-9a-f-]{36}$/.test(run)) throw Error('Invalid run ID');
      return Response.json(JSON.parse(await readFile(path.join(directory, `${run}.json`), 'utf8')), { headers: { 'Cache-Control': 'no-store' } });
    }
    const [model, report] = await Promise.all(['model.json', 'report.json'].map(async name => JSON.parse(await readFile(path.join(directory, name), 'utf8'))));
    return Response.json({ model, report }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return Response.json({ error: e instanceof Error && !e.message.includes('ENOENT') ? e.message : 'The first training run is not ready yet.' }, { status: 503 });
  }
}
