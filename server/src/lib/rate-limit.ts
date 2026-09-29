/**
 * Fixed-window request limiter, in memory. Good for a single API instance;
 * running several instances needs a shared store (Postgres or Redis) behind
 * the same `take` function.
 */
interface Window { start: number; count: number }
const windows = new Map<string, Window>();
const WINDOW_MS = 60_000;

export interface RateResult { allowed: boolean; limit: number; remaining: number; resetSeconds: number }

export function take(key: string, limit: number, nowMs = Date.now()): RateResult {
  let w = windows.get(key);
  if (!w || nowMs - w.start >= WINDOW_MS) windows.set(key, (w = { start: nowMs, count: 0 }));
  const allowed = w.count < limit;
  if (allowed) w.count++;
  return {
    allowed, limit, remaining: Math.max(0, limit - w.count),
    resetSeconds: Math.ceil((w.start + WINDOW_MS - nowMs) / 1000),
  };
}

// Drop windows that ended long ago so the map doesn't grow without bound.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS * 2;
  for (const [k, w] of windows) if (w.start < cutoff) windows.delete(k);
}, WINDOW_MS).unref();
