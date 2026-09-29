import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

/** Typed client for the Undertow API, generated from its OpenAPI document (npm run api:types). */
export const api = createClient<paths>({ baseUrl: '', credentials: 'include' });

export type Schemas = components['schemas'];

/** An API error in RFC 9457 problem form. */
export class ApiProblem extends Error {
  constructor(readonly status: number, readonly title: string, readonly detail?: string) {
    super(detail ?? title);
  }
}

/** Returns the data or throws an ApiProblem, so callers can use try/catch instead of checking two fields. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let r: Awaited<typeof p>;
  try {
    r = await p;
  } catch {
    throw new ApiProblem(0, 'Offline', 'Could not reach Undertow. Check your connection.');
  }
  if (r.response.ok) return r.data as T;
  const e = (r.error ?? {}) as { title?: string; detail?: string };
  throw new ApiProblem(r.response.status, e.title ?? r.response.statusText, e.detail);
}
