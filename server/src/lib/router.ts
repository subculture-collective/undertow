import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from './caller.js';
import { problemBody } from './problem.js';

/** A router whose request validation failures come back as 422 problem details. */
export function router() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (result.success) return;
      return c.body(JSON.stringify(problemBody(422, z.prettifyError(result.error))), 422, {
        'content-type': 'application/problem+json',
      });
    },
  });
}

/** Both ways to authenticate, for route docs. */
export const secured: Record<string, string[]>[] = [{ session: [] }, { bearer: [] }];

export const json = <T extends z.ZodTypeAny>(schema: T, description: string) => ({
  description, content: { 'application/json': { schema } },
});

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
