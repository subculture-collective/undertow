import { createRoute, z } from '@hono/zod-openapi';
import { auth } from '../auth.js';
import { billing } from '../lib/billing.js';
import { fail, problems } from '../lib/problem.js';
import { json, router } from '../lib/router.js';
import { env, trustedOrigins } from '../env.js';

export const billingRoutes = router();
const Status = z.object({ enabled: z.boolean(), sandbox: z.boolean(), amount: z.number().nullable(), currency: z.string(),
  status: z.string(), subscribed: z.boolean(), creator: z.boolean(), periodEnd: z.string().nullable(), cancelAtPeriodEnd: z.boolean() }).openapi('BillingStatus');
const Url = z.object({ url: z.string().url() }).openapi('BillingRedirect');

// Webhooks authenticate using the signature, before any session or origin requirement.
billingRoutes.post('/billing/webhook', async (c) => {
  if (!billing) fail(503, 'Billing is not configured.');
  await billing.webhook(await c.req.text(), c.req.header('stripe-signature') ?? '');
  return c.json({ received: true });
});

billingRoutes.use('/billing/*', async (c, next) => {
  // Billing actions require a browser session; API keys cannot initiate purchases.
  if (c.req.method !== 'GET' && !trustedOrigins.includes(c.req.header('origin') ?? '')) fail(403, 'Use billing from the Undertow account page.');
  await next();
});
async function owner(headers: Headers) {
  const sessionHeaders = new Headers(headers);
  sessionHeaders.delete('authorization');
  sessionHeaders.delete('x-api-key');
  const session = await auth.api.getSession({ headers: sessionHeaders });
  if (!session) fail(401);
  return session.user.id;
}
billingRoutes.openapi(createRoute({ method: 'get', path: '/billing', tags: ['Billing'], security: [{ session: [] }],
  summary: 'Current subscription and Creator price', responses: { 200: json(Status, 'Billing status'), ...problems(401, 503) },
}), async (c) => {
  const id = await owner(c.req.raw.headers);
  return c.json(billing ? await billing.status(id) : { enabled: false, sandbox: !env.STRIPE_LIVE_MODE, amount: null,
    currency: 'usd', status: 'none', subscribed: false, creator: false, periodEnd: null, cancelAtPeriodEnd: false }, 200);
});
for (const action of ['checkout', 'portal'] as const) {
  billingRoutes.openapi(createRoute({ method: 'post', path: `/billing/${action}`, tags: ['Billing'], security: [{ session: [] }],
    summary: action === 'checkout' ? 'Start or resume Creator Checkout' : 'Manage billing in the customer portal',
    responses: { 200: json(Url, 'Stripe redirect'), ...problems(401, 403, 409, 503) },
  }), async (c) => {
    const id = await owner(c.req.raw.headers);
    if (!billing) fail(503, 'Billing is not configured.');
    return c.json({ url: await billing[action](id) }, 200);
  });
}
