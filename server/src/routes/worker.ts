/**
 * Internal routes for the render worker and the render page it drives. Not
 * part of the public API or its documentation.
 *
 * - The worker authenticates with WORKER_SECRET to claim jobs and report on them.
 * - Claiming issues a one-job token; the render page (and the worker) use it to
 *   read that job's layout and files while the job is running.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/index.js';
import { renderJob, renderMedia, usageEvent } from '../db/schema.js';
import { env } from '../env.js';
import { fail } from '../lib/problem.js';
import { storage } from '../lib/storage.js';

export const worker = new Hono();

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const bearer = (h: string | undefined) => h?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';

/** A worker that hasn't reported for this long is presumed dead; its job is retried once, then failed. */
const STALE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 2;
const MAX_OUTPUT_BYTES = 4 * 1024 ** 3;

function requireWorker(auth: string | undefined) {
  const given = Buffer.from(bearer(auth));
  const want = Buffer.from(env.WORKER_SECRET);
  if (!env.WORKER_SECRET || given.length !== want.length || !timingSafeEqual(given, want)) fail(401, 'Worker secret required.');
}

/** The job, if the token matches it and it is running. */
async function jobForToken(id: string, auth: string | undefined) {
  const token = bearer(auth);
  const job = await db.query.renderJob.findFirst({ where: eq(renderJob.id, id) });
  if (!token || !job?.tokenHash || job.status !== 'running' || sha(token) !== job.tokenHash) fail(401, 'Invalid or expired job token.');
  return job;
}

async function requeueStale() {
  const cutoff = new Date(Date.now() - STALE_MS);
  await db.update(renderJob).set({ status: 'failed', error: 'The render stopped responding.', finishedAt: new Date(), tokenHash: null })
    .where(and(eq(renderJob.status, 'running'), lt(renderJob.heartbeatAt, cutoff), sql`${renderJob.attempts} >= ${MAX_ATTEMPTS}`));
  await db.update(renderJob).set({ status: 'queued', tokenHash: null, workerId: null })
    .where(and(eq(renderJob.status, 'running'), lt(renderJob.heartbeatAt, cutoff)));
}

// ---- worker ----------------------------------------------------------------------------------------------
worker.post('/worker/claim', async (c) => {
  requireWorker(c.req.header('authorization'));
  const { workerId } = await c.req.json<{ workerId?: string }>().catch(() => ({ workerId: undefined }));
  await requeueStale();
  const token = `rjt_${randomBytes(24).toString('base64url')}`;
  // SKIP LOCKED lets several workers claim concurrently without taking the same job.
  const { rows } = await db.execute<{ id: string }>(sql`
    update render_job set status = 'running', worker_id = ${workerId ?? 'worker'}, token_hash = ${sha(token)},
      attempts = attempts + 1, started_at = now(), heartbeat_at = now(), progress = 0
    where id = (select id from render_job where status = 'queued' order by created_at for update skip locked limit 1)
    returning id`);
  if (!rows.length) return c.body(null, 204);
  const job = (await db.query.renderJob.findFirst({ where: eq(renderJob.id, rows[0].id) }))!;
  const media = await db.select().from(renderMedia).where(eq(renderMedia.jobId, job.id));
  return c.json({ id: job.id, token, spec: job.spec, media: media.map(({ mediaId, kind, name, mime, size }) => ({ mediaId, kind, name, mime, size })) });
});

worker.post('/worker/jobs/:id/progress', async (c) => {
  requireWorker(c.req.header('authorization'));
  const { progress } = await c.req.json<{ progress: number }>();
  const [row] = await db.update(renderJob)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), heartbeatAt: new Date() })
    .where(and(eq(renderJob.id, c.req.param('id')), eq(renderJob.status, 'running'))).returning({ id: renderJob.id });
  // If the job is no longer running (cancelled by its owner, or failed as stale), the worker should stop.
  return c.json({ continue: !!row });
});

worker.put('/worker/jobs/:id/output', async (c) => {
  requireWorker(c.req.header('authorization'));
  const id = c.req.param('id');
  const job = await db.query.renderJob.findFirst({ where: eq(renderJob.id, id) });
  if (!job || job.status !== 'running') fail(409, 'The job is not running.');
  if (!c.req.raw.body) fail(422, 'Send the MP4 as the body.');
  const bytes = await storage.put(`${id}/output.mp4`, c.req.raw.body, MAX_OUTPUT_BYTES);
  const [done] = await db.update(renderJob).set({
    status: 'done', progress: 100, outputBytes: bytes, finishedAt: new Date(), tokenHash: null,
    expiresAt: new Date(Date.now() + env.RENDER_OUTPUT_DAYS * 86_400_000),
  }).where(and(eq(renderJob.id, id), eq(renderJob.status, 'running'))).returning();
  if (!done) { await storage.removeJob(id); fail(409, 'The job was cancelled while uploading.'); }
  await storage.removeInputs(id);
  // Billable units for rendering are seconds of video.
  await db.insert(usageEvent).values({
    userId: done.userId, apiKeyId: done.apiKeyId, method: 'RENDER', route: '/v1/renders', status: 200, units: done.durationSeconds,
  });
  return c.body(null, 204);
});

worker.post('/worker/jobs/:id/fail', async (c) => {
  requireWorker(c.req.header('authorization'));
  const { error } = await c.req.json<{ error: string }>();
  const id = c.req.param('id');
  await db.update(renderJob).set({ status: 'failed', error: String(error).slice(0, 500), finishedAt: new Date(), tokenHash: null })
    .where(and(eq(renderJob.id, id), eq(renderJob.status, 'running')));
  await storage.removeJob(id);
  return c.body(null, 204);
});

// ---- render page (job token) ----------------------------------------------------------------------------------
worker.get('/jobs/:id/spec', async (c) => {
  const job = await jobForToken(c.req.param('id'), c.req.header('authorization'));
  const media = await db.select().from(renderMedia).where(eq(renderMedia.jobId, job.id));
  return c.json({ spec: job.spec, media: media.map(({ mediaId, kind, name, mime, size }) => ({ mediaId, kind, name, mime, size })) });
});

worker.get('/jobs/:id/media/:mediaId', async (c) => {
  const job = await jobForToken(c.req.param('id'), c.req.header('authorization'));
  const m = await db.query.renderMedia.findFirst({ where: and(eq(renderMedia.jobId, job.id), eq(renderMedia.mediaId, c.req.param('mediaId'))) });
  if (!m) fail(404);
  return c.body(storage.read(`${job.id}/media-${m.mediaId}`), 200, { 'content-type': m.mime, 'content-length': String(m.size) });
});
