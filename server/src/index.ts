import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { pool } from './db/index.js';
import { expireRenders } from './lib/render-cleanup.js';
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
void expireRenders().catch((e) => console.error('expiry failed', e));
setInterval(() => void expireRenders().catch((e) => console.error('expiry failed', e)), 3_600_000).unref();

// Finish in-flight requests and close the pool on shutdown (Docker sends SIGTERM).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => { void pool.end().then(() => process.exit(0)); }));
}
