import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { pool } from './db/index.js';
import { expireRenders, requeueStaleRenders } from './lib/render-cleanup.js';
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
// Every minute: retry or fail running jobs whose worker stopped reporting, even when no worker is claiming.
setInterval(() => void requeueStaleRenders().catch((e) => console.error('stale render check failed', e)), 60_000).unref();

// Uploads stream to disk without holding database connections, so a slow chunk only costs a socket.
// 48 MB chunks need over 6 minutes at 1 Mbit/s; the worker sends the finished video in one request.
(server as import('node:http').Server).requestTimeout = 15 * 60_000;

// Finish in-flight requests and close the pool on shutdown (Docker sends SIGTERM).
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => server.close(() => { void pool.end().then(() => process.exit(0)); }));
}
