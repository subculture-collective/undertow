import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { profile, usageEvent } from '../db/schema.js';
import { planFor, type Plan } from './plans.js';
import { fail } from './problem.js';
import { take } from './rate-limit.js';

/** Who is calling: a signed-in browser session, or an API key acting for its owner. */
export interface Caller {
  userId: string;
  apiKeyId: string | null;
  plan: Plan;
  planName: string;
}

export type AppEnv = { Variables: { caller: Caller } };

/** API keys arrive as `Authorization: Bearer ut_…` (preferred) or `x-api-key: ut_…`. */
function keyFrom(headers: Headers): string | null {
  const bearer = headers.get('authorization')?.match(/^Bearer\s+(ut_\S+)$/i)?.[1];
  return bearer ?? headers.get('x-api-key');
}

async function planOf(userId: string) {
  const row = await db.query.profile.findFirst({ where: eq(profile.userId, userId), columns: { plan: true } });
  return row?.plan ?? 'free';
}

/**
 * Requires a caller, applies the plan's per-minute limit, and records the
 * request for usage reporting once the response is ready.
 */
export const requireCaller = createMiddleware<AppEnv>(async (c, next) => {
  const headers = c.req.raw.headers;
  const key = keyFrom(headers);
  let caller: Caller;
  if (key) {
    const res = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
    if (!res?.valid || !res.key) fail(401, 'That API key is invalid, disabled or expired.');
    const planName = await planOf(res.key.referenceId);
    caller = { userId: res.key.referenceId, apiKeyId: res.key.id, planName, plan: planFor(planName) };
  } else {
    const session = await auth.api.getSession({ headers });
    if (!session) fail(401);
    const planName = await planOf(session.user.id);
    caller = { userId: session.user.id, apiKeyId: null, planName, plan: planFor(planName) };
  }

  const rate = take(caller.apiKeyId ?? `user:${caller.userId}`, caller.plan.requestsPerMinute);
  const rateHeaders = {
    'RateLimit-Limit': String(rate.limit), 'RateLimit-Remaining': String(rate.remaining), 'RateLimit-Reset': String(rate.resetSeconds),
  };
  if (!rate.allowed) {
    fail(429, `Limit is ${rate.limit} requests per minute on the ${caller.planName} plan.`, { ...rateHeaders, 'Retry-After': String(rate.resetSeconds) });
  }
  for (const [k, v] of Object.entries(rateHeaders)) c.header(k, v);

  c.set('caller', caller);
  await next();

  // Record after responding; a failed insert must never fail the request.
  const route = c.req.routePath;
  db.insert(usageEvent).values({
    userId: caller.userId, apiKeyId: caller.apiKeyId, method: c.req.method, route, status: c.res.status,
  }).catch((e) => console.error('usage insert failed', e));
});
