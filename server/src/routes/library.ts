/** Templates, palettes and Milkdrop presets: the shared building blocks for projects. */
import { createRoute, z } from '@hono/zod-openapi';
import { readFileSync } from 'node:fs';
import { and, count, desc, eq, or } from 'drizzle-orm';
import { user } from '../db/auth-schema.js';
import { db } from '../db/index.js';
import { palette, template } from '../db/schema.js';
import { requireCaller } from '../lib/caller.js';
import { newId } from '../lib/ids.js';
import { fail, problems } from '../lib/problem.js';
import { iso, json, router, secured } from '../lib/router.js';
import { CreatePalette, CreateTemplate, IdParam, PaletteRecord, ProjectData, Template, TemplateSummary } from '../schemas.js';

export const library = router();
// Each pattern also matches its base path ('/templates/*' matches '/templates').
for (const p of ['/templates/*', '/palettes/*', '/presets/*']) library.use(p, requireCaller);

const load = <T>(file: string): T => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));

/** Built-in templates, exported from the editor by scripts/export-api-data.ts. Ids are prefixed `builtin_`. */
const BUILTIN_TEMPLATES = load<{ id: string; name: string; description: string; data: z.infer<typeof ProjectData> }[]>('templates.json')
  .map((t) => ({ ...t, id: `builtin_${t.id}` }));
const MILKDROP = load<string[]>('milkdrop-presets.json');

/** Built-in palettes, exported from the editor (src/cloud/palettes.ts). */
const BUILTIN_PALETTES = load<{ id: string; name: string; colors: z.infer<typeof PaletteRecord>['colors'] }[]>('palettes.json');

const builtinSummary = (t: (typeof BUILTIN_TEMPLATES)[number]) => ({
  id: t.id, name: t.name, description: t.description, builtIn: true, visibility: 'public' as const,
  author: null, hasThumbnail: false, updatedAt: null,
});

// ---- templates ---------------------------------------------------------------------------------------
library.openapi(createRoute({
  method: 'get', path: '/templates', tags: ['Templates'], security: secured,
  summary: 'List templates: built-in, published by anyone, or your own',
  request: { query: z.object({ scope: z.enum(['all', 'builtin', 'public', 'mine']).default('all') }) },
  responses: { 200: json(z.array(TemplateSummary), 'Templates'), ...problems(401, 429) },
}), async (c) => {
  const { scope } = c.req.valid('query');
  const { userId } = c.get('caller');
  const out: z.infer<typeof TemplateSummary>[] = scope === 'all' || scope === 'builtin' ? BUILTIN_TEMPLATES.map(builtinSummary) : [];
  if (scope !== 'builtin') {
    const where = scope === 'mine' ? eq(template.userId, userId)
      : scope === 'public' ? eq(template.visibility, 'public')
      : or(eq(template.visibility, 'public'), eq(template.userId, userId));
    const rows = await db.select({
      id: template.id, name: template.name, description: template.description, visibility: template.visibility,
      author: user.name, thumbnail: template.thumbnailType, updatedAt: template.updatedAt,
    }).from(template).innerJoin(user, eq(user.id, template.userId)).where(where).orderBy(desc(template.updatedAt)).limit(200);
    out.push(...rows.map((r) => ({
      id: r.id, name: r.name, description: r.description, builtIn: false, visibility: r.visibility as 'private' | 'public',
      author: r.author, hasThumbnail: !!r.thumbnail, updatedAt: iso(r.updatedAt),
    })));
  }
  return c.json(out, 200);
});

library.openapi(createRoute({
  method: 'get', path: '/templates/{id}', tags: ['Templates'], security: secured, summary: 'Get a template with its layout',
  request: { params: IdParam },
  responses: { 200: json(Template, 'The template'), ...problems(401, 404, 429) },
}), async (c) => {
  const { id } = c.req.valid('param');
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtin) return c.json({ ...builtinSummary(builtin), data: builtin.data }, 200);
  const [r] = await db.select({ t: template, author: user.name }).from(template).innerJoin(user, eq(user.id, template.userId))
    .where(and(eq(template.id, id), or(eq(template.visibility, 'public'), eq(template.userId, c.get('caller').userId))));
  if (!r) fail(404);
  return c.json({
    id: r.t.id, name: r.t.name, description: r.t.description, builtIn: false, visibility: r.t.visibility as 'private' | 'public',
    author: r.author, hasThumbnail: !!r.t.thumbnail, updatedAt: iso(r.t.updatedAt), data: r.t.data as z.infer<typeof ProjectData>,
  }, 200);
});

