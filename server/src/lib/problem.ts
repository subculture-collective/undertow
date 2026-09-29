import { z } from '@hono/zod-openapi';

/** Errors use RFC 9457 problem details, so every client handles them the same way. */
export const Problem = z.object({
  type: z.string().openapi({ example: '/problems/not-found' }),
  title: z.string().openapi({ example: 'Not found' }),
  status: z.number().int().openapi({ example: 404 }),
  detail: z.string().optional(),
}).openapi('Problem');

const TITLES: Record<number, [string, string]> = {
  400: ['bad-request', 'Bad request'],
  401: ['unauthorized', 'Sign in or send an API key'],
  403: ['forbidden', 'Not allowed'],
  404: ['not-found', 'Not found'],
  409: ['conflict', 'Conflict'],
  413: ['too-large', 'Payload too large'],
  422: ['invalid', 'Validation failed'],
  429: ['rate-limited', 'Too many requests'],
  501: ['not-implemented', 'Not implemented yet'],
};

export function problemBody(status: number, detail?: string) {
  const [slug, title] = TITLES[status] ?? ['error', 'Error'];
  return { type: `/problems/${slug}`, title, status, ...(detail ? { detail } : {}) };
}

/** Thrown by handlers and middleware; the app's error handler renders it as application/problem+json. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly detail?: string, readonly headers: Record<string, string> = {}) {
    super(detail ?? TITLES[status]?.[1] ?? 'Error');
  }
}

export function fail(status: number, detail?: string, headers?: Record<string, string>): never {
  throw new ApiError(status, detail, headers);
}

/** Standard error responses for route definitions. */
export const problems = (...codes: number[]) => Object.fromEntries(codes.map((c) => [c, {
  description: TITLES[c]?.[1] ?? 'Error',
  content: { 'application/problem+json': { schema: Problem } },
}]));
