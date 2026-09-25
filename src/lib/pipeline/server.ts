import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Source, PipelineEvent, RunJob, Snapshot, Note, IdentityReview, MovementAnalysis, CueReview } from './types';
import { validateReview } from './reviews';

export const ROOT = '/Volumes/ExtremePro/Movies/Assets/lightflow_research/dance';
const RUNS = path.join(ROOT, 'runs');
const registry = path.join(process.cwd(), 'research/dance/sources.json');
const runtimeFile = path.join(process.cwd(), 'research/dance/runtime.local.json');
export async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function json<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, 'utf8')); }
async function optional<T>(file: string): Promise<T | null> { try { return await json<T>(file); } catch { return null; } }
export async function driveReady() {
  try { return (await stat('/Volumes/ExtremePro')).dev !== (await stat('/Volumes')).dev && (await stat(ROOT)).isDirectory(); } catch { return false; }
}
export function guard(request: Request, mutation = false) {
  const url = new URL(request.url);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Pipeline is local-only. Open it on localhost with SanDisk connected.');
  if (mutation && request.headers.get('origin') !== url.origin) throw Error('Same-origin request required');
}
export function runDirectory(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw Error('Invalid run ID');
  return path.join(RUNS, id);
}
export async function sources(): Promise<Source[]> {
  const data = await json<{ pilot: Source; additional_references?: Source[] }>(registry);
  return Promise.all([data.pilot, ...(data.additional_references ?? [])].map(async source => ({ ...source, available: await exists(path.join(source.local_directory, `${source.video_id}.mkv`)) })));
}
async function records<T>(directory: string): Promise<T[]> {
  const names = await readdir(directory).catch(() => [] as string[]);
  const values = await Promise.all(names.filter(n => n.endsWith('.json')).sort().map(n => optional<T>(path.join(directory, n))));
  return values.filter(v => v !== null) as T[];
}
function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
export async function snapshot(id: string): Promise<Snapshot> {
  const dir = runDirectory(id);
  const job = await json<RunJob>(path.join(dir, 'job.json'));
  const [events, notes, result, waveform, chunks, preview, audio, worker, reviews] = await Promise.all([
    records<PipelineEvent>(path.join(dir, 'events')), records<Note>(path.join(dir, 'notes')),
    optional<Snapshot['result']>(path.join(dir, 'result.json')),
    optional<Snapshot['waveform']>(path.join(dir, 'waveform.json')),
    // Catalog/status requests need the chunk count, not every landmark in every run.
    readdir(path.join(dir, 'frames')).then(names => names.filter(n => n.endsWith('.json'))).catch(() => [] as string[]),
    exists(path.join(dir, 'preview.mp4')), exists(path.join(dir, 'audio.m4a')),
    optional<{ pid: number }>(path.join(dir, 'worker.json')),
    records<IdentityReview>(path.join(dir, 'reviews')),
  ]);
  const terminal = [...events].reverse().find(e => ['complete', 'error', 'cancelled'].includes(e.stage));
  let state = terminal?.stage ?? 'running';
  if (!terminal && worker && !alive(worker.pid)) state = 'interrupted';
  if (!terminal && !worker && Date.now() - Date.parse(job.createdAt) > 15000) state = 'interrupted';
  // File existence alone does not mean ffmpeg has finished writing its MP4.
  return { job, state, events, notes, reviews, result, waveform, chunks: chunks.length,
    preview: preview && events.some(e => e.stage === 'audio'), audio: audio && waveform !== null };
}
export async function catalog() {
  const drive = await driveReady();
  const names = drive ? await readdir(RUNS).catch(() => [] as string[]) : [];
  const runs = await Promise.all(names.filter(n => /^[0-9a-f-]{36}$/.test(n)).map(async id => {
    try { const s = await snapshot(id); return { ...s.job, state: s.state }; } catch { return null; }
  }));
  const config = await optional<{ python: string; model: string }>(runtimeFile);
  return { sources: await sources(), drive, ready: !!config && await exists(config.python) && await exists(config.model),
    runs: runs.filter(r => r !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };
}
let starting = false;
export async function startRun(sourceId: string, start: number, duration: number) {
  if (starting) throw Error('Another run is starting');
  starting = true;
  try {
    if (!await driveReady()) throw Error('Connect SanDisk ExtremePro before processing');
    const source = (await sources()).find(s => s.video_id === sourceId);
    if (!source?.available) throw Error('Source video unavailable');
    if (!Number.isFinite(start) || !Number.isFinite(duration) || start < 0 || duration < 2 || duration > 60 || start + duration > source.duration_seconds) throw Error('Choose a 2–60 second passage within the source video');
    const current = await catalog();
    if (current.runs.some(r => r.state === 'running')) throw Error('A run is already processing. Wait or cancel it first.');
    const config = await json<{ python: string; model: string }>(runtimeFile);
    await access(config.python); await access(config.model);
    const id = randomUUID(), dir = runDirectory(id);
    await mkdir(RUNS, { recursive: true });
    await mkdir(dir); // Exclusive run; never reuse an existing directory.
    for (const sub of ['events', 'frames', 'notes', 'reviews']) await mkdir(path.join(dir, sub));
    const job: RunJob = { id, sourceId, title: source.title, start, duration,
      createdAt: new Date().toISOString(), sourcePath: path.join(source.local_directory, `${sourceId}.mkv`), trackingMode: 'solo' };
    await writeFile(path.join(dir, 'job.json'), JSON.stringify(job), { flag: 'wx' });
    const log = openSync(path.join(dir, 'worker.log'), 'wx');
    try {
      const child = spawn(config.python, [path.join(process.cwd(), 'research/dance/process.py'), '--run', dir], {
        cwd: process.cwd(), detached: true, stdio: ['ignore', log, log],
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', MPLCONFIGDIR: path.join(dir, 'mpl-cache') },
      });
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      await writeFile(path.join(dir, 'worker.json'), JSON.stringify({ pid: child.pid }), { flag: 'wx' });
      child.once('exit', (code, signal) => {
        if (code === 0) return;
        void writeFile(path.join(dir, 'events', 'zz-worker-exit.json'), JSON.stringify({
          id: 1000000, wallTime: Date.now() / 1000, t: null, stage: 'error',
          message: `Worker exited with ${signal ?? `code ${code}`}. See Worker log for diagnostics. Existing outputs are retained.`,
        }), { flag: 'wx' }).catch(() => {});
      });
      child.unref();
    } finally { closeSync(log); }
    return id;
  } finally { starting = false; }
}
export async function frames(id: string) { return (await records<unknown[]>(path.join(runDirectory(id), 'frames'))).flat(); }
export async function addNote(id: string, t: number, text: string) {
  const s = await snapshot(id);
  if (!Number.isFinite(t) || t < 0 || t > s.job.duration + 1 || !text.trim() || text.length > 4000) throw Error('Invalid timestamp or note (maximum 4000 characters)');
  const note = { id: randomUUID(), t, text: text.trim(), createdAt: new Date().toISOString() };
  await writeFile(path.join(runDirectory(id), 'notes', `${note.id}.json`), JSON.stringify(note), { flag: 'wx' });
  return note;
}
export async function cancelRun(id: string) {
  const s = await snapshot(id);
  if (s.state !== 'running') throw Error('Run is not processing');
  const file = path.join(runDirectory(id), 'cancel.json');
  if (!await exists(file)) await writeFile(file, JSON.stringify({ at: new Date().toISOString() }), { flag: 'wx' });
}

export async function addReview(id: string, value: unknown) {
  const s = await snapshot(id);
  if (s.state !== 'complete') throw Error('Wait for a complete run before recording identity review');
  const review: IdentityReview = { ...validateReview(value, Math.min(s.job.duration, s.result?.duration ?? s.job.duration)), id: randomUUID(), createdAt: new Date().toISOString() };
  const dir = path.join(runDirectory(id), 'reviews');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${review.id}.json`), JSON.stringify(review), { flag: 'wx' });
  return review;
}

export async function movementAnalysis(id: string) {
  const dir = runDirectory(id);
  const analyses = await records<MovementAnalysis>(path.join(dir, 'analyses'));
  const reviews = await records<CueReview>(path.join(dir, 'cue-reviews'));
  return { analysis: analyses.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null, reviews };
}

const analyzing = new Set<string>();
export async function analyzeMovement(id: string) {
  const s = await snapshot(id);
  if (!await driveReady()) throw Error('Connect SanDisk before analyzing');
  if (s.state !== 'complete' || s.job.trackingMode !== 'solo') throw Error('Complete a strict solo run first');
  if (analyzing.has(id)) throw Error('Movement analysis is already running for this passage');
  analyzing.add(id);
  try {
    const config = await json<{ python: string }>(runtimeFile);
    await promisify(execFile)(config.python, [path.join(process.cwd(), 'research/dance/analyze.py'), '--run', runDirectory(id)], {
      cwd: process.cwd(), timeout: 120000, maxBuffer: 1024 * 1024,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    return await movementAnalysis(id);
  } finally { analyzing.delete(id); }
}

export async function addCueReview(id: string, value: unknown) {
  if (!value || typeof value !== 'object') throw Error('Cue review required');
  const r = value as Record<string, unknown>;
  if (typeof r.analysisId !== 'string' || !/^[0-9a-f-]{36}$/.test(r.analysisId) || typeof r.candidateId !== 'string'
      || !['keep', 'reject'].includes(String(r.judgment)) || !['user', 'assistant', 'automated'].includes(String(r.reviewer))
      || typeof r.text !== 'string' || !r.text.trim() || r.text.length > 2000) throw Error('Invalid cue review');
  const analysis = await json<MovementAnalysis>(path.join(runDirectory(id), 'analyses', `${r.analysisId}.json`));
  if (!analysis.candidates.some(c => c.id === r.candidateId)) throw Error('Unknown movement cue');
  const record: CueReview = { id: randomUUID(), analysisId: r.analysisId, candidateId: r.candidateId,
    judgment: r.judgment as CueReview['judgment'], text: r.text.trim(), reviewer: r.reviewer as CueReview['reviewer'], createdAt: new Date().toISOString() };
  const dir = path.join(runDirectory(id), 'cue-reviews');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${record.id}.json`), JSON.stringify(record), { flag: 'wx' });
  return record;
}
