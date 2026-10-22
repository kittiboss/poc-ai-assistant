import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayService } from './gateway.service';

describe('gateway abstraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it('correlates chat and embedding calls with the authoritative ledger and keeps the returned charge', async () => {
    const billing = { requestId: 'req-ledger', charge: '0.004000000', priceVersion: '7', estimated: false, simulation: true };
    const fetchMock = vi.fn().mockImplementationOnce(async () => new Response(`data: ${JSON.stringify({ usage: { prompt_tokens: 3, completion_tokens: 2 }, billing })}\n\ndata: [DONE]\n\n`))
      .mockImplementationOnce(async () => Response.json({ data: [{ embedding: [1, 0], index: 0 }], usage: { prompt_tokens: 2 }, billing }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new GatewayService();
    const usage = await gateway.stream('local-mock', [{ role: 'user', content: 'hi' }], new AbortController().signal, () => undefined, { requestId: 'req-ledger' });
    expect(fetchMock.mock.calls[0][1].headers['X-Request-Id']).toBe('req-ledger');
    expect(usage?.billing).toEqual(billing);
    const embedded = await gateway.embed('mock-embedding', ['hi'], 2, false, undefined, 'req-ledger:retrieval');
    expect(fetchMock.mock.calls[1][1].headers['X-Request-Id']).toBe('req-ledger:retrieval');
    expect(embedded.usage?.billing?.charge).toBe('0.004000000');
  });
  it('parses streamed OpenAI-compatible chunks and usage', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}],"usage":{"prompt_tokens":2,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('AI_MAX_OUTPUT_TOKENS', '32');
    const chunks: string[] = [];
    const usage = await new GatewayService().stream('local-mock', [{ role: 'user', content: 'hi' }], new AbortController().signal, (text) => chunks.push(text));
    expect(chunks.join('')).toBe('hello world');
    expect(usage?.completion_tokens).toBe(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'local-mock', max_tokens: 32, stream: true });
  });

  it('converts provider failures into safe gateway errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"simulated"}', { status: 503 })));
    await expect(new GatewayService().stream('local-mock', [{ role: 'user', content: '[mock:error]' }], new AbortController().signal, () => undefined)).rejects.toMatchObject({ status: 502 });
  });

  it('surfaces provider rate limits (e.g. Gemini free-tier quota) as 429 without leaking provider detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"RESOURCE_EXHAUSTED quota detail"}}', { status: 429 })));
    const error = await new GatewayService().stream('google-gemini', [{ role: 'user', content: 'hi' }], new AbortController().signal, () => undefined).catch((cause) => cause);
    expect(error.getStatus()).toBe(429);
    expect(error.message).toMatch(/free-tier quota/);
    expect(error.message).not.toContain('RESOURCE_EXHAUSTED');
  });

  it('fails a stream that reports a provider error after it started', async () => {
    const body = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"code":429,"message":"quota"}}\n\n';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    const chunks: string[] = [];
    const error = await new GatewayService().stream('google-gemini', [{ role: 'user', content: 'hi' }], new AbortController().signal, (text) => chunks.push(text)).catch((cause) => cause);
    expect(chunks).toEqual(['partial']);
    expect(error.getStatus()).toBe(429);
  });

  it('discovers routes from gateway config only and degrades to none when LiteLLM is down', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: 'local-mock' }, { id: 'qwen-local' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect([...await new GatewayService().routes()]).toEqual(['local-mock', 'qwen-local']);
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual(['/health/readiness', '/v1/models']);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    expect((await new GatewayService().routes()).size).toBe(0);
  });

  it('runs the default suite with non-local network access blocked', async () => {
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models')).rejects.toThrow(/Blocked non-local network call/);
    await expect(fetch('https://api.openai.com/v1/models')).rejects.toThrow(/Blocked non-local network call/);
  });

  it.skipIf(!process.env.OLLAMA_TEST_URL)('can discover Ollama when explicitly supplied by the operator', async () => {
    const response = await fetch(`${process.env.OLLAMA_TEST_URL}/api/tags`);
    expect(response.ok).toBe(true);
  });

  it('embeds through LiteLLM, requesting a vector size only when asked, and keeps input order', async () => {
    const vector = (first: number) => [first, ...Array(767).fill(0)];
    // LiteLLM's Gemini adapter reports index 0 for every item, so response order is kept.
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: vector(1) }, { index: 0, embedding: vector(2) }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { vectors } = await new GatewayService().embed('gemini-embedding', ['a', 'b'], 768, true);
    expect(vectors.map((v) => v[0])).toEqual([1, 2]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'gemini-embedding', input: ['a', 'b'], dimensions: 768 });
    await new GatewayService().embed('mock-embedding', ['a', 'b'], 768, false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty('dimensions');
  });

  it('rejects embeddings of the wrong size or count instead of storing them', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 2, 3] }] }), { status: 200 })));
    await expect(new GatewayService().embed('mock-embedding', ['a'], 768, false)).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":{"message":"quota"}}', { status: 429 })));
    await expect(new GatewayService().embed('gemini-embedding', ['a'], 768, true)).rejects.toMatchObject({ status: 429 });
  });
});

