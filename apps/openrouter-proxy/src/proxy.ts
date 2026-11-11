import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const upstreamOrigin = "https://openrouter.ai";
const upstreamPath = "/api/v1/chat/completions";
// Room for a chat's images in base64; the API refuses requests over 7.5 MB before they get here.
const maxRequestBytes = 8 * 1024 * 1024;
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
const imageSignatures: Record<string, (head: Buffer) => boolean> = {
  "image/jpeg": (head) =>
    head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  "image/png": (head) =>
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (head) =>
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP",
};
const imageDataUrl =
  /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

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

/**
 * Counts the images in the messages, or returns an error string. Content is text, or text and
 * image parts; an image is accepted only in a user message, as a base64 data URL whose first bytes
 * match its declared type. A remote URL (which OpenRouter would fetch) and other parts, such as
 * `file` (which OpenRouter may hand to a paid PDF parser), never leave the installation.
 */
export function countImages(messages: unknown): number | string {
  if (messages === undefined) return 0;
  if (!Array.isArray(messages)) return 'Field "messages" must be a list';
  let images = 0;
  for (const message of messages) {
    const { role, content } = (message ?? {}) as {
      role?: unknown;
      content?: unknown;
    };
    if (
      content === undefined ||
      content === null ||
      typeof content === "string"
    )
      continue;
    if (!Array.isArray(content))
      return "Message content must be text or a list of parts";
    for (const part of content) {
      const { type, image_url: image } = (part ?? {}) as {
        type?: unknown;
        image_url?: { url?: unknown };
      };
      if (type === "text") continue;
      if (type !== "image_url")
        return "Only text and image_url content parts are allowed";
      if (role !== "user") return "Images are accepted in user messages only";
      const url = image?.url;
      const data = typeof url === "string" ? imageDataUrl.exec(url) : null;
      const head = data && Buffer.from(data[2].slice(0, 16), "base64");
      if (!data || !head || !imageSignatures[data[1]](head))
        return "An image must be a base64 data URL of a JPEG, PNG or WebP image";
      images += 1;
    }
  }
  return images;
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
  // The router picks a free model that takes images when the request has any; the API limits how many.
  const images = countImages(body.messages);
  if (typeof images === "string") return images;

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
