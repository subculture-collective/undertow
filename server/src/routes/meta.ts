import { createRoute, z } from '@hono/zod-openapi';
import { providers } from '../env.js';
import { json, router } from '../lib/router.js';

/** Public, unauthenticated facts clients need before signing in. */
export const meta = router();

meta.openapi(createRoute({
  method: 'get', path: '/meta', tags: ['Meta'], summary: 'API version and which sign-in providers are enabled',
  responses: {
    200: json(z.object({
      apiVersion: z.string(),
      providers: z.object({ google: z.boolean(), discord: z.boolean() }),
    }).openapi('Meta'), 'Service information'),
  },
}), (c) => c.json({ apiVersion: '1', providers }, 200));