// Error bodies as the platform's LiteLLM gateway sends them (recorded by scripts/platform/platform-smoke.mjs).
const budgetExceeded = '{"error":{"message":"Budget has been exceeded! Current cost: 0.0001, Max budget: 1e-07","type":"budget_exceeded","param":null,"code":"400"}}';
const modelDenied = '{"error":{"message":"key not allowed to access model","type":"key_model_access_denied","param":"model","code":"401"}}';
const keyRateLimit = '{"error":{"message":"LiteLLM Rate Limit Handler for rate limit type = model_per_key. Crossed TPM / RPM / Max Parallel Request Limit.","type":"None","param":"None","code":"429"}}';
const send = (gateway: GatewayService) =>
  gateway.stream('local-mock', [{ role: 'user', content: 'hi' }], new AbortController().signal, () => undefined).catch((cause) => cause);

describe('vendor-managed gateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const vendorMode = (key = 'sk-organization-key') => {
    vi.stubEnv('MODEL_ACCESS', 'vendor-gateway');
    vi.stubEnv('LITELLM_API_KEY', key);
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-platform-master');
  };

  it('authenticates with the organization key, never the platform master key', async () => {
    vendorMode();
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new GatewayService().stream('local-mock', [{ role: 'user', content: 'hi' }], new AbortController().signal, () => undefined);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-organization-key');
  });

  it('refuses to start in vendor mode without an organization key', () => {
    vi.stubEnv('MODEL_ACCESS', 'vendor-gateway');
    vi.stubEnv('LITELLM_API_KEY', '');
    vi.stubEnv('LITELLM_MASTER_KEY', 'sk-platform-master');
    expect(() => new GatewayService()).toThrow(/LITELLM_API_KEY/);
  });

  it('turns gateway refusals into coded errors the web can explain', async () => {
    vendorMode();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(budgetExceeded, { status: 400 })));
    const spent = await send(new GatewayService());
    expect(spent.getStatus()).toBe(402);
    expect(spent.getResponse()).toMatchObject({ code: 'CREDIT_EXHAUSTED' });
    expect(spent.message).not.toContain('Max budget');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(modelDenied, { status: 401 })));
    expect((await send(new GatewayService())).getResponse()).toMatchObject({ statusCode: 403, code: 'MODEL_NOT_ENTITLED' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(keyRateLimit, { status: 429 })));
    expect((await send(new GatewayService())).getResponse()).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(budgetExceeded, { status: 400 })));
    await expect(new GatewayService().embed('mock-embedding', ['a'], 768, false)).rejects.toMatchObject({ status: 402 });
  });

  it("keeps listing the key's models once its credit is spent, since the gateway then refuses /v1/models", async () => {
    vendorMode();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(budgetExceeded, { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ info: { spend: 0.0002, max_budget: 0.0001, models: ['local-mock', 'mock-embedding'] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect([...await new GatewayService().routes()]).toEqual(['local-mock', 'mock-embedding']);
    expect(new URL(String(fetchMock.mock.calls[2][0])).pathname).toBe('/key/info');
  });

  it("reports the organization's prepaid credit from its own key, never below zero", async () => {
    vendorMode();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ info: { spend: 0.75, max_budget: 5 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const gateway = new GatewayService();
    expect(await gateway.credit()).toEqual({ currency: 'USD', limit: 5, spent: 0.75, remaining: 4.25, exhausted: false });
    await gateway.credit();
    expect(fetchMock).toHaveBeenCalledTimes(2); // No stale balance cache after a top-up.

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ info: { spend: 5.0004, max_budget: 5 } }), { status: 200 })));
    expect(await new GatewayService().credit()).toMatchObject({ remaining: 0, exhausted: true });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ info: { spend: 0, max_budget: null } }), { status: 200 })));
    expect(await new GatewayService().credit()).toBeNull();
  });

  it('has no credit outside vendor mode and does not ask the gateway', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await new GatewayService().credit()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
