/**
 * Cloud rendering. A job is created with the layout, its options and a list
 * of the files it uses; the client uploads each file, then starts the job.
 * A worker renders it in headless Chrome with the editor's own export code.
 * Uploaded files are deleted when the job ends; the output is kept for
 * RENDER_OUTPUT_DAYS.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { project, renderJob, renderMedia } from '../db/schema.js';
import { requireCaller } from '../lib/caller.js';
import { newId } from '../lib/ids.js';
import { fail, problems } from '../lib/problem.js';
import { iso, json, router, secured } from '../lib/router.js';
import { storage } from '../lib/storage.js';
import { CreateRender, IdParam, ProjectData, RenderJob, RenderOptions, RenderUpload } from '../schemas.js';

export const renders = router();
renders.use('/renders/*', requireCaller); // also matches '/renders'

type Job = typeof renderJob.$inferSelect;
type Spec = { name: string; data: z.infer<typeof ProjectData>; options: z.infer<typeof RenderOptions> };

/** Jobs that count against the month's minutes: anything not cancelled or failed. */
const COUNTED = ['awaiting_upload', 'queued', 'running', 'done', 'expired'];

export async function renderSecondsThisMonth(userId: string) {
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [row] = await db.select({ s: sql<number>`coalesce(sum(${renderJob.durationSeconds}), 0)::int` }).from(renderJob)
    .where(and(eq(renderJob.userId, userId), gte(renderJob.createdAt, monthStart), inArray(renderJob.status, COUNTED)));
  return row.s;
}

async function view(job: Job) {
  const uploads = await db.select().from(renderMedia).where(eq(renderMedia.jobId, job.id));
  const spec = job.spec as Spec;
  return {
    id: job.id, status: job.status as z.infer<typeof RenderJob>['status'], progress: job.progress, name: spec.name,
    options: spec.options, durationSeconds: job.durationSeconds, error: job.error,
    uploads: uploads.map((u) => ({ mediaId: u.mediaId, kind: u.kind as z.infer<typeof RenderUpload>['kind'], name: u.name, size: u.size, uploaded: u.uploaded })),
    outputBytes: job.outputBytes, createdAt: iso(job.createdAt)!, finishedAt: iso(job.finishedAt), expiresAt: iso(job.expiresAt),
  };
}

async function own(id: string, userId: string) {
  const job = await db.query.renderJob.findFirst({ where: and(eq(renderJob.id, id), eq(renderJob.userId, userId)) });
  if (!job) fail(404, 'No render with that id in this account.');
  return job;
}

/** Asset ids a layout refers to: the song, layer files and uploaded fonts ("vz-<id>" families). */
function referencedIds(data: z.infer<typeof ProjectData>) {
  const ids = new Set<string>();
  if (data.audioAssetId) ids.add(data.audioAssetId);
  for (const l of data.layers) {
    const props = (l as { props?: { assetId?: string | null; font?: string } }).props;
    if (props?.assetId) ids.add(props.assetId);
    if (props?.font?.startsWith('vz-')) ids.add(props.font.slice(3));
  }
  return ids;
}

