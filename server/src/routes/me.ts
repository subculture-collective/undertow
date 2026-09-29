import { createRoute, z } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { auth } from '../auth.js';
import { account, user } from '../db/auth-schema.js';
import { db } from '../db/index.js';
import { profile } from '../db/schema.js';
import { requireCaller } from '../lib/caller.js';
import { fail, problems } from '../lib/problem.js';
import { iso, json, router, secured } from '../lib/router.js';
import { Connection, Defaults, Me, SocialItem, UpdateMe } from '../schemas.js';

export const me = router();
// '/me/*' also matches '/me' itself in Hono; registering both would run the middleware twice.
me.use('/me/*', requireCaller);

async function loadDefaults(userId: string) {
  const row = await db.query.profile.findFirst({ where: eq(profile.userId, userId) });
  return { plan: row?.plan ?? 'free', defaults: Defaults.parse(row?.defaults ?? {}) };
}

async function loadConnections(userId: string): Promise<z.infer<typeof Connection>[]> {
  const rows = await db.select({ providerId: account.providerId, accountId: account.accountId, createdAt: account.createdAt })
    .from(account).where(eq(account.userId, userId));
  // "credential" is the email/password login, not a connected account.
  return rows.filter((r) => r.providerId !== 'credential')
    .map((r) => ({ provider: r.providerId, accountId: r.accountId, linkedAt: iso(r.createdAt)! }));
}

me.openapi(createRoute({
  method: 'get', path: '/me', tags: ['Account'], security: secured,
  summary: 'The signed-in account, its defaults and connected accounts',
  responses: { 200: json(Me, 'The account'), ...problems(401, 429) },
}), async (c) => {
  const { userId } = c.get('caller');
  const u = await db.query.user.findFirst({ where: eq(user.id, userId) });
  if (!u) fail(404);
  const { plan, defaults } = await loadDefaults(userId);
  return c.json({
    id: u.id, email: u.email, emailVerified: u.emailVerified, name: u.name, image: u.image ?? null,
    plan, defaults, connections: await loadConnections(userId),
  }, 200);
});

me.openapi(createRoute({
  method: 'patch', path: '/me', tags: ['Account'], security: secured, summary: 'Update the display name',
  request: { body: { content: { 'application/json': { schema: UpdateMe } }, required: true } },
  responses: { 204: { description: 'Updated' }, ...problems(401, 422, 429) },
}), async (c) => {
  const body = c.req.valid('json');
  if (body.name) await db.update(user).set({ name: body.name }).where(eq(user.id, c.get('caller').userId));
  return c.body(null, 204);
});

me.openapi(createRoute({
  method: 'get', path: '/me/defaults', tags: ['Account'], security: secured,
  summary: 'Defaults applied to new projects: artist name, website, socials, palette, font',
  responses: { 200: json(Defaults, 'The defaults'), ...problems(401, 429) },
}), async (c) => c.json((await loadDefaults(c.get('caller').userId)).defaults, 200));

me.openapi(createRoute({
  method: 'put', path: '/me/defaults', tags: ['Account'], security: secured, summary: 'Replace the defaults',
  request: { body: { content: { 'application/json': { schema: Defaults } }, required: true } },
  responses: { 200: json(Defaults, 'The saved defaults'), ...problems(401, 422, 429) },
}), async (c) => {
  const defaults = c.req.valid('json');
  const userId = c.get('caller').userId;
  await db.insert(profile).values({ userId, defaults })
    .onConflictDoUpdate({ target: profile.userId, set: { defaults, updatedAt: new Date() } });
  return c.json(defaults, 200);
});

me.openapi(createRoute({
  method: 'get', path: '/me/connections', tags: ['Account'], security: secured,
  summary: 'Accounts connected for sign-in and profile import (Google/YouTube, Discord)',
  responses: { 200: json(z.array(Connection), 'Connected accounts'), ...problems(401, 429) },
}), async (c) => c.json(await loadConnections(c.get('caller').userId), 200));

const ImportResult = z.object({
  provider: z.string(),
  /** What was found, e.g. the YouTube channel title. */
  label: z.string(),
  socials: z.array(SocialItem),
}).openapi('ConnectionImport');

me.openapi(createRoute({
  method: 'post', path: '/me/connections/{provider}/import', tags: ['Account'], security: secured,
  summary: 'Read profile details from a connected account and suggest social links',
  description: 'Google reads the YouTube channel (needs the YouTube scope, granted when linking YouTube). Discord reads the username. Nothing is saved; add the suggestions to your defaults with PUT /v1/me/defaults.',
  request: { params: z.object({ provider: z.enum(['google', 'discord']).openapi({ param: { name: 'provider', in: 'path' } }) }) },
  responses: { 200: json(ImportResult, 'Suggested socials'), ...problems(401, 404, 409, 429) },
}), async (c) => {
  const { provider } = c.req.valid('param');
  const { userId } = c.get('caller');
  const row = await db.query.account.findFirst({ where: and(eq(account.userId, userId), eq(account.providerId, provider)) });
  if (!row) fail(404, `No ${provider} account is connected.`);
  const token = await auth.api.getAccessToken({ body: { accountId: row.id, userId } }).catch(() => null);
  if (!token?.accessToken) fail(409, `The ${provider} connection has expired. Connect it again.`);
  const headers = { authorization: `Bearer ${token.accessToken}` };

  if (provider === 'google') {
    if (!row.scope?.includes('youtube')) fail(409, 'Connect YouTube to allow reading your channel.');
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers });
    if (!res.ok) fail(409, `YouTube returned ${res.status}.`);
    const body = await res.json() as { items?: { snippet: { title: string; customUrl?: string } }[] };
    const ch = body.items?.[0]?.snippet;
    if (!ch) fail(404, 'This Google account has no YouTube channel.');
    return c.json({ provider, label: ch.title, socials: [{ platform: 'youtube' as const, handle: ch.customUrl ?? ch.title }] }, 200);
  }

  const res = await fetch('https://discord.com/api/users/@me', { headers });
  if (!res.ok) fail(409, `Discord returned ${res.status}.`);
  const d = await res.json() as { username: string; global_name?: string | null };
  return c.json({ provider, label: d.global_name ?? d.username, socials: [{ platform: 'discord' as const, handle: d.username }] }, 200);
});
