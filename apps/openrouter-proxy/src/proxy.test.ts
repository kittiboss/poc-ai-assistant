import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUpstreamUrl,
  createOpenRouterProxy,
  isAllowedRequest,
  sanitizeBody,
} from "./proxy";

const model = "openrouter/free" as const;

describe("OpenRouter free-only credential proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes the LiteLLM path to OpenRouter chat completions", () => {
    const url = buildUpstreamUrl("/v1/chat/completions?trace=1");
    expect(url.origin).toBe("https://openrouter.ai");
    expect(url.pathname).toBe("/api/v1/chat/completions");
    expect(url.searchParams.get("trace")).toBe("1");
  });

  it("allows only POST chat completions", () => {
    expect(isAllowedRequest("POST", "/api/v1/chat/completions")).toBe(true);
    expect(isAllowedRequest("POST", "/v1/chat/completions")).toBe(true);
    expect(isAllowedRequest("GET", "/api/v1/models")).toBe(false);
    expect(isAllowedRequest("POST", "/api/v1/responses")).toBe(false);
  });

  it("requires openrouter/free, blocks routing escapes, and clamps output", () => {
    expect(
      sanitizeBody(
        Buffer.from(JSON.stringify({ model: "paid/model", messages: [] })),
        model,
        512,
      ),
    ).toMatch(/Only model/);
    for (const field of ["models", "provider", "plugins", "tools"]) {
      expect(
        sanitizeBody(
          Buffer.from(
            JSON.stringify({ model, messages: [], [field]: [{ id: "x" }] }),
          ),
          model,
          512,
        ),
      ).toMatch(new RegExp(field));
    }
    const clamped = JSON.parse(
      (
        sanitizeBody(
          Buffer.from(
            JSON.stringify({ model, messages: [], max_tokens: 9000, n: 4 }),
          ),
          model,
          512,
        ) as Buffer
      ).toString(),
    );
    expect(clamped).toMatchObject({ max_tokens: 512, n: 1 });
  });

  it("never calls OpenRouter for blocked requests and replaces the incoming credential", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response('{"choices":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const server = createOpenRouterProxy({
      apiKey: "real-test-key",
      model,
      maxOutputTokens: 64,
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", upstream);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const blocked = await realFetch(`${base}/api/v1/models`, {
        headers: { Authorization: "Bearer dummy" },
      });
      expect(blocked.status).toBe(403);
      const paid = await realFetch(`${base}/api/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "paid/model", messages: [] }),
      });
      expect(paid.status).toBe(400);
      expect(upstream).not.toHaveBeenCalled();

      const ok = await realFetch(`${base}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: "Bearer dummy",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "hi" }],
        }),
      });
      expect(ok.status).toBe(200);
      const [url, init] = upstream.mock.calls[0];
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer real-test-key");
      expect(JSON.parse(init.body.toString())).toMatchObject({
        model,
        max_tokens: 64,
        n: 1,
      });
    } finally {
      server.close();
    }
  });
});
