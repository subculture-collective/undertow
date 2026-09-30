/**
 * Cloud render worker. Claims queued jobs from the API, renders each in
 * headless Chrome using the editor's render page, muxes the original song
 * with ffmpeg, and uploads the MP4. Stateless: run as many as the host allows,
 * on any host that can reach the API. See docs/rendering.md.
 */
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';
import { z } from 'zod';

const env = z.object({
  /** Where the API is reachable from this worker. */
  API_URL: z.string().url().default('http://127.0.0.1:8787'),
  /** Where the editor's render.html is served (the API itself when it serves the editor). */
  EDITOR_URL: z.string().url().optional(),
  WORKER_SECRET: z.string().min(16),
  WORKER_ID: z.string().default(`${hostname()}-${process.pid}`),
  /** Chrome build to launch: an installed channel ("chrome") or a path. Chrome, unlike Chromium, decodes H.264/AAC media. */
  CHROME_CHANNEL: z.string().default('chrome'),
  CHROME_PATH: z.string().optional(),
  RENDER_TIMEOUT_MINUTES: z.coerce.number().positive().default(60),
  FFMPEG: z.string().default('ffmpeg'),
  FFPROBE: z.string().default('ffprobe'),
}).parse(process.env);

const API = env.API_URL.replace(/\/$/, '');
const EDITOR = (env.EDITOR_URL ?? env.API_URL).replace(/\/$/, '');
const workerAuth = { authorization: `Bearer ${env.WORKER_SECRET}` };

interface Claim {
  id: string;
  token: string;
  spec: { name: string; data: { audioAssetId: string | null }; options: { start: number; end: number } };
  media: { mediaId: string; name: string }[];
}

class Cancelled extends Error {}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`))));
  });
}

async function progress(id: string, pct: number) {
  const res = await fetch(`${API}/internal/worker/jobs/${id}/progress`, {
    method: 'POST', headers: { ...workerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ progress: pct }),
  });
  const body = await res.json().catch(() => ({ continue: false })) as { continue: boolean };
  if (!body.continue) throw new Cancelled('The job was cancelled.');
}

async function render(job: Claim, dir: string): Promise<string> {
  const browser = await chromium.launch({
    headless: true,
    ...(env.CHROME_PATH ? { executablePath: env.CHROME_PATH } : { channel: env.CHROME_CHANNEL }),
    args: [
      // Headless machines usually have no GPU; SwiftShader keeps WebGL (Milkdrop) working in software.
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      // WebCodecs only exists in secure contexts. The render page is loaded from an internal
      // address like http://api:8787, which isn't one, so trust exactly that origin.
      `--unsafely-treat-insecure-origin-as-secure=${new URL(EDITOR).origin}`,
    ],
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') log(job.id, 'page error:', m.text()); });
    const deadline = Date.now() + env.RENDER_TIMEOUT_MINUTES * 60_000;
    const download = page.waitForEvent('download', { timeout: env.RENDER_TIMEOUT_MINUTES * 60_000 });
    download.catch(() => {}); // settled below; avoid an unhandled rejection if we bail out first
    await page.goto(`${EDITOR}/render.html?job=${encodeURIComponent(job.id)}&token=${encodeURIComponent(job.token)}`);

    for (;;) {
      // Runs in the page; the worker is compiled without DOM types, hence globalThis.
      const s = await page.evaluate(() => (globalThis as unknown as { __render?: { frame: number; frames: number; done: boolean; error: string | null } }).__render);
      if (s?.error) throw new Error(`Render page: ${s.error}`);
      // Frames are 0-90%; muxing and upload make up the rest.
      await progress(job.id, s?.frames ? (s.frame / s.frames) * 90 : 0);
      if (s?.done) break;
      if (Date.now() > deadline) throw new Error(`Render took longer than ${env.RENDER_TIMEOUT_MINUTES} minutes.`);
      await sleep(2000);
    }
    const file = join(dir, 'video.mp4');
    await (await download).saveAs(file);
    return file;
  } finally {
    await browser.close();
  }
}

/** Adds the original song (AAC) to the rendered video; converts the video to H.264 if the browser produced another codec. */
async function mux(job: Claim, video: string, dir: string): Promise<string> {
  const codec = (await run(env.FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', video])).trim();
  const songId = job.spec.data.audioAssetId;
  let song: string | null = null;
  if (songId && job.media.some((m) => m.mediaId === songId)) {
    const res = await fetch(`${API}/internal/jobs/${job.id}/media/${encodeURIComponent(songId)}`, { headers: { authorization: `Bearer ${job.token}` } });
    if (!res.ok) throw new Error(`Could not fetch the song: HTTP ${res.status}`);
    song = join(dir, 'song');
    await writeFile(song, Buffer.from(await res.arrayBuffer()));
  }
  const { start, end } = job.spec.options;
  const out = join(dir, 'out.mp4');
  const args = ['-y', '-i', video];
  if (song) args.push('-ss', String(start), '-t', String(end - start), '-i', song);
  args.push('-map', '0:v:0');
  if (song) args.push('-map', '1:a:0', '-c:a', 'aac', '-b:a', '256k', '-shortest');
  if (codec === 'h264') args.push('-c:v', 'copy');
  else args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  args.push('-movflags', '+faststart', out);
  await run(env.FFMPEG, args);
  log(job.id, `muxed (video ${codec}${codec === 'h264' ? ', copied' : ' → h264'}${song ? ', AAC audio' : ', no audio'})`);
  return out;
}

async function upload(job: Claim, file: string) {
  const res = await fetch(`${API}/internal/worker/jobs/${job.id}/output`, {
    method: 'PUT',
    headers: { ...workerAuth, 'content-type': 'video/mp4', 'content-length': String((await stat(file)).size) },
    body: createReadStream(file) as unknown as ReadableStream,
    duplex: 'half',
  } as RequestInit);
  if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status} ${await res.text()}`);
}

async function processJob(job: Claim) {
  const dir = await mkdtemp(join(tmpdir(), `undertow-${job.id}-`));
  const t0 = Date.now();
  try {
    log(job.id, `rendering "${job.spec.name}"`);
    const video = await render(job, dir);
    await progress(job.id, 93);
    const out = await mux(job, video, dir);
    await progress(job.id, 97);
    await upload(job, out);
    log(job.id, `done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (e) {
    const cancelled = e instanceof Cancelled;
    log(job.id, cancelled ? 'cancelled' : `failed: ${(e as Error).message}`);
    if (!cancelled) {
      await fetch(`${API}/internal/worker/jobs/${job.id}/fail`, {
        method: 'POST', headers: { ...workerAuth, 'content-type': 'application/json' },
        body: JSON.stringify({ error: (e as Error).message.slice(0, 500) }),
      }).catch(() => {});
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { stopping = true; log('stopping after the current job'); });

log(`worker ${env.WORKER_ID}: API ${API}, render page ${EDITOR}`);
while (!stopping) {
  try {
    const res = await fetch(`${API}/internal/worker/claim`, {
      method: 'POST', headers: { ...workerAuth, 'content-type': 'application/json' }, body: JSON.stringify({ workerId: env.WORKER_ID }),
    });
    if (res.status === 204) { await sleep(5000); continue; }
    if (!res.ok) throw new Error(`claim: HTTP ${res.status}`);
    await processJob(await res.json() as Claim);
  } catch (e) {
    log('worker error:', (e as Error).message);
    await sleep(10_000);
  }
}
