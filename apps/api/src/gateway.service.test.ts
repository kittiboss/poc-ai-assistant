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

  it.skipIf(!process.env.OLLAMA_TEST_URL)('can discover Ollama when explicitly supplied by the operator', async () => {
    const response = await fetch(`${process.env.OLLAMA_TEST_URL}/api/tags`);
    expect(response.ok).toBe(true);
  });
});
