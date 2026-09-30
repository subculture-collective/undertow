/** API keys and usage. Keys are managed only from a signed-in session: a key can't create or revoke keys. */
import { createRoute, z } from '@hono/zod-openapi';
import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { auth } from '../auth.js';
import { apikey } from '../db/auth-schema.js';
import { db } from '../db/index.js';
import { usageEvent } from '../db/schema.js';
import { requireCaller } from '../lib/caller.js';
import { fail, problems } from '../lib/problem.js';
import { iso, json, router, secured } from '../lib/router.js';
import { ApiKey, CreateApiKey, CreatedApiKey, IdParam, Usage } from '../schemas.js';
import { renderSecondsThisMonth } from './renders.js';

export const keys = router();
keys.use('/keys/*', requireCaller); // also matches '/keys'
keys.use('/usage', requireCaller);

const sessionOnly: Record<string, string[]>[] = [{ session: [] }];
const toKey = (r: typeof apikey.$inferSelect) => ({
  id: r.id, name: r.name ?? null, start: r.start ?? null,
  createdAt: iso(r.createdAt)!, lastUsedAt: iso(r.lastRequest), expiresAt: iso(r.expiresAt),
});

keys.openapi(createRoute({
  method: 'get', path: '/keys', tags: ['API keys'], security: sessionOnly, summary: 'List your API keys',
  responses: { 200: json(z.array(ApiKey), 'Keys (without secrets)'), ...problems(401, 403, 429) },
}), async (c) => {
  const { userId, apiKeyId } = c.get('caller');
  if (apiKeyId) fail(403, 'Manage API keys from a signed-in session, not with an API key.');
  const rows = await db.select().from(apikey).where(eq(apikey.referenceId, userId)).orderBy(desc(apikey.createdAt));
  return c.json(rows.map(toKey), 200);
});

keys.openapi(createRoute({
  method: 'post', path: '/keys', tags: ['API keys'], security: sessionOnly,
  summary: 'Create an API key. The response is the only time the full key is shown.',
  request: { body: { content: { 'application/json': { schema: CreateApiKey } }, required: true } },
  responses: { 201: json(CreatedApiKey, 'The new key'), ...problems(401, 403, 422, 429) },
}), async (c) => {
  const { userId, apiKeyId, plan } = c.get('caller');
  if (apiKeyId) fail(403, 'Manage API keys from a signed-in session, not with an API key.');
  const [{ n }] = await db.select({ n: count() }).from(apikey).where(eq(apikey.referenceId, userId));
  if (n >= plan.maxApiKeys) fail(403, `Your plan allows ${plan.maxApiKeys} API keys. Revoke one first.`);
  const body = c.req.valid('json');
  const created = await auth.api.createApiKey({
    body: { name: body.name, userId, expiresIn: body.expiresInDays ? body.expiresInDays * 86_400 : null },
  });
  const row = await db.query.apikey.findFirst({ where: eq(apikey.id, created.id) });
  if (!row) throw new Error(`API key ${created.id} was created but not found`);
  return c.json({ ...toKey(row), key: created.key }, 201);
});

keys.openapi(createRoute({
  method: 'delete', path: '/keys/{id}', tags: ['API keys'], security: sessionOnly, summary: 'Revoke an API key',
  request: { params: IdParam },
  responses: { 204: { description: 'Revoked' }, ...problems(401, 403, 404, 429) },
}), async (c) => {
  const { userId, apiKeyId } = c.get('caller');
  if (apiKeyId) fail(403, 'Manage API keys from a signed-in session, not with an API key.');
  const [r] = await db.delete(apikey)
    .where(and(eq(apikey.id, c.req.valid('param').id), eq(apikey.referenceId, userId))).returning({ id: apikey.id });
  if (!r) fail(404);
  return c.body(null, 204);
});

keys.openapi(createRoute({
  method: 'get', path: '/usage', tags: ['API keys'], security: secured, summary: 'Your plan, its limits and requests per day',
  request: { query: z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }) },
  responses: { 200: json(Usage, 'Usage'), ...problems(401, 429) },
}), async (c) => {
  const { userId, plan, planName } = c.get('caller');
  const since = new Date(Date.now() - c.req.valid('query').days * 86_400_000);
  const day = sql<string>`to_char(date_trunc('day', ${usageEvent.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
  const rows = await db.select({ date: day, requests: count(), units: sql<number>`coalesce(sum(${usageEvent.units}), 0)::int` })
    .from(usageEvent).where(and(eq(usageEvent.userId, userId), gte(usageEvent.createdAt, since)))
    .groupBy(day).orderBy(day);
  return c.json({ plan: planName, limits: plan, renderSecondsThisMonth: await renderSecondsThisMonth(userId), days: rows }, 200);
});
