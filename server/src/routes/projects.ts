import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { project } from '../db/schema.js';
import { requireCaller } from '../lib/caller.js';
import { newId } from '../lib/ids.js';
import { fail, problems } from '../lib/problem.js';
import { iso, json, router, secured } from '../lib/router.js';
import { CreateProject, IdParam, Page, Project, ProjectSummary, UpdateProject } from '../schemas.js';

export const projects = router();
projects.use('/projects/*', requireCaller); // also matches '/projects'

const THUMB_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const THUMB_MAX = 256 * 1024;

type Row = typeof project.$inferSelect;
const summary = (r: Pick<Row, 'id' | 'name' | 'revision' | 'createdAt' | 'updatedAt'> & { hasThumbnail: boolean }) => ({
  id: r.id, name: r.name, revision: r.revision, hasThumbnail: r.hasThumbnail,
  createdAt: iso(r.createdAt)!, updatedAt: iso(r.updatedAt)!,
});
const full = (r: Row) => ({
  ...summary({ ...r, hasThumbnail: !!r.thumbnail }),
  data: r.data as z.infer<typeof Project>['data'], media: r.media as z.infer<typeof Project>['media'],
});

async function own(id: string, userId: string) {
  const r = await db.query.project.findFirst({ where: and(eq(project.id, id), eq(project.userId, userId)) });
  if (!r) fail(404, 'No project with that id in this account.');
  return r;
}

async function checkQuota(userId: string, max: number) {
  const [{ n }] = await db.select({ n: count() }).from(project).where(eq(project.userId, userId));
  if (n >= max) fail(403, `Your plan allows ${max} projects. Delete one or upgrade.`);
}

// Cursors are "<updatedAt ISO>|<id>" in base64url: stable ordering even when timestamps tie.
const encodeCursor = (r: { updatedAt: Date; id: string }) => Buffer.from(`${r.updatedAt.toISOString()}|${r.id}`).toString('base64url');
function decodeCursor(c: string) {
  const [ts, id] = Buffer.from(c, 'base64url').toString().split('|');
  const d = new Date(ts);
  if (!id || Number.isNaN(d.getTime())) fail(400, 'Invalid cursor.');
  return { d, id };
}

projects.openapi(createRoute({
  method: 'get', path: '/projects', tags: ['Projects'], security: secured, summary: 'List projects, most recently edited first',
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().optional(),
    }),
  },
  responses: { 200: json(Page(ProjectSummary, 'ProjectPage'), 'A page of projects'), ...problems(400, 401, 429) },
}), async (c) => {
  const { limit, cursor } = c.req.valid('query');
  const { userId } = c.get('caller');
  const after = cursor ? decodeCursor(cursor) : null;
  const rows = await db.select({
    id: project.id, name: project.name, revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt,
    hasThumbnail: sql<boolean>`${project.thumbnail} is not null`,
  }).from(project)
    .where(and(eq(project.userId, userId), after
      ? or(lt(project.updatedAt, after.d), and(eq(project.updatedAt, after.d), lt(project.id, after.id)))
      : undefined))
    .orderBy(desc(project.updatedAt), desc(project.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return c.json({ items: page.map(summary), nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null }, 200);
});

projects.openapi(createRoute({
  method: 'post', path: '/projects', tags: ['Projects'], security: secured, summary: 'Save a new project',
  request: { body: { content: { 'application/json': { schema: CreateProject } }, required: true } },
  responses: { 201: json(Project, 'The created project'), ...problems(401, 403, 422, 429) },
}), async (c) => {
  const body = c.req.valid('json');
  const { userId, plan } = c.get('caller');
  await checkQuota(userId, plan.maxProjects);
  const [r] = await db.insert(project).values({ id: newId('prj'), userId, name: body.name, data: body.data, media: body.media }).returning();
  return c.json(full(r), 201);
});

projects.openapi(createRoute({
  method: 'get', path: '/projects/{id}', tags: ['Projects'], security: secured, summary: 'Get a project with its layout',
  request: { params: IdParam },
  responses: { 200: json(Project, 'The project'), ...problems(401, 404, 429) },
}), async (c) => c.json(full(await own(c.req.valid('param').id, c.get('caller').userId)), 200));

projects.openapi(createRoute({
  method: 'patch', path: '/projects/{id}', tags: ['Projects'], security: secured,
  summary: 'Update a project',
  description: 'Send `baseRevision` (the revision you loaded) to be told about conflicting edits: if the project changed since, the response is 409 and nothing is written.',
  request: { params: IdParam, body: { content: { 'application/json': { schema: UpdateProject } }, required: true } },
  responses: { 200: json(Project, 'The updated project'), ...problems(401, 404, 409, 422, 429) },
}), async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const { userId } = c.get('caller');
  const set = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.data !== undefined ? { data: body.data } : {}),
    ...(body.media !== undefined ? { media: body.media } : {}),
    revision: sql`${project.revision} + 1`, updatedAt: new Date(),
  };
  // The revision check and the write are one statement, so two saves can't both win.
  const [r] = await db.update(project).set(set).where(and(
    eq(project.id, id), eq(project.userId, userId),
    body.baseRevision !== undefined ? eq(project.revision, body.baseRevision) : undefined,
  )).returning();
  if (r) return c.json(full(r), 200);
  const current = await own(id, userId);
  fail(409, `The project was saved elsewhere (now revision ${current.revision}, you sent ${body.baseRevision}). Load it again or save as a copy.`);
});