renders.openapi(createRoute({
  method: 'post', path: '/renders', tags: ['Rendering'], security: secured,
  summary: 'Create a render job',
  description: 'Returns the job with the files to upload. Upload each with PUT /v1/renders/{id}/media/{mediaId}, then POST /v1/renders/{id}/start. Counts against the plan\'s monthly render minutes from creation; cancelled and failed jobs are refunded.',
  request: { body: { content: { 'application/json': { schema: CreateRender } }, required: true } },
  responses: { 201: json(RenderJob, 'The job, awaiting uploads'), ...problems(401, 403, 404, 422, 429) },
}), async (c) => {
  const body = c.req.valid('json');
  const { userId, apiKeyId, plan, planName } = c.get('caller');
  if (plan.renderMinutesPerMonth <= 0) fail(403, `Cloud rendering isn't included in the ${planName} plan.`);

  let data = body.data, name = data?.name ?? 'Render';
  if (body.projectId) {
    const p = await db.query.project.findFirst({ where: and(eq(project.id, body.projectId), eq(project.userId, userId)) });
    if (!p) fail(404, 'No project with that id in this account.');
    data = p.data as z.infer<typeof ProjectData>;
    name = p.name;
  }
  const o = body.options;
  const seconds = Math.ceil(o.end - o.start);
  if (o.shortSide > plan.renderMaxShortSide) fail(403, `Your plan renders up to ${plan.renderMaxShortSide}p.`);
  if (seconds > plan.renderMaxSeconds) fail(403, `Your plan renders up to ${Math.floor(plan.renderMaxSeconds / 60)} minutes per video.`);
  const used = await renderSecondsThisMonth(userId);
  if (used + seconds > plan.renderMinutesPerMonth * 60) {
    fail(403, `This render needs ${seconds} s; ${Math.max(0, plan.renderMinutesPerMonth * 60 - used)} s of this month's ${plan.renderMinutesPerMonth} minutes are left.`);
  }
  const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(renderJob)
    .where(and(eq(renderJob.userId, userId), inArray(renderJob.status, ['awaiting_upload', 'queued', 'running'])));
  if (active >= 3) fail(429, 'You have 3 renders in progress. Wait for one to finish or cancel it.');

  // Only files the layout actually uses are uploaded; every one it uses must be listed.
  const needed = referencedIds(data!);
  const media = body.media.filter((m) => needed.has(m.id));
  const missing = [...needed].filter((id) => !media.some((m) => m.id === id));
  if (missing.length) fail(422, `The layout uses files not listed in media: ${missing.join(', ')}.`);
  const total = media.reduce((s, m) => s + m.size, 0);
  if (total > plan.renderMaxUploadBytes) fail(403, `These files total ${Math.round(total / 1e6)} MB; your plan allows ${Math.round(plan.renderMaxUploadBytes / 1e6)} MB per render.`);

  const id = newId('rnd');
  const spec: Spec = { name, data: data!, options: o };
  const job = await db.transaction(async (tx) => {
    const [j] = await tx.insert(renderJob).values({ id, userId, apiKeyId, spec, durationSeconds: seconds }).returning();
    if (media.length) await tx.insert(renderMedia).values(media.map((m) => ({ jobId: id, mediaId: m.id, kind: m.kind, name: m.name, mime: m.mime, size: m.size })));
    return j;
  });
  return c.json(await view(job), 201);
});

renders.openapi(createRoute({
  method: 'put', path: '/renders/{id}/media/{mediaId}', tags: ['Rendering'], security: secured,
  summary: 'Upload one of the job\'s files (raw bytes, exactly the declared size)',
  request: {
    params: IdParam.extend({ mediaId: z.string().min(1).max(64).openapi({ param: { name: 'mediaId', in: 'path' } }) }),
    body: { content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } }, required: true },
  },
  responses: { 204: { description: 'Stored' }, ...problems(401, 404, 409, 413, 422, 429) },
}), async (c) => {
  const { id, mediaId } = c.req.valid('param');
  const job = await own(id, c.get('caller').userId);
  if (job.status !== 'awaiting_upload') fail(409, `The job is ${job.status}; files can only be uploaded before it starts.`);
  const m = await db.query.renderMedia.findFirst({ where: and(eq(renderMedia.jobId, id), eq(renderMedia.mediaId, mediaId)) });
  if (!m) fail(404, 'This job has no file with that id.');
  if (!c.req.raw.body) fail(422, 'Send the file as the request body.');
  let bytes: number;
  try {
    bytes = await storage.put(`${id}/media-${mediaId}`, c.req.raw.body, m.size);
  } catch {
    fail(413, `The file is larger than the ${m.size} bytes declared.`);
  }
  if (bytes !== m.size) fail(422, `Received ${bytes} bytes; ${m.size} were declared.`);
  await db.update(renderMedia).set({ uploaded: true }).where(and(eq(renderMedia.jobId, id), eq(renderMedia.mediaId, mediaId)));
  return c.body(null, 204);
});

