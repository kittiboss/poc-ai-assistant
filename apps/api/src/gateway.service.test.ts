import { afterEach, describe, expect, it, vi } from 'vitest';
import { GatewayService } from './gateway.service';

describe('gateway abstraction', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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
});
