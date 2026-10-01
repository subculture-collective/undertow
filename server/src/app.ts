import { OpenAPIHono } from '@hono/zod-openapi';
import { serveStatic } from '@hono/node-server/serve-static';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTH_BASE_PATH, auth } from './auth.js';
import { pool } from './db/index.js';
import { env, isProd, trustedOrigins } from './env.js';
import type { AppEnv } from './lib/caller.js';
import { ApiError, problemBody } from './lib/problem.js';
import { limitRequestBody } from './lib/body-limits.js';
import { keys } from './routes/keys.js';
import { library } from './routes/library.js';
import { me } from './routes/me.js';
import { meta } from './routes/meta.js';
import { projects } from './routes/projects.js';
import { renders } from './routes/renders.js';
import { worker } from './routes/worker.js';
import { billingRoutes } from './routes/billing.js';

const problem = (status: number, detail?: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(problemBody(status, detail)), { status, headers: { 'content-type': 'application/problem+json', ...headers } });

export function createApp() {
  const app = new OpenAPIHono<AppEnv>();

  app.use('*', secureHeaders({ crossOriginResourcePolicy: false }));
  app.use('*', async (c, next) => {
    await next();
    if (/^\/(v1|internal|docs)(\/|$)/.test(c.req.path)
      || ['/render.html', '/styleguide.html', '/healthz'].includes(c.req.path)
      || ['token', 'account', 'verified', 'error', 'checkout'].some((key) => c.req.query(key) !== undefined)
      || c.res.status === 404) c.header('X-Robots-Tag', 'noindex, nofollow');
  });
  // Browsers on other trusted origins may call with cookies; API-key clients are not origin-bound.
  app.use('/v1/*', cors({
    origin: (origin) => (trustedOrigins.includes(origin) ? origin : null),
    credentials: true,
    allowHeaders: ['content-type', 'authorization', 'x-api-key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset', 'Retry-After', 'Upload-Offset'],
    maxAge: 600,
  }));
  app.use('*', limitRequestBody);

  app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  app.get('/healthz', async (c) => {
    await pool.query('select 1');
    return c.json({ ok: true });
  });

  app.route('/v1', meta);
  app.route('/v1', billingRoutes);
  app.route('/v1', me);
  app.route('/v1', projects);
  app.route('/v1', library);
  app.route('/v1', keys);
  app.route('/v1', renders);
  // Worker and render-page routes: not versioned, not in the public docs.
  app.route('/internal', worker);

  app.openAPIRegistry.registerComponent('securitySchemes', 'session', {
    type: 'apiKey', in: 'cookie', name: `${isProd ? '__Secure-' : ''}ut.session_token`,
    description: 'Browser session from signing in (see the Auth section).',
  });
  app.openAPIRegistry.registerComponent('securitySchemes', 'bearer', {
    type: 'http', scheme: 'bearer', description: 'An API key: `Authorization: Bearer ut_…`. Create keys at POST /v1/keys.',
  });

  const info = {
    openapi: '3.1.0',
    info: {
      title: 'Undertow API', version: '1.0.0',
      description: 'Accounts, projects, templates, palettes and presets for Undertow. Authenticate with a browser session or an API key. Errors are RFC 9457 problem details. Every response carries RateLimit-* headers.',
    },
    servers: [{ url: env.PUBLIC_URL }],
  };

  /** Our routes plus Better Auth's endpoints, under one document. */
  app.get('/v1/openapi.json', async (c) => {
    const ours = app.getOpenAPI31Document(info);
    const authDoc = await auth.api.generateOpenAPISchema() as unknown as { paths: Record<string, Record<string, { tags?: string[] }>>; components?: { schemas?: Record<string, unknown> } };
    for (const [path, ops] of Object.entries(authDoc.paths)) {
      for (const op of Object.values(ops)) op.tags = ['Auth'];
      ours.paths = { ...ours.paths, [`${AUTH_BASE_PATH}${path}`]: ops as never };
    }
    ours.components = { ...ours.components, schemas: { ...authDoc.components?.schemas, ...ours.components?.schemas } as never };
    return c.json(ours);
  });
  app.get('/docs', Scalar({ url: '/v1/openapi.json', pageTitle: 'Undertow API' }));

  if (env.STATIC_DIR) {
    // Account links use query parameters on the editor; unknown paths must remain 404s.
    const index = readFileSync(join(env.STATIC_DIR, 'index.html'), 'utf8');
    app.get('/index.html', (c) => c.redirect('/', 308));
    app.use('/*', serveStatic({ root: env.STATIC_DIR }));
    app.get('/', (c) => c.html(index));
  }

  app.notFound(() => problem(404, 'No such endpoint.'));
  app.onError((err) => {
    if (err instanceof ApiError) return problem(err.status, err.detail, err.headers);
    console.error(err);
    return problem(500, isProd ? undefined : String(err));
  });

  return app;
}
