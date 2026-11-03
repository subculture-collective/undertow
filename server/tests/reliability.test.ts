import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import Stripe from 'stripe';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';

describe.skipIf(!process.env.TEST_DATABASE_URL)('API reliability with disposable Postgres', () => {
  let app: ReturnType<typeof import('../src/app.js').createApp>;
  let database: typeof import('../src/db/index.js');
  let schema: typeof import('../src/db/schema.js');
  let storage: typeof import('../src/lib/storage.js').storage;
  let dir: string;
  let key: string;
  let billing: InstanceType<typeof import('../src/lib/billing.js').Billing>;
  let stripeServer: ReturnType<typeof createServer>;
  let stripeState: { status: string | null; cancel: boolean; cancelAt: number | null; paused: boolean; paid: boolean; price: string; periodEnd: number; checkoutCount: number; open: boolean; fail: boolean };
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
        return send({ object: 'list', has_more: false, data: stripeState.status ? [{ id: 'sub_test', object: 'subscription', customer: 'cus_test', livemode: false, status: stripeState.status, latest_invoice: { status: stripeState.paid ? 'paid' : 'open' }, created: 100, cancel_at_period_end: stripeState.cancel, cancel_at: stripeState.cancelAt, pause_collection: stripeState.paused ? { behavior: 'void' } : null,
          items: { data: [{ price: { id: stripeState.price }, quantity: 1, current_period_end: stripeState.periodEnd }] } }] : [] });
      }
      if (url.pathname === '/v1/checkout/sessions' && req.method === 'GET') return send({ object: 'list', has_more: false, data: stripeState.open ? [{ id: 'cs_test', url: 'https://checkout.stripe.com/test', metadata: { app: 'undertow', priceId: 'price_creator' } }] : [] });
      if (url.pathname === '/v1/checkout/sessions' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk.toString();
        expect(new URLSearchParams(body).get('managed_payments[enabled]')).toBe('false');
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
    stripeState = { status: null, cancel: false, cancelAt: null, paused: false, paid: true, price: 'price_creator', periodEnd: Math.floor(Date.now() / 1000) + 86400, checkoutCount: 0, open: false, fail: false };
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
    stripeState.cancel = false; stripeState.cancelAt = stripeState.periodEnd - 3600;
    const scheduled = await billing.status(owner);
    expect(scheduled.cancelAtPeriodEnd).toBe(true);
    expect(scheduled.periodEnd).toBe(new Date(stripeState.cancelAt * 1000).toISOString());
    expect(scheduled.creator).toBe(true);
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
    stripeState.paused = false; stripeState.paid = false;
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
  it('lets a cancellation during an output upload win and leaves no files behind', async () => {
    await job();
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('output'));
      // The second pull means the handler is streaming the body.
      finish = () => controller.close();
    }, pull() { started(); } });
    const writing = app.request('/internal/worker/jobs/rnd_test/output', { method: 'PUT', headers: workerHeaders(newToken), body, duplex: 'half' } as RequestInit);
    await ready;
    // The upload holds no lock while streaming, so cancelling doesn't wait for it.
    expect((await app.request('/v1/renders/rnd_test', { method: 'DELETE', headers: { authorization: `Bearer ${key}` } })).status).toBe(204);
    finish();
    expect((await writing).status).toBe(409);
    const cancelled = await database.db.query.renderJob.findFirst();
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.outputBytes).toBeNull();
    expect(await readdir(join(dir, 'rnd_test')).catch(() => [])).toEqual([]);
    expect((await database.db.select().from(schema.usageEvent).where(eq(schema.usageEvent.method, 'RENDER')))).toHaveLength(0);
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
    // The replacement streams to a temporary file, so the earlier complete upload is untouched.
    expect((await database.db.query.renderMedia.findFirst())?.uploaded).toBe(true);
    expect(await storage.size('rnd_test/media-song')).toBe(size);
    expect((await readdir(join(dir, 'rnd_test'))).filter((f) => f.includes('.part-'))).toEqual([]);
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
  it('revokes API keys when their account is deleted', async () => {
    const auth = (await import('../src/auth.js')).auth;
    const headers = { authorization: `Bearer ${key}` };
    expect((await app.request('/v1/projects', { headers })).status).toBe(200);
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Better Auth deletes the user row, then runs afterDelete; the key table has no foreign key to cascade.
    await database.db.delete(database.schema.user);
    await auth.options.user!.deleteUser!.afterDelete!({ id: owner } as never);
    expect((await app.request('/v1/projects', { headers })).status).toBe(401);
  });
  it('rejects render media ids that the upload path and storage could never accept', async () => {
    const create = (media: { id: string }[]) => app.request('/v1/renders', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data: spec.data, options: spec.options, media: media.map((m) => ({ ...m, kind: 'image', name: 'a.png', size: 10 })) }),
    });
    for (const id of ['x'.repeat(65), 'has space', 'a:b', '..', '.hidden']) expect((await create([{ id }])).status, id).toBe(422);
    expect((await create([{ id: 'same' }, { id: 'same' }])).status).toBe(422);
    expect(await database.db.select().from(schema.renderJob)).toHaveLength(0);
  });
  it('does not count finished renders as API requests in usage', async () => {
    await database.db.insert(schema.usageEvent).values([
      { userId: owner, method: 'GET', route: '/v1/projects', status: 200 },
      { userId: owner, method: 'RENDER', route: '/v1/renders/:id', status: 200, units: 30 },
    ]);
    const usage = await (await app.request('/v1/usage', { headers: { authorization: `Bearer ${key}` } })).json() as { days: { requests: number; units: number }[] };
    expect(usage.days).toHaveLength(1);
    expect(usage.days[0]).toMatchObject({ requests: 1, units: 31 });
  });
  it('holds no database connection while an upload body streams, and orders racing chunks by offset', async () => {
    await job('awaiting_upload');
    await database.db.insert(schema.renderMedia).values({ jobId: 'rnd_test', mediaId: 'song', kind: 'audio', name: 'song', size: 10 });
    const put = (offset: number, body: BodyInit) => app.request(`/v1/renders/rnd_test/media/song?offset=${offset}`,
      { method: 'PUT', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/octet-stream' }, body, duplex: 'half' } as RequestInit);
    let finish!: () => void;
    let streaming!: () => void;
    const ready = new Promise<void>((resolve) => { streaming = resolve; });
    const slow = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(4));
      finish = () => controller.close();
    }, pull() { streaming(); } });
    const first = put(0, slow);
    await ready;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(database.pool.totalCount - database.pool.idleCount).toBe(0);
    finish();
    expect((await first).headers.get('upload-offset')).toBe('4');
    // Two clients send the same next chunk: one is appended, the other learns the new offset.
    const racing = await Promise.all([put(4, new Uint8Array(3)), put(4, new Uint8Array(3))]);
    expect(racing.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(racing.find((r) => r.status === 409)?.headers.get('upload-offset')).toBe('7');
    expect((await put(7, new Uint8Array(3))).headers.get('upload-offset')).toBe('10');
    expect((await database.db.query.renderMedia.findFirst())?.uploaded).toBe(true);
    expect(await readdir(join(dir, 'rnd_test'))).toEqual(expect.arrayContaining(['media-song']));
    expect((await readdir(join(dir, 'rnd_test'))).filter((f) => f.includes('.part-'))).toEqual([]);
  });
  it('keeps plan limits under concurrent creates', async () => {
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' };
    const filler = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}_fill${i}`, userId: owner, name: 'x', data: spec.data }));
    await database.db.insert(schema.project).values(filler('prj', 499).map((p) => ({ ...p, media: [] })));
    const projects = await Promise.all(Array.from({ length: 6 }, () => app.request('/v1/projects', { method: 'POST', headers, body: JSON.stringify({ name: 'P', data: spec.data, media: [] }) })));
    expect(projects.filter((r) => r.status === 201)).toHaveLength(1);
    expect(projects.filter((r) => r.status === 403)).toHaveLength(5);
    expect(await database.db.$count(schema.project)).toBe(500);
    await database.db.insert(schema.template).values(filler('tpl', 199));
    const templates = await Promise.all(Array.from({ length: 6 }, () => app.request('/v1/templates', { method: 'POST', headers, body: JSON.stringify({ name: 'T', data: spec.data }) })));
    expect(templates.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await database.db.$count(schema.template)).toBe(200);
  });
  it('requeues, then fails, running jobs whose worker went quiet without any worker claiming', async () => {
    const { requeueStaleRenders } = await import('../src/lib/render-cleanup.js');
    await job();
    const old = new Date(Date.now() - 10 * 60_000);
    await database.db.update(schema.renderJob).set({ heartbeatAt: old, attempts: 1 });
    await requeueStaleRenders();
    expect(await database.db.query.renderJob.findFirst()).toMatchObject({ status: 'queued', tokenHash: null });
    await database.db.update(schema.renderJob).set({ status: 'running', heartbeatAt: old, attempts: 2 });
    await requeueStaleRenders();
    expect(await database.db.query.renderJob.findFirst()).toMatchObject({ status: 'failed', error: 'The render stopped responding.' });
    await database.db.update(schema.renderJob).set({ status: 'running', heartbeatAt: new Date(), attempts: 1 });
    await requeueStaleRenders();
    expect((await database.db.query.renderJob.findFirst())?.status).toBe('running');
  });
  it('pages through projects saved within the same millisecond without skipping any', async () => {
    const at = (us: string) => sql`${'2026-01-01 00:00:00.' + us + '+00'}::timestamptz`;
    await database.db.insert(schema.project).values([
      { id: 'prj_a', userId: owner, name: 'A', data: spec.data, media: [], updatedAt: at('123456') as never },
      { id: 'prj_z', userId: owner, name: 'Z', data: spec.data, media: [], updatedAt: at('123200') as never },
      { id: 'prj_y', userId: owner, name: 'Y', data: spec.data, media: [], updatedAt: at('123200') as never },
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const query: string = cursor ? `?limit=1&cursor=${cursor}` : '?limit=1';
      const page = await (await app.request(`/v1/projects${query}`, { headers: { authorization: `Bearer ${key}` } })).json() as { items: { id: string }[]; nextCursor: string | null };
      seen.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['prj_a', 'prj_z', 'prj_y']);
    expect((await app.request('/v1/projects?cursor=bm90LWEtY3Vyc29y', { headers: { authorization: `Bearer ${key}` } })).status).toBe(400);
  });
  it('blocks checkout only while an account deletion is recent', async () => {
    await billing.checkout(owner);
    stripeState.open = false;
    await database.db.update(schema.billingCustomer).set({ deletingAt: new Date() });
    await expect(billing.checkout(owner)).rejects.toMatchObject({ status: 409 });
    await database.db.update(schema.billingCustomer).set({ deletingAt: new Date(Date.now() - 20 * 60_000) });
    expect(await billing.checkout(owner)).toBe('https://checkout.stripe.com/test');
    expect((await database.db.query.billingCustomer.findFirst())?.leaseToken).toBeNull();
  });
});
