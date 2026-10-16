import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const upstreamOrigin = "https://openrouter.ai";
const upstreamPath = "/api/v1/chat/completions";
const maxRequestBytes = 2 * 1024 * 1024;
const forbiddenFields = [
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "functions",
  "function_call",
  "models",
  "route",
  "provider",
  "plugins",
  "web_search_options",
  "transforms",
  "service_tier",
  "response_format",
  "reasoning",
  "include",
];

export type ProxyOptions = {
  apiKey: string;
  model: "openrouter/free";
  maxOutputTokens: number;
};

export function buildUpstreamUrl(requestUrl: string) {
  const incoming = new URL(requestUrl, upstreamOrigin);
  const upstream = new URL(upstreamPath, upstreamOrigin);
  upstream.search = incoming.search;
  return upstream;
}

export function isAllowedRequest(method: string, requestUrl: string) {
  const pathname = new URL(requestUrl, upstreamOrigin).pathname;
  return (
    method === "POST" &&
    (pathname === upstreamPath || pathname === "/v1/chat/completions")
  );
}

/** Enforces the zero-price router and removes all feature/routing escape hatches. */
export function sanitizeBody(
  raw: Buffer,
  model: string,
  maxOutputTokens: number,
): Buffer | string {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return "Request body must be JSON";
  }
  if (body.model !== model) return `Only model "${model}" is allowed`;
  const forbidden = forbiddenFields.find((field) => body[field] !== undefined);
  if (forbidden) {
    return `Field "${forbidden}" is disabled by the OpenRouter free-only policy`;
  }

  const usesCompletionTokens = body.max_completion_tokens !== undefined;
  const requested = Number(
    usesCompletionTokens ? body.max_completion_tokens : body.max_tokens,
  );
  const clamped =
    Number.isFinite(requested) && requested > 0
      ? Math.min(Math.trunc(requested), maxOutputTokens)
      : maxOutputTokens;
  if (usesCompletionTokens) {
    body.max_completion_tokens = clamped;
    delete body.max_tokens;
  } else {
    body.max_tokens = clamped;
  }
  body.n = 1;
  return Buffer.from(JSON.stringify(body));
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxRequestBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function reject(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      error: { message, type: "proxy_policy_error", code: status },
    }),
  );
}

async function proxy(
  request: IncomingMessage,
  response: ServerResponse,
  options: ProxyOptions,
) {
  process.stdout.write(
    `OpenRouter proxy request ${request.method || "UNKNOWN"} ${new URL(request.url || "/", upstreamOrigin).pathname}\n`,
  );
  if (!isAllowedRequest(request.method || "", request.url || "/")) {
    reject(response, 403, "Request is outside the OpenRouter proxy allowlist");
    return;
  }

  try {
    const body = sanitizeBody(
      await readBody(request),
      options.model,
      options.maxOutputTokens,
    );
    if (typeof body === "string") {
      reject(response, 400, body);
      return;
    }
    const aborter = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) aborter.abort();
    });
    const upstream = await fetch(buildUpstreamUrl(request.url || "/"), {
      method: "POST",
      headers: {
        Accept: request.headers.accept || "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body,
      signal: aborter.signal,
    });
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) headers[name] = value;
    }
    response.writeHead(upstream.status, headers);
    if (!upstream.body) return response.end();
    for await (const chunk of upstream.body) response.write(chunk);
    response.end();
  } catch (error) {
    if (response.writableEnded || response.destroyed) return;
    const tooLarge =
      error instanceof Error && error.message === "REQUEST_TOO_LARGE";
    reject(
      response,
      tooLarge ? 413 : 502,
      tooLarge ? "Request too large" : "OpenRouter upstream unavailable",
    );
  }
}

export function createOpenRouterProxy(options: ProxyOptions) {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          credentialConfigured: Boolean(options.apiKey),
          model: options.model,
          freeOnly: true,
        }),
      );
      return;
    }
    void proxy(request, response, options);
  });
}
