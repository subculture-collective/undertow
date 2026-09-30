import { serve } from '@hono/node-server';
import { and, eq, lt } from 'drizzle-orm';
import { createApp } from './app.js';
import { db, pool } from './db/index.js';
import { renderJob } from './db/schema.js';
import { storage } from './lib/storage.js';
import { env, providers } from './env.js';

const app = createApp();
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  const enabled = Object.entries(providers).filter(([, on]) => on).map(([p]) => p);
  console.log(`Undertow API on http://localhost:${info.port} (docs at /docs). OAuth: ${enabled.join(', ') || 'none configured'}.`);
});

/**
 * Hourly: deletes render outputs past their expiry, and cancels jobs whose
 * uploads were never finished (refunding their minutes and freeing the slot).
 */
async function expireRenders() {
  const due = await db.update(renderJob).set({ status: 'expired', outputBytes: null })
    .where(and(eq(renderJob.status, 'done'), lt(renderJob.expiresAt, new Date()))).returning({ id: renderJob.id });
  const abandoned = await db.update(renderJob).set({ status: 'cancelled', finishedAt: new Date(), error: 'Uploads were not completed within a day.' })
    .where(and(eq(renderJob.status, 'awaiting_upload'), lt(renderJob.createdAt, new Date(Date.now() - 86_400_000)))).returning({ id: renderJob.id });
  for (const j of [...due, ...abandoned]) await storage.removeJob(j.id);
  if (due.length || abandoned.length) console.log(`Expired ${due.length} render output(s); cancelled ${abandoned.length} abandoned upload(s).`);
}
void expireRenders();
setInterval(() => void expireRenders().catch((e) => console.error('expiry failed', e)), 3_600_000).unref();

// Finish in-flight requests and close the pool on shutdown (Docker sends SIGTERM).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => { void pool.end().then(() => process.exit(0)); }));
}
