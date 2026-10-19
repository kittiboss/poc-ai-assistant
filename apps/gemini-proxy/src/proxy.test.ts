import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildUpstreamUrl, createGeminiProxy, isAllowedRequest, sanitizeBody } from './proxy';

const model = 'gemini-3.5-flash-lite';

describe('Gemini credential proxy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('removes LiteLLM query credentials before forwarding upstream', () => {
    const url = buildUpstreamUrl(`/v1beta/models/${model}:streamGenerateContent?key=local-dummy&alt=sse`);
    expect(url.origin).toBe('https://generativelanguage.googleapis.com');
    expect(url.pathname).toBe(`/v1beta/models/${model}:streamGenerateContent`);
    expect(url.searchParams.has('key')).toBe(false);
    expect(url.searchParams.get('alt')).toBe('sse');
  });

  it('normalizes the model path emitted for a custom Gemini API base', () => {
    const url = buildUpstreamUrl(`/models/${model}:streamGenerateContent?alt=sse`);
    expect(url.pathname).toBe(`/v1beta/models/${model}:streamGenerateContent`);
  });

  it('allows only text generation for the configured model', () => {
    const allowed = (method: string, path: string) => isAllowedRequest(method, buildUpstreamUrl(path), model);
    expect(allowed('POST', `/v1beta/models/${model}:streamGenerateContent?alt=sse`)).toBe(true);
    expect(allowed('POST', `/v1beta/models/${model}:generateContent`)).toBe(true);
    expect(allowed('POST', '/v1beta/models/gemini-3.1-pro-preview:generateContent')).toBe(false);
    expect(allowed('POST', `/v1beta/models/${model}:batchGenerateContent`)).toBe(false);
    expect(allowed('POST', '/v1beta/cachedContents')).toBe(false);
    expect(allowed('POST', '/v1beta:streamGenerateContent')).toBe(false);
    expect(allowed('GET', `/v1beta/models/${model}:generateContent`)).toBe(false);
  });

  it('rejects billable side features and clamps output tokens', () => {
    expect(sanitizeBody(Buffer.from(JSON.stringify({ contents: [], tools: [{ googleSearch: {} }] })), 512)).toMatch(/tools/);
    expect(sanitizeBody(Buffer.from(JSON.stringify({ contents: [], cachedContent: 'cachedContents/x' })), 512)).toMatch(/cachedContent/);
    expect(sanitizeBody(Buffer.from(JSON.stringify({ contents: [], cached_content: 'cachedContents/x' })), 512)).toMatch(/cached_content/);
    const clamped = JSON.parse((sanitizeBody(Buffer.from(JSON.stringify({ contents: [], generationConfig: { maxOutputTokens: 60000, candidateCount: 4 } })), 512) as Buffer).toString());
    expect(clamped.generationConfig).toEqual({ maxOutputTokens: 512, candidateCount: 1 });
    const defaulted = JSON.parse((sanitizeBody(Buffer.from(JSON.stringify({ contents: [] })), 256) as Buffer).toString());
    expect(defaulted.generationConfig.maxOutputTokens).toBe(256);
  });

  it('clamps the snake_case spelling LiteLLM sends without adding a conflicting camelCase field', () => {
    const body = { contents: [], generationConfig: { max_output_tokens: 4096, temperature: 0.2 } };
    const clamped = JSON.parse((sanitizeBody(Buffer.from(JSON.stringify(body)), 512) as Buffer).toString());
    expect(clamped.generationConfig).toEqual({ max_output_tokens: 512, temperature: 0.2, candidate_count: 1 });
    expect(clamped.generationConfig).not.toHaveProperty('maxOutputTokens');
  });

  it('never calls Google for a blocked request and sends the key only as a header', async () => {
    const upstream = vi.fn().mockResolvedValue(new Response('{"candidates":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const server = createGeminiProxy({ apiKey: 'test-key', model, maxOutputTokens: 64 }).listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', upstream);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const blocked = await realFetch(`${base}/v1beta/models/other-model:generateContent`, { method: 'POST', body: '{}' });
      expect(blocked.status).toBe(403);
      const grounded = await realFetch(`${base}/v1beta/models/${model}:generateContent`, { method: 'POST', body: JSON.stringify({ contents: [], tools: [{}] }) });
      expect(grounded.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();

      const ok = await realFetch(`${base}/v1beta/models/${model}:generateContent?key=dummy`, { method: 'POST', body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) });
      expect(ok.status).toBe(200);
      const [url, init] = upstream.mock.calls[0];
      expect(String(url)).not.toContain('key=');
      expect(init.headers['x-goog-api-key']).toBe('test-key');
      expect(JSON.parse(init.body.toString()).generationConfig.maxOutputTokens).toBe(64);
    } finally {
      server.close();
    }
  });

  it('allows embedding only for the configured embedding model, and nothing when none is configured', () => {
    const allowed = (path: string, embeddingModel?: string) => isAllowedRequest('POST', buildUpstreamUrl(path), model, embeddingModel);
    expect(allowed('/v1beta/models/gemini-embedding-2:batchEmbedContents', 'gemini-embedding-2')).toBe(true);
    expect(allowed('/v1beta/models/gemini-embedding-2:embedContent', 'gemini-embedding-2')).toBe(true);
    expect(allowed('/v1beta/models/gemini-embedding-2:batchEmbedContents')).toBe(false);
    expect(allowed('/v1beta/models/gemini-embedding-001:batchEmbedContents', 'gemini-embedding-2')).toBe(false);
    expect(allowed(`/v1beta/models/${model}:batchEmbedContents`, 'gemini-embedding-2')).toBe(false);
    expect(allowed('/v1beta/models/gemini-embedding-2:generateContent', 'gemini-embedding-2')).toBe(false);
  });

  it('validates embedding batches against the configured model and size limit', () => {
    const batch = (requests: unknown) => sanitizeBody(Buffer.from(JSON.stringify({ requests })), 512, 'gemini-embedding-2');
    const item = { model: 'models/gemini-embedding-2', content: { parts: [{ text: 'hello' }] }, outputDimensionality: 768 };
    expect(Buffer.isBuffer(batch([item, item]))).toBe(true);
    expect(batch([{ ...item, model: 'models/other' }])).toMatch(/configured embedding model/);
    expect(batch([])).toMatch(/1 to 100/);
    expect(batch(Array.from({ length: 101 }, () => item))).toMatch(/1 to 100/);
    expect(JSON.parse((batch([item]) as Buffer).toString()).requests[0].outputDimensionality).toBe(768);
  });
});
