import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryLimiter, createUpstashLimiter } from './rateLimit';

afterEach(() => vi.unstubAllGlobals());

describe('rate limiters', () => {
  it('memory limiter blocks after the limit', async () => {
    const l = createMemoryLimiter();
    expect(await l.hit('a', 2, 1000)).toBe(true);
    expect(await l.hit('a', 2, 1000)).toBe(true);
    expect(await l.hit('a', 2, 1000)).toBe(false);
    expect(await l.hit('b', 2, 1000)).toBe(true);
  });

  it('upstash limiter uses the shared count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ result: 3 }, { result: 1 }]))));
    const l = createUpstashLimiter('https://x.upstash.io', 't', createMemoryLimiter());
    expect(await l.hit('a', 2, 1000)).toBe(false);
    expect(await l.hit('a', 3, 1000)).toBe(true);
  });

  it('falls back to memory when upstash is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const l = createUpstashLimiter('https://x.upstash.io', 't', createMemoryLimiter());
    expect(await l.hit('a', 1, 1000)).toBe(true);
    expect(await l.hit('a', 1, 1000)).toBe(false);
  });
});