projects.openapi(createRoute({
  method: 'delete', path: '/projects/{id}', tags: ['Projects'], security: secured, summary: 'Delete a project',
  request: { params: IdParam },
  responses: { 204: { description: 'Deleted' }, ...problems(401, 404, 429) },
}), async (c) => {
  const [r] = await db.delete(project)
    .where(and(eq(project.id, c.req.valid('param').id), eq(project.userId, c.get('caller').userId))).returning({ id: project.id });
  if (!r) fail(404);
  return c.body(null, 204);
});

projects.openapi(createRoute({
  method: 'post', path: '/projects/{id}/duplicate', tags: ['Projects'], security: secured, summary: 'Copy a project',
  request: { params: IdParam, body: { content: { 'application/json': { schema: z.object({ name: z.string().min(1).max(200).optional() }) } } } },
  responses: { 201: json(Project, 'The copy'), ...problems(401, 403, 404, 429) },
}), async (c) => {
  const { userId, plan } = c.get('caller');
  const src = await own(c.req.valid('param').id, userId);
  await checkQuota(userId, plan.maxProjects);
  const name = c.req.valid('json')?.name ?? `${src.name} copy`;
  const [r] = await db.insert(project).values({
    id: newId('prj'), userId, name, data: { ...(src.data as object), name }, media: src.media,
    thumbnail: src.thumbnail, thumbnailType: src.thumbnailType,
  }).returning();
  return c.json(full(r), 201);
});

projects.openapi(createRoute({
  method: 'put', path: '/projects/{id}/thumbnail', tags: ['Projects'], security: secured,
  summary: 'Set the preview image (JPEG, PNG or WebP, up to 256 KB)',
  request: {
    params: IdParam,
    body: { content: Object.fromEntries(THUMB_TYPES.map((t) => [t, { schema: z.string().openapi({ format: 'binary' }) }])), required: true },
  },
  responses: { 204: { description: 'Saved' }, ...problems(401, 404, 413, 422, 429) },
}), async (c) => {
  const type = c.req.header('content-type')?.split(';')[0] ?? '';
  if (!THUMB_TYPES.includes(type)) fail(422, `Content-Type must be one of ${THUMB_TYPES.join(', ')}.`);
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > THUMB_MAX) fail(413, 'Thumbnails can be up to 256 KB.');
  const [r] = await db.update(project).set({ thumbnail: buf, thumbnailType: type })
    .where(and(eq(project.id, c.req.valid('param').id), eq(project.userId, c.get('caller').userId))).returning({ id: project.id });
  if (!r) fail(404);
  return c.body(null, 204);
});

projects.openapi(createRoute({
  method: 'get', path: '/projects/{id}/thumbnail', tags: ['Projects'], security: secured, summary: 'Get the preview image',
  request: { params: IdParam },
  responses: { 200: { description: 'The image', content: { 'image/*': { schema: z.string().openapi({ format: 'binary' }) } } }, ...problems(401, 404, 429) },
}), async (c) => {
  const r = await own(c.req.valid('param').id, c.get('caller').userId);
  if (!r.thumbnail) fail(404, 'This project has no thumbnail.');
  return c.body(new Uint8Array(r.thumbnail), 200, { 'content-type': r.thumbnailType ?? 'image/jpeg', 'cache-control': 'private, max-age=60' });
});
