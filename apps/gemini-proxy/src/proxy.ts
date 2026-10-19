import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const upstreamOrigin = 'https://generativelanguage.googleapis.com';
const maxRequestBytes = 2 * 1024 * 1024;
const generationMethods = new Set(['generateContent', 'streamGenerateContent', 'countTokens']);
const embeddingMethods = new Set(['embedContent', 'batchEmbedContents']);
const maxEmbeddingBatch = 100;
// Grounding (Search/Maps), code execution and URL context arrive as tools and can be billed
// separately; cached content incurs storage charges. The POC never needs any of them.
const forbiddenFields = ['tools', 'toolConfig', 'tool_config', 'cachedContent', 'cached_content'];

/** embeddingModel is optional: without it, no embedding call can leave the installation. */
export type ProxyOptions = { apiKey: string; model: string; embeddingModel?: string; maxOutputTokens: number };

export function buildUpstreamUrl(requestUrl: string) {
  const url = new URL(requestUrl, upstreamOrigin);
  if (url.pathname.startsWith('/models/')) url.pathname = `/v1beta${url.pathname}`;
  url.searchParams.delete('key');
  return url;
}

/** Only text generation (plus free token counting) for GEMINI_MODEL, and text embedding for GEMINI_EMBEDDING_MODEL, may leave the installation. */
export function isAllowedRequest(method: string, upstream: URL, model: string, embeddingModel?: string) {
  const match = /^\/v1beta\/models\/([^/:]+):([A-Za-z]+)$/.exec(upstream.pathname);
  if (method !== 'POST' || !match) return false;
  const [, target, action] = match;
  return (target === model && generationMethods.has(action)) || (Boolean(embeddingModel) && target === embeddingModel && embeddingMethods.has(action));
}

/** Returns the body to forward, or an error string when the request uses a feature outside the POC allowlist. */
export function sanitizeBody(raw: Buffer, maxOutputTokens: number, embeddingModel?: string): Buffer | string {
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { return 'Request body must be JSON'; }
  const forbidden = forbiddenFields.find((field) => body[field] !== undefined);
  if (forbidden) return `Field "${forbidden}" is disabled by the POC cost policy`;
  if (body.requests !== undefined) {
    const requests = body.requests;
    if (!Array.isArray(requests) || !requests.length || requests.length > maxEmbeddingBatch) return `Embedding batches must contain 1 to ${maxEmbeddingBatch} requests`;
    if (requests.some((item) => !item || typeof item !== 'object' || (item as { model?: unknown }).model !== `models/${embeddingModel}`)) return 'Every embedding request must target the configured embedding model';
  }
  if (body.contents !== undefined) {
    const configKey = body.generation_config !== undefined ? 'generation_config' : 'generationConfig';
    const config = (body[configKey] || {}) as Record<string, unknown>;
    // Google accepts either spelling but rejects a request that sets both, so clamp the one the caller used.
    const snake = configKey === 'generation_config' || Object.keys(config).some((key) => key.includes('_'));
    const maxKey = snake ? 'max_output_tokens' : 'maxOutputTokens';
    const requested = Number(config[maxKey]);
    config[maxKey] = Number.isFinite(requested) && requested > 0 ? Math.min(requested, maxOutputTokens) : maxOutputTokens;
    config[snake ? 'candidate_count' : 'candidateCount'] = 1;
    body[configKey] = config;
  }
  return Buffer.from(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxRequestBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function reject(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { code: status, message } }));
}

async function proxy(request: IncomingMessage, response: ServerResponse, options: ProxyOptions) {
  const upstreamUrl = buildUpstreamUrl(request.url || '/');
  process.stdout.write(`Gemini proxy request ${request.method || 'UNKNOWN'} ${upstreamUrl.pathname}\n`);
  if (!isAllowedRequest(request.method || '', upstreamUrl, options.model, options.embeddingModel)) {
    reject(response, 403, 'Request is outside the Gemini proxy allowlist');
    return;
  }

  try {
    const body = sanitizeBody(await readBody(request), options.maxOutputTokens, options.embeddingModel);
    if (typeof body === 'string') {
      reject(response, 400, body);
      return;
    }
    const aborter = new AbortController();
    response.on('close', () => { if (!response.writableEnded) aborter.abort(); });
    const upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Accept: request.headers.accept || 'application/json',
        'Content-Type': 'application/json',
        'x-goog-api-key': options.apiKey,
      },
      body,
      signal: aborter.signal,
    });
    const headers: Record<string, string> = {};
    for (const name of ['content-type', 'cache-control']) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    if (!upstream.body) return response.end();
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    if (response.writableEnded || response.destroyed) return;
    const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE';
    reject(response, tooLarge ? 413 : 502, tooLarge ? 'Request too large' : 'Gemini upstream unavailable');
  }
}

export function createGeminiProxy(options: ProxyOptions) {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', credentialConfigured: Boolean(options.apiKey), model: options.model, embeddingModel: options.embeddingModel || null }));
      return;
    }
    void proxy(request, response, options);
  });
}
