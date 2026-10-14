import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const upstreamOrigin = 'https://generativelanguage.googleapis.com';
const maxRequestBytes = 2 * 1024 * 1024;
const allowedMethods = new Set(['generateContent', 'streamGenerateContent', 'countTokens']);
// Grounding (Search/Maps), code execution and URL context arrive as tools and can be billed
// separately; cached content incurs storage charges. The POC never needs any of them.
const forbiddenFields = ['tools', 'toolConfig', 'tool_config', 'cachedContent', 'cached_content'];

export type ProxyOptions = { apiKey: string; model: string; maxOutputTokens: number };

export function buildUpstreamUrl(requestUrl: string) {
  const url = new URL(requestUrl, upstreamOrigin);
  if (url.pathname.startsWith('/models/')) url.pathname = `/v1beta${url.pathname}`;
  url.searchParams.delete('key');
  return url;
}

/** Only plain text generation (and free token counting) for the one configured model may leave the installation. */
export function isAllowedRequest(method: string, upstream: URL, model: string) {
  const match = upstream.pathname.match(/^\/v1beta\/models\/([^/:]+):([A-Za-z]+)$/);
  return method === 'POST' && Boolean(match) && match![1] === model && allowedMethods.has(match![2]);
}

/** Returns the body to forward, or an error string when the request uses a feature outside the POC allowlist. */
export function sanitizeBody(raw: Buffer, maxOutputTokens: number): Buffer | string {
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch { return 'Request body must be JSON'; }
  const forbidden = forbiddenFields.find((field) => body[field] !== undefined);
  if (forbidden) return `Field "${forbidden}" is disabled by the POC cost policy`;
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
  if (!isAllowedRequest(request.method || '', upstreamUrl, options.model)) {
    reject(response, 403, 'Request is outside the Gemini proxy allowlist');
    return;
  }

  try {
    const body = sanitizeBody(await readBody(request), options.maxOutputTokens);
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
      response.end(JSON.stringify({ status: 'ok', credentialConfigured: Boolean(options.apiKey), model: options.model }));
      return;
    }
    void proxy(request, response, options);
  });
}
