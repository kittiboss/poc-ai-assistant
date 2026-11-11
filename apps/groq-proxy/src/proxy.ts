import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const upstreamOrigin = "https://api.groq.com";
const upstreamPath = "/openai/v1/chat/completions";
// Room for a chat's images in base64; the API refuses requests over 7.5 MB before they get here.
const maxRequestBytes = 8 * 1024 * 1024;
// Groq's limit for its vision model; the API holds a chat to fewer.
const maxImagesPerRequest = 3;
const forbiddenFields = [
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "functions",
  "function_call",
  "compound_custom",
  "documents",
  "search_settings",
  "service_tier",
  "citation_options",
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

/** visionModel is optional: without it, no image can leave the installation. */
export type ProxyOptions = {
  apiKey: string;
  model: string;
  visionModel?: string;
  maxOutputTokens: number;
  freeTierConfirmed: boolean;
};

export function buildUpstreamUrl(requestUrl: string) {
  const incoming = new URL(requestUrl, upstreamOrigin);
  const upstream = new URL(upstreamPath, upstreamOrigin);
  upstream.search = incoming.search;
  return upstream;
}

/** Only OpenAI-compatible chat completions may leave the installation. */
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
 * match its declared type, so a remote URL (which Groq would fetch) or other media never leaves.
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

/** Returns the body to forward, or an error string when it violates the POC provider policy. */
export function sanitizeBody(
  raw: Buffer,
  model: string,
  maxOutputTokens: number,
  visionModel?: string,
): Buffer | string {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return "Request body must be JSON";
  }
  const vision = Boolean(visionModel) && body.model === visionModel;
  if (body.model !== model && !vision)
    return visionModel
      ? `Only models "${model}" and "${visionModel}" are allowed`
      : `Only model "${model}" is allowed`;
  const forbidden = forbiddenFields.find((field) => body[field] !== undefined);
  if (forbidden)
    return `Field "${forbidden}" is disabled by the POC cost policy`;
  const images = countImages(body.messages);
  if (typeof images === "string") return images;
  if (images && !vision)
    return visionModel
      ? `Images are allowed only for model "${visionModel}"`
      : "Images are disabled: GROQ_VISION_MODEL is not set";
  if (images > maxImagesPerRequest)
    return `At most ${maxImagesPerRequest} images are allowed in a request`;
  // Groq's vision model reasons unless told not to; reasoning would use up the per-minute token limit.
  if (vision) body.reasoning_effort = "none";

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
    `Groq proxy request ${request.method || "UNKNOWN"} ${new URL(request.url || "/", upstreamOrigin).pathname}\n`,
  );
  if (!options.freeTierConfirmed) {
    reject(
      response,
      403,
      "Groq requests are blocked until GROQ_FREE_TIER_CONFIRMED=true",
    );
    return;
  }
  if (!isAllowedRequest(request.method || "", request.url || "/")) {
    reject(response, 403, "Request is outside the Groq proxy allowlist");
    return;
  }

  try {
    const body = sanitizeBody(
      await readBody(request),
      options.model,
      options.maxOutputTokens,
      options.visionModel,
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
      tooLarge ? "Request too large" : "Groq upstream unavailable",
    );
  }
}

export function createGroqProxy(options: ProxyOptions) {
  return createServer((request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          credentialConfigured: Boolean(options.apiKey),
          model: options.model,
          visionModel: options.visionModel || null,
          freeTierConfirmed: options.freeTierConfirmed,
        }),
      );
      return;
    }
    void proxy(request, response, options);
  });
}