library.openapi(createRoute({
  method: 'post', path: '/templates', tags: ['Templates'], security: secured,
  summary: 'Publish a layout as a template (private, or public for everyone)',
  request: { body: { content: { 'application/json': { schema: CreateTemplate } }, required: true } },
  responses: { 201: json(TemplateSummary, 'The template'), ...problems(401, 403, 422, 429) },
}), async (c) => {
  const body = c.req.valid('json');
  const { userId, plan } = c.get('caller');
  const [{ n }] = await db.select({ n: count() }).from(template).where(eq(template.userId, userId));
  if (n >= plan.maxTemplates) fail(403, `Your plan allows ${plan.maxTemplates} templates.`);
  // Templates are shared: strip file references so a layout never points at someone's private media.
  const data = { ...body.data, audioAssetId: null, layers: body.data.layers.map(stripAssets) };
  const [r] = await db.insert(template).values({ id: newId('tpl'), userId, ...body, data }).returning();
  const u = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { name: true } });
  return c.json({
    id: r.id, name: r.name, description: r.description, builtIn: false, visibility: r.visibility as 'private' | 'public',
    author: u?.name ?? null, hasThumbnail: false, updatedAt: iso(r.updatedAt),
  }, 201);
});

function stripAssets<L extends Record<string, unknown>>(layer: L): L {
  const props = layer.props as Record<string, unknown> | undefined;
  if (!props || !('assetId' in props)) return layer;
  return { ...layer, props: { ...props, assetId: null } };
}

library.openapi(createRoute({
  method: 'delete', path: '/templates/{id}', tags: ['Templates'], security: secured, summary: 'Delete one of your templates',
  request: { params: IdParam },
  responses: { 204: { description: 'Deleted' }, ...problems(401, 404, 429) },
}), async (c) => {
  const [r] = await db.delete(template)
    .where(and(eq(template.id, c.req.valid('param').id), eq(template.userId, c.get('caller').userId))).returning({ id: template.id });
  if (!r) fail(404);
  return c.body(null, 204);
});

// ---- palettes --------------------------------------------------------------------------------------------
library.openapi(createRoute({
  method: 'get', path: '/palettes', tags: ['Palettes'], security: secured, summary: 'Built-in palettes and your saved ones',
  responses: { 200: json(z.array(PaletteRecord), 'Palettes'), ...problems(401, 429) },
}), async (c) => {
  const rows = await db.select().from(palette).where(eq(palette.userId, c.get('caller').userId)).orderBy(desc(palette.createdAt));
  return c.json([
    ...BUILTIN_PALETTES.map((p) => ({ ...p, builtIn: true })),
    ...rows.map((r) => ({ id: r.id, name: r.name, colors: r.colors as z.infer<typeof PaletteRecord>['colors'], builtIn: false })),
  ], 200);
});

library.openapi(createRoute({
  method: 'post', path: '/palettes', tags: ['Palettes'], security: secured, summary: 'Save a palette',
  request: { body: { content: { 'application/json': { schema: CreatePalette } }, required: true } },
  responses: { 201: json(PaletteRecord, 'The palette'), ...problems(401, 403, 422, 429) },
}), async (c) => {
  const body = c.req.valid('json');
  const { userId } = c.get('caller');
  const [{ n }] = await db.select({ n: count() }).from(palette).where(eq(palette.userId, userId));
  if (n >= 100) fail(403, 'You can save up to 100 palettes.');
  const [r] = await db.insert(palette).values({ id: newId('pal'), userId, name: body.name, colors: body.colors }).returning();
  return c.json({ id: r.id, name: r.name, colors: body.colors, builtIn: false }, 201);
});

library.openapi(createRoute({
  method: 'delete', path: '/palettes/{id}', tags: ['Palettes'], security: secured, summary: 'Delete one of your palettes',
  request: { params: IdParam },
  responses: { 204: { description: 'Deleted' }, ...problems(401, 404, 429) },
}), async (c) => {
  const [r] = await db.delete(palette)
    .where(and(eq(palette.id, c.req.valid('param').id), eq(palette.userId, c.get('caller').userId))).returning({ id: palette.id });
  if (!r) fail(404);
  return c.body(null, 204);
});

// ---- presets -------------------------------------------------------------------------------------------------
library.openapi(createRoute({
  method: 'get', path: '/presets/milkdrop', tags: ['Presets'], security: secured,
  summary: 'Names of the Milkdrop presets the renderer can use',
  request: { query: z.object({ q: z.string().max(100).optional() }) },
  responses: { 200: json(z.array(z.string()), 'Preset names, alphabetical'), ...problems(401, 429) },
}), async (c) => {
  const q = c.req.valid('query').q?.toLowerCase();
  return c.json(q ? MILKDROP.filter((n) => n.toLowerCase().includes(q)) : MILKDROP, 200);
});
