// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { DesignContext } from '../src/engine/types';
import { createApp } from './index';
import type { LLMAdapter, LLMRequest } from './llm/adapter';

const context: DesignContext = {
  page: '/kmap',
  function: { vars: ['A', 'B'], minterms: [1, 2], maxterms: [0, 3], dontCares: [] },
};

function mockAdapter(answer = 'A prime implicant is a maximal valid group.'): LLMAdapter & {
  generate: ReturnType<typeof vi.fn>;
} {
  return { generate: vi.fn(async (_request: LLMRequest) => answer) };
}

async function withServer<T>(
  options: Parameters<typeof createApp>[0],
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = createApp(options).listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validRequest = {
  messages: [{ role: 'user', content: 'Why is this group valid?' }],
  context,
  mode: 'explain',
};

afterEach(() => vi.restoreAllMocks());

describe('POST /api/chat', () => {
  it('rejects a missing body, oversized messages, and more than 20 messages', async () => {
    const adapter = mockAdapter();
    await withServer({ adapter, apiKey: 'test-secret' }, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/chat`, { method: 'POST' });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ error: 'invalid_request' });

      const oversized = await post(baseUrl, {
        ...validRequest,
        messages: [{ role: 'user', content: 'x'.repeat(4_001) }],
      });
      expect(oversized.status).toBe(400);

      const tooMany = await post(baseUrl, {
        ...validRequest,
        messages: Array.from({ length: 21 }, () => ({ role: 'user', content: 'question' })),
      });
      expect(tooMany.status).toBe(400);
      expect(adapter.generate).not.toHaveBeenCalled();
    });
  });

  it('applies the configured per-IP request limit', async () => {
    const adapter = mockAdapter();
    await withServer({ adapter, apiKey: 'test-secret', rateLimit: 2 }, async (baseUrl) => {
      expect((await post(baseUrl, validRequest)).status).toBe(200);
      expect((await post(baseUrl, validRequest)).status).toBe(200);
      const limited = await post(baseUrl, validRequest);
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: 'rate_limited' });
      expect(adapter.generate).toHaveBeenCalledTimes(2);
    });
  });

  it('passes context, policy, hint mode, and off-topic user content to the adapter without leaking the key', async () => {
    const apiKey = 'service-secret-value';
    const adapter = mockAdapter(apiKey);
    await withServer({ adapter, apiKey }, async (baseUrl) => {
      const response = await post(baseUrl, {
        ...validRequest,
        messages: [{ role: 'user', content: 'Tell me a movie plot instead.' }],
        mode: 'hint',
      });
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).not.toContain(apiKey);
      expect(body).not.toContain('LLM_API_KEY');
      const request = adapter.generate.mock.calls[0][0];
      expect(request.context).toEqual(context);
      expect(request.messages[0].content).toContain('movie plot');
      expect(request.systemPrompt).toContain('Only answer questions about digital logic');
      expect(request.systemPrompt).toContain('Give one hint or guiding question first');
      expect(request.systemPrompt).toContain('"page":"/kmap"');
      expect(request.apiKey).toBe(apiKey);

      await post(baseUrl, { ...validRequest, mode: 'explain' });
      const explainPrompt = adapter.generate.mock.calls[1][0].systemPrompt;
      expect(explainPrompt).toContain('Explain the requested digital-logic concept directly');
      expect(explainPrompt).not.toContain('Give one hint or guiding question first');
    });
  });

  it('trims large and unknown context fields to the fixed context bound', async () => {
    const adapter = mockAdapter();
    await withServer({ adapter, apiKey: 'test-secret' }, async (baseUrl) => {
      const response = await post(baseUrl, {
        ...validRequest,
        context: {
          ...context,
          minimization: {
            form: 'SOP',
            text: 'A'.repeat(3_000),
            termCount: 1,
            literalCount: 1,
            steps: Array.from({ length: 100 }, () => ({ title: 'huge', detail: 'not needed' })),
          },
          unexpected: 'x'.repeat(10_000),
        },
      });
      expect(response.status).toBe(200);
      const forwarded = adapter.generate.mock.calls[0][0].context;
      expect(JSON.stringify(forwarded).length).toBeLessThanOrEqual(2_000);
      expect(JSON.stringify(forwarded)).not.toContain('unexpected');
      expect(JSON.stringify(forwarded)).not.toContain('not needed');
    });
  });

  it('returns an unavailable response without exposing provider errors or secrets', async () => {
    const secret = 'never-return-this-key';
    const adapter: LLMAdapter = { generate: async () => { throw new Error(secret); } };
    await withServer({ adapter, apiKey: secret }, async (baseUrl) => {
      const response = await post(baseUrl, validRequest);
      expect(response.status).toBe(503);
      const body = await response.text();
      expect(body).toBe('{"error":"assistant_unavailable"}');
      expect(body).not.toContain(secret);
    });

    await withServer({ adapter, apiKey: '' }, async (baseUrl) => {
      const response = await post(baseUrl, validRequest);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'assistant_unavailable' });
    });
  });

  it('restricts cross-origin preflight to the configured development origin', async () => {
    await withServer({ adapter: mockAdapter(), apiKey: 'test-secret', clientOrigin: 'http://localhost:5173' }, async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/chat`, {
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173' },
      });
      expect(allowed.status).toBe(204);
      expect(allowed.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');

      const denied = await fetch(`${baseUrl}/api/chat`, {
        method: 'OPTIONS',
        headers: { origin: 'https://attacker.invalid' },
      });
      expect(denied.status).toBe(403);
    });
  });
});
