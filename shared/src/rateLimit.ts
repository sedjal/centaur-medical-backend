/**
 * Simple in-memory rate limiter (per key).
 * Suitable for a single-node demo; use Redis in production.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
}) {
  const hits = new Map<string, { count: number; reset: number }>();

  function allow(key: string): boolean {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + options.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= options.limit;
  }

  function reset(key?: string): void {
    if (key) hits.delete(key);
    else hits.clear();
  }

  return { allow, reset };
}
