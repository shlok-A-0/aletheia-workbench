/**
 * Rate limiting for the chat endpoint.
 *
 * Serverless instances don't share memory, so the in-memory counter only limits per instance.
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, counters live in Upstash
 * (REST API, no extra dependency) and are shared across instances. If Upstash is unreachable
 * the limiter falls back to the in-memory counter rather than blocking every request.
 */
export interface Limiter {
  /** Returns true when the request is allowed. */
  hit(key: string, limit: number, windowMs: number): Promise<boolean>;
}

export function createMemoryLimiter(): Limiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    async hit(key, limit, windowMs) {
      const now = Date.now();
      if (buckets.size > 5000) buckets.clear();
      for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
      const entry = buckets.get(key);
      if (entry && entry.resetAt > now) {
        if (entry.count >= limit) return false;
        entry.count++;
        return true;
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    },
  };
}

export function createUpstashLimiter(url: string, token: string, fallback: Limiter): Limiter {
  const base = url.replace(/\/$/, '');
  return {
    async hit(key, limit, windowMs) {
      try {
        const bucket = Math.floor(Date.now() / windowMs);
        const redisKey = `aletheia:rl:${key}:${bucket}`;
        const res = await fetch(`${base}/pipeline`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify([
            ['INCR', redisKey],
            ['PEXPIRE', redisKey, String(windowMs), 'NX'],
          ]),
          signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) throw new Error(`upstash ${res.status}`);
        const data = (await res.json()) as Array<{ result?: number }>;
        const count = Number(data[0]?.result);
        if (!Number.isFinite(count)) throw new Error('upstash bad response');
        return count <= limit;
      } catch {
        return fallback.hit(key, limit, windowMs);
      }
    },
  };
}

export function createLimiter(env: NodeJS.ProcessEnv = process.env): Limiter {
  const memory = createMemoryLimiter();
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? createUpstashLimiter(url, token, memory) : memory;
}
