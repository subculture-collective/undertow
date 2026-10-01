import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import Stripe from 'stripe';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';

describe.skipIf(!process.env.TEST_DATABASE_URL)('API reliability with disposable Postgres', () => {
  let app: ReturnType<typeof import('../src/app.js').createApp>;
  let database: typeof import('../src/db/index.js');
  let schema: typeof import('../src/db/schema.js');
  let storage: typeof import('../src/lib/storage.js').storage;
  let dir: string;
  let key: string;
  let billing: InstanceType<typeof import('../src/lib/billing.js').Billing>;
  let stripeServer: ReturnType<typeof createServer>;
  let stripeState: { status: string | null; cancel: boolean; paused: boolean; price: string; periodEnd: number; checkoutCount: number; open: boolean; fail: boolean };
  const owner = 'test-owner';
  const secret = 'test-worker-secret-at-least-16';
  const oldToken = 'rjt_old';
  const newToken = 'rjt_new';
  const spec = { name: 'Test', data: { version: 1, name: 'Test', audioAssetId: null, layers: [] }, options: { aspect: 'landscape', shortSide: 720, fps: 30, start: 0, end: 10, quality: 'high' } };
  const workerHeaders = (token: string) => ({ authorization: `Bearer ${secret}`, 'x-job-token': token, 'content-type': 'application/json' });
  beforeAll(async () => {
    const url = new URL(process.env.TEST_DATABASE_URL!);
    if (!url.pathname.startsWith('/undertow_test')) throw new Error('TEST_DATABASE_URL must name an undertow_test database.');
    dir = await mkdtemp(join(tmpdir(), 'undertow-test-'));
    Object.assign(process.env, { DATABASE_URL: url.href, PUBLIC_URL: 'http://localhost:8787', AUTH_SECRET: 'test-auth-secret-at-least-32-characters', NODE_ENV: 'test', WORKER_SECRET: secret, RENDER_DIR: dir, STATIC_DIR: '' });
    database = await import('../src/db/index.js');
    schema = await import('../src/db/schema.js');
    storage = (await import('../src/lib/storage.js')).storage;
    await migrate(database.db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
    app = (await import('../src/app.js')).createApp();
    stripeServer = createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      const url = new URL(req.url!, 'http://localhost');
      const send = (body: unknown) => res.end(JSON.stringify(body));
      if (url.pathname === '/v1/prices/price_creator') return send({ id: 'price_creator', active: true, livemode: false, type: 'recurring', recurring: { interval: 'month', interval_count: 1 }, unit_amount: 1200, currency: 'usd' });
      if (url.pathname === '/v1/customers') return send({ id: 'cus_test', livemode: false });
      if (url.pathname === '/v1/subscriptions') {
        if (stripeState.fail) { res.statusCode = 500; return send({ error: { type: 'api_error', message: 'temporary failure' } }); }
        return send({ object: 'list', has_more: false, data: stripeState.status ? [{ id: 'sub_test', object: 'subscription', customer: 'cus_test', livemode: false, status: stripeState.status, latest_invoice: { status: 'paid' }, created: 100, cancel_at_period_end: stripeState.cancel, pause_collection: stripeState.paused ? { behavior: 'void' } : null,
          items: { data: [{ price: { id: stripeState.price }, quantity: 1, current_period_end: stripeState.periodEnd }] } }] : [] });
      }
      if (url.pathname === '/v1/checkout/sessions' && req.method === 'GET') return send({ object: 'list', has_more: false, data: stripeState.open ? [{ id: 'cs_test', url: 'https://checkout.stripe.com/test', metadata: { app: 'undertow', priceId: 'price_creator' } }] : [] });
      if (url.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
        stripeState.checkoutCount++; stripeState.open = true;
        return send({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
      }
      if (url.pathname === '/v1/checkout/sessions/cs_test/expire') { stripeState.open = false; return send({ id: 'cs_test', status: 'expired' }); }
      if (url.pathname === '/v1/billing_portal/sessions') return send({ url: 'https://billing.stripe.com/test' });
      res.statusCode = 404; send({ error: { message: 'unknown test endpoint' } });
    });
    await new Promise<void>((resolve) => stripeServer.listen(0, '127.0.0.1', resolve));
    const address = stripeServer.address();
    if (!address || typeof address === 'string') throw new Error('Stripe test server unavailable');
    const { Billing } = await import('../src/lib/billing.js');
    billing = new Billing(new Stripe('sk_test_simulated', { host: '127.0.0.1', port: address.port, protocol: 'http', maxNetworkRetries: 0 }), {
      priceId: 'price_creator', portalConfigurationId: 'bpc_test', webhookSecret: 'whsec_test', liveMode: false, publicUrl: 'http://localhost:8787',
    });
  });
  beforeEach(async () => {
    await database.db.delete(database.schema.user);
    await rm(dir, { recursive: true, force: true });
    await database.db.insert(database.schema.user).values({ id: owner, name: 'Test', email: 'test@example.invalid', emailVerified: true });
    await database.db.insert(schema.profile).values({ userId: owner, plan: 'creator' });
    const auth = (await import('../src/auth.js')).auth;
    key = (await auth.api.createApiKey({ body: { userId: owner, name: 'Tests' } })).key;
    stripeState = { status: null, cancel: false, paused: false, price: 'price_creator', periodEnd: Math.floor(Date.now() / 1000) + 86400, checkoutCount: 0, open: false, fail: false };
    await database.db.delete(schema.billingEvent);
  });
  afterAll(async () => { if (database) await database.pool.end(); if (stripeServer) await new Promise<void>((resolve) => stripeServer.close(() => resolve())); if (dir) await rm(dir, { recursive: true, force: true }); });
  // Caller usage inserts run after the response. Let those finish before resetting fixtures.
  afterEach(async () => {
    // Drizzle starts a fire-and-forget insert on a later microtask. Yield before checking the pool.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await expect.poll(() => database.pool.waitingCount === 0 && database.pool.idleCount === database.pool.totalCount).toBe(true);
  });

  async function job(status = 'running', token = newToken) {
    await database.db.insert(schema.renderJob).values({ id: 'rnd_test', userId: owner, status, spec, durationSeconds: 10, tokenHash: createHash('sha256').update(token).digest('hex'), heartbeatAt: new Date() });
    await storage.put('rnd_test/output.mp4', new Blob(['keep this output']).stream(), 100);
  }
  async function webhook(id: string, overrides = {}) {
    const body = JSON.stringify({ id, object: 'event', type: 'customer.subscription.updated', livemode: false,
      data: { object: { object: 'subscription', customer: 'cus_test', status: 'active' } }, ...overrides });
    return billing.webhook(body, billing.stripe.webhooks.generateTestHeaderString({ payload: body, secret: 'whsec_test' }));
  }
  it('creates one Checkout session across concurrent requests and never grants access from a redirect', async () => {
    const urls = await Promise.all(Array.from({ length: 6 }, () => billing.checkout(owner)));
    expect(new Set(urls).size).toBe(1);
    expect(stripeState.checkoutCount).toBe(1);
    expect((await billing.status(owner)).creator).toBe(false);
    expect((await database.db.query.profile.findFirst())?.plan).toBe('free');
    expect((await app.request('/v1/billing/checkout', { method: 'POST', headers: { origin: 'http://localhost:8787', authorization: `Bearer ${key}` } })).status).toBe(401);
    expect((await app.request('/v1/billing/checkout', { method: 'POST', headers: { origin: 'https://evil.invalid' } })).status).toBe(403);
  });
  it('reconciles current Stripe state rather than stale events and skips webhook replays', async () => {
    await billing.checkout(owner);
    stripeState.status = 'active'; stripeState.cancel = true;
    await webhook('evt_first');
    expect((await billing.status(owner)).creator).toBe(true);
    await expect(billing.checkout(owner)).rejects.toMatchObject({ status: 409 });
    stripeState.status = 'past_due';
    await webhook('evt_second');
    expect((await database.db.query.profile.findFirst())?.plan).toBe('free');
    await webhook('evt_first');
    expect((await database.db.query.profile.findFirst())?.plan).toBe('free');
    expect((await database.db.select().from(schema.billingEvent)).length).toBe(2);
    stripeState.status = 'active'; stripeState.periodEnd = Math.floor(Date.now() / 1000) - 1;
    expect((await billing.status(owner)).creator).toBe(false);
  });
  it('rejects tampered and live webhooks and retries failed synchronization without consuming the event', async () => {
    await billing.checkout(owner);
    await expect(billing.webhook('{}', 'invalid')).rejects.toMatchObject({ status: 400 });
    await expect(webhook('evt_live', { livemode: true })).rejects.toMatchObject({ status: 400 });
    stripeState.fail = true;
    await expect(webhook('evt_retry')).rejects.toThrow();
    expect((await database.db.select().from(schema.billingEvent)).length).toBe(0);
    stripeState.fail = false; stripeState.status = 'active';
    await webhook('evt_retry');
    expect((await database.db.query.profile.findFirst())?.plan).toBe('creator');
  });
  it('blocks deletion while billing can renew and expires open checkout before deletion', async () => {
    await billing.checkout(owner);
    stripeState.status = 'active'; stripeState.cancel = true;
    await expect(billing.beforeDelete(owner)).rejects.toMatchObject({ status: 409 });
    stripeState.status = 'canceled';
    await billing.beforeDelete(owner);
    expect(stripeState.open).toBe(false);
    await expect(billing.checkout(owner)).rejects.toMatchObject({ status: 409 });
  });
  it('does not grant Creator for a different price or paused collection', async () => {
    await billing.checkout(owner); stripeState.status = 'active'; stripeState.price = 'price_other';
    expect((await billing.status(owner)).creator).toBe(false);
    await expect(billing.checkout(owner)).rejects.toMatchObject({ status: 409 });
    await expect(billing.beforeDelete(owner)).rejects.toMatchObject({ status: 409 });
    stripeState.price = 'price_creator'; stripeState.paused = true;
    expect((await billing.status(owner)).creator).toBe(false);
  });
  it('rejects stale progress, output and failure without deleting the current claim files', async () => {
    await job();
    for (const action of ['progress', 'output', 'fail']) {
      const response = await app.request(`/internal/worker/jobs/rnd_test/${action}`, { method: action === 'output' ? 'PUT' : 'POST', headers: workerHeaders(oldToken), body: action === 'output' ? 'old output' : JSON.stringify({ progress: 50, error: 'old failure' }) });
      expect(response.status).toBe(409);
    }
    expect(await readFile(join(dir, 'rnd_test/output.mp4'), 'utf8')).toBe('keep this output');
    expect((await database.db.query.renderJob.findFirst())?.status).toBe('running');
    const response = await app.request('/internal/worker/jobs/rnd_test/progress', { method: 'POST', headers: workerHeaders(newToken), body: JSON.stringify({ progress: 25 }) });
    expect(response.status).toBe(200);
  });
  it('does not delete finished output when a late failure report arrives', async () => {
    await job('done');
    const response = await app.request('/internal/worker/jobs/rnd_test/fail', { method: 'POST', headers: workerHeaders(newToken), body: JSON.stringify({ error: 'late' }) });
    expect(response.status).toBe(409);
    expect(await readFile(join(dir, 'rnd_test/output.mp4'), 'utf8')).toBe('keep this output');
  });
  it('commits output and render usage together for the current claim', async () => {
    await job();
    const response = await app.request('/internal/worker/jobs/rnd_test/output', { method: 'PUT', headers: workerHeaders(newToken), body: 'new output' });
    expect(response.status).toBe(204);
    expect((await database.db.query.renderJob.findFirst())?.status).toBe('done');
    expect(await readFile(join(dir, 'rnd_test/output.mp4'), 'utf8')).toBe('new output');
    expect((await database.db.query.usageEvent.findFirst())?.units).toBe(10);
  });
  it('waits for a current output writer before deleting its files', async () => {
    await job();
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('output'));
      // The second pull means the handler has acquired its row lock and consumed the first bytes.
      finish = () => controller.close();
    }, pull() { started(); } });
    const writing = app.request('/internal/worker/jobs/rnd_test/output', { method: 'PUT', headers: workerHeaders(newToken), body, duplex: 'half' } as RequestInit);
    await ready;
    const deleting = app.request('/v1/renders/rnd_test', { method: 'DELETE', headers: { authorization: `Bearer ${key}` } });
    finish();
    expect((await writing).status).toBe(204);
    expect((await deleting).status).toBe(204);
    expect((await database.db.query.renderJob.findFirst())?.status).toBe('expired');
    expect(await storage.size('rnd_test/output.mp4')).toBe(0);
  });
  it('reserves at most three active jobs under concurrent submissions', async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => app.request('/v1/renders', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ data: spec.data, options: spec.options, media: [] }) })));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(5);
  });
  it('reserves monthly minutes atomically', async () => {
    await database.db.insert(schema.renderJob).values({ id: 'rnd_used', userId: owner, status: 'done', spec, durationSeconds: 7190 });
    const responses = await Promise.all(Array.from({ length: 3 }, () => app.request('/v1/renders', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ data: spec.data, options: spec.options, media: [] }) })));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 403)).toHaveLength(2);
  });
  it('removes failed and orphan directories while preserving active and retained output', async () => {
    await job('failed');
    await database.db.insert(schema.renderJob).values({ id: 'rnd_active', userId: owner, status: 'queued', spec, durationSeconds: 10 });
    await storage.put('rnd_active/media-song', new Blob(['song']).stream(), 100);
    await storage.put('rnd_orphan/output.mp4', new Blob(['orphan']).stream(), 100);
    await database.db.insert(schema.renderJob).values({ id: 'rnd_retained', userId: owner, status: 'done', spec, durationSeconds: 10, expiresAt: new Date(Date.now() + 60_000) });
    await storage.put('rnd_retained/output.mp4', new Blob(['video']).stream(), 100);
    await storage.put('rnd_retained/media-song', new Blob(['song']).stream(), 100);
    const { expireRenders } = await import('../src/lib/render-cleanup.js');
    await expireRenders();
    expect(await storage.size('rnd_test/output.mp4')).toBe(0);
    expect(await storage.size('rnd_orphan/output.mp4')).toBe(0);
    expect(await storage.size('rnd_active/media-song')).toBe(4);
    expect(await storage.size('rnd_retained/output.mp4')).toBe(5);
    expect(await storage.size('rnd_retained/media-song')).toBe(0);
    await database.db.delete(database.schema.user).where(eq(database.schema.user.id, owner));
    await expireRenders();
    expect(await storage.size('rnd_active/media-song')).toBe(0);
  });
  it('keeps streaming render media above the JSON limit and rolls back oversized replacements', async () => {
    await job('awaiting_upload');
    const size = 3 * 1024 * 1024;
    await database.db.insert(schema.renderMedia).values({ jobId: 'rnd_test', mediaId: 'song', kind: 'audio', name: 'song', size });
    const response = await app.request('/v1/renders/rnd_test/media/song', { method: 'PUT', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(size) });
    expect(response.status).toBe(204);
    expect(response.headers.get('upload-offset')).toBe(String(size));
    const oversized = await app.request('/v1/renders/rnd_test/media/song', { method: 'PUT', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(size + 1) });
    expect(oversized.status).toBe(413);
    expect((await database.db.query.renderMedia.findFirst())?.uploaded).toBe(false);
    expect(await storage.size('rnd_test/media-song')).toBe(0);
  });
  it('rejects oversized thumbnails and JSON, with or without Content-Length', async () => {
    for (const [path, type, bytes] of [['/v1/projects/missing/thumbnail', 'image/png', 256 * 1024 + 1], ['/v1/projects', 'application/json', 2 * 1024 * 1024 + 1]] as const) {
      for (const declared of ['absent', 'accurate', 'too-small']) {
        const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'content-type': type };
        if (declared !== 'absent') headers['content-length'] = declared === 'accurate' ? String(bytes) : '1';
        const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(bytes)); controller.close(); } });
        const response = await app.request(path, { method: path.endsWith('thumbnail') ? 'PUT' : 'POST', headers, body, duplex: 'half' } as RequestInit);
        expect(response.status).toBe(413);
        expect(response.headers.get('content-type')).toContain('application/problem+json');
      }
    }
  });
});
