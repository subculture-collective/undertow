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
// output_bytes is a PostgreSQL integer. Reject before writing past its representable size.
const MAX_OUTPUT_BYTES = 2 ** 31 - 1;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Mutations must belong to the current claim, not just to a trusted worker. */
function claimHash(c: { req: { header(name: string): string | undefined } }) {
  requireWorker(c.req.header('authorization'));
  const token = c.req.header('x-job-token');
  if (!token) fail(409, 'A current job token is required.');
  return sha(token);
}

async function lockClaim(tx: Transaction, id: string, tokenHash: string) {
  const [job] = await tx.select().from(renderJob).where(eq(renderJob.id, id)).for('update');
  if (!job || job.status !== 'running' || job.tokenHash !== tokenHash) fail(409, 'This worker claim is no longer current.');
  return job;
}

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
  // Terminal files are removed by hourly reconciliation, which also retries failed deletions.
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
  const tokenHash = claimHash(c);
  const { progress } = await c.req.json<{ progress: number }>();
  const [row] = await db.update(renderJob)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), heartbeatAt: new Date() })
    .where(and(eq(renderJob.id, c.req.param('id')), eq(renderJob.status, 'running'), eq(renderJob.tokenHash, tokenHash))).returning({ id: renderJob.id });
  if (!row) fail(409, 'This worker claim is no longer current.');
  return c.json({ continue: true });
});

worker.put('/worker/jobs/:id/output', async (c) => {
  const tokenHash = claimHash(c);
  const id = c.req.param('id');
  if (!c.req.raw.body) fail(422, 'Send the MP4 as the body.');
  const body = c.req.raw.body;
  // Keep cancellation, retry and another output writer out until the file and state agree.
  await db.transaction(async (tx) => {
    const job = await lockClaim(tx, id, tokenHash);
    const bytes = await storage.put(`${id}/output.mp4`, body, MAX_OUTPUT_BYTES);
    await tx.update(renderJob).set({
      status: 'done', progress: 100, outputBytes: bytes, finishedAt: new Date(), tokenHash: null,
      expiresAt: new Date(Date.now() + env.RENDER_OUTPUT_DAYS * 86_400_000),
    }).where(eq(renderJob.id, id));
    // Billable units and the completed status commit together.
    await tx.insert(usageEvent).values({
      userId: job.userId, apiKeyId: job.apiKeyId, method: 'RENDER', route: '/v1/renders', status: 200, units: job.durationSeconds,
    });
  });
  await storage.removeInputs(id).catch((error) => console.error('Render input cleanup failed', { jobId: id, error }));
  return c.body(null, 204);
});

worker.post('/worker/jobs/:id/fail', async (c) => {
  const tokenHash = claimHash(c);
  const { error } = await c.req.json<{ error: string }>();
  const id = c.req.param('id');
  await db.transaction(async (tx) => {
    await lockClaim(tx, id, tokenHash);
    await tx.update(renderJob).set({ status: 'failed', error: String(error).slice(0, 500), finishedAt: new Date(), tokenHash: null })
      .where(eq(renderJob.id, id));
    await storage.removeJob(id);
  });
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