renders.openapi(createRoute({
  method: 'post', path: '/renders/{id}/start', tags: ['Rendering'], security: secured,
  summary: 'Queue the job once every file is uploaded',
  request: { params: IdParam },
  responses: { 200: json(RenderJob, 'The queued job'), ...problems(401, 404, 409, 429) },
}), async (c) => {
  const { id } = c.req.valid('param');
  const job = await own(id, c.get('caller').userId);
  if (job.status !== 'awaiting_upload') fail(409, `The job is already ${job.status}.`);
  const pending = await db.select({ name: renderMedia.name }).from(renderMedia).where(and(eq(renderMedia.jobId, id), eq(renderMedia.uploaded, false)));
  if (pending.length) fail(409, `Still waiting for: ${pending.map((p) => p.name).join(', ')}.`);
  const [queued] = await db.update(renderJob).set({ status: 'queued' }).where(and(eq(renderJob.id, id), eq(renderJob.status, 'awaiting_upload'))).returning();
  if (!queued) fail(409, 'The job changed while starting. Fetch it again.');
  return c.json(await view(queued), 200);
});

renders.openapi(createRoute({
  method: 'get', path: '/renders', tags: ['Rendering'], security: secured, summary: 'Your 50 most recent render jobs',
  responses: { 200: json(z.array(RenderJob), 'Jobs, newest first'), ...problems(401, 429) },
}), async (c) => {
  const jobs = await db.select().from(renderJob).where(eq(renderJob.userId, c.get('caller').userId)).orderBy(desc(renderJob.createdAt)).limit(50);
  return c.json(await Promise.all(jobs.map(view)), 200);
});

renders.openapi(createRoute({
  method: 'get', path: '/renders/{id}', tags: ['Rendering'], security: secured, summary: 'A render job\'s status and progress',
  request: { params: IdParam },
  responses: { 200: json(RenderJob, 'The job'), ...problems(401, 404, 429) },
}), async (c) => c.json(await view(await own(c.req.valid('param').id, c.get('caller').userId)), 200));

renders.openapi(createRoute({
  method: 'get', path: '/renders/{id}/output', tags: ['Rendering'], security: secured, summary: 'Download the finished MP4',
  request: { params: IdParam },
  responses: { 200: { description: 'The video', content: { 'video/mp4': { schema: z.string().openapi({ format: 'binary' }) } } }, ...problems(401, 404, 409, 429) },
}), async (c) => {
  const job = await own(c.req.valid('param').id, c.get('caller').userId);
  if (job.status !== 'done') fail(409, job.status === 'expired' ? 'This render has expired and was deleted.' : `The job is ${job.status}.`);
  const file = (job.spec as Spec).name.replace(/[^\w\- ]+/g, '').trim() || 'undertow';
  return c.body(storage.read(`${job.id}/output.mp4`), 200, {
    'content-type': 'video/mp4', 'content-length': String(job.outputBytes ?? ''),
    'content-disposition': `attachment; filename="${file}-${(job.spec as Spec).options.aspect}.mp4"`,
  });
});

renders.openapi(createRoute({
  method: 'delete', path: '/renders/{id}', tags: ['Rendering'], security: secured,
  summary: 'Cancel a render, or delete a finished one and its output',
  description: 'Cancelling refunds the job\'s minutes. Deleting a finished render removes the output but keeps its minutes counted.',
  request: { params: IdParam },
  responses: { 204: { description: 'Cancelled or deleted' }, ...problems(401, 404, 429) },
}), async (c) => {
  const job = await own(c.req.valid('param').id, c.get('caller').userId);
  if (['awaiting_upload', 'queued', 'running'].includes(job.status)) {
    await db.update(renderJob).set({ status: 'cancelled', finishedAt: new Date() }).where(eq(renderJob.id, job.id));
  } else {
    await db.update(renderJob).set({ status: job.status === 'done' ? 'expired' : job.status, outputBytes: null }).where(eq(renderJob.id, job.id));
  }
  await storage.removeJob(job.id);
  return c.body(null, 204);
});

