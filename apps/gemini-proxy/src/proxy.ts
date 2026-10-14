import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const upstreamOrigin = 'https://generativelanguage.googleapis.com';
const maxRequestBytes = 2 * 1024 * 1024;

export function buildUpstreamUrl(requestUrl: string) {
  const url = new URL(requestUrl, upstreamOrigin);
  if (url.pathname.startsWith('/models/')) url.pathname = `/v1beta${url.pathname}`;
  url.searchParams.delete('key');
  return url;
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

async function proxy(request: IncomingMessage, response: ServerResponse, apiKey: string) {
  const requestUrl = request.url || '';
  const pathname = requestUrl ? new URL(requestUrl, 'http://internal').pathname : '';
  process.stdout.write(`Gemini proxy request ${request.method || 'UNKNOWN'} ${pathname}\n`);
  if (!pathname.startsWith('/v1beta/') && !pathname.startsWith('/models/')) {
    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Not found' } }));
    return;
  }
  if (!['GET', 'POST'].includes(request.method || '')) {
    response.writeHead(405, { Allow: 'GET, POST' });
    response.end();
    return;
  }

  try {
    const body = request.method === 'POST' ? await readBody(request) : undefined;
    const aborter = new AbortController();
    response.on('close', () => { if (!response.writableEnded) aborter.abort(); });
    const upstream = await fetch(buildUpstreamUrl(requestUrl), {
      method: request.method,
      headers: {
        Accept: request.headers.accept || 'application/json',
        'Content-Type': request.headers['content-type'] || 'application/json',
        'x-goog-api-key': apiKey,
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
    const status = error instanceof Error && error.message === 'REQUEST_TOO_LARGE' ? 413 : 502;
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: status === 413 ? 'Request too large' : 'Gemini upstream unavailable' } }));
  }
}

export function createGeminiProxy(apiKey: string) {
  return createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', credentialConfigured: Boolean(apiKey) }));
      return;
    }
    void proxy(request, response, apiKey);
  });
}
