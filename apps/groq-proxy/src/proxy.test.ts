import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUpstreamUrl,
  createGroqProxy,
  isAllowedRequest,
  sanitizeBody,
} from "./proxy";

const model = "openai/gpt-oss-20b";

describe("Groq credential proxy", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes the LiteLLM path to the Groq OpenAI-compatible endpoint", () => {
    const url = buildUpstreamUrl("/v1/chat/completions?trace=1");
    expect(url.origin).toBe("https://api.groq.com");
    expect(url.pathname).toBe("/openai/v1/chat/completions");
    expect(url.searchParams.get("trace")).toBe("1");
  });

  it("allows only POST chat completions", () => {
    expect(isAllowedRequest("POST", "/openai/v1/chat/completions")).toBe(true);
    expect(isAllowedRequest("POST", "/v1/chat/completions")).toBe(true);
    expect(isAllowedRequest("GET", "/openai/v1/models")).toBe(false);
    expect(isAllowedRequest("POST", "/openai/v1/audio/transcriptions")).toBe(
      false,
    );
  });

  it("requires the configured model, blocks side features, and clamps output", () => {
    expect(
      sanitizeBody(
        Buffer.from(JSON.stringify({ model: "other", messages: [] })),
        model,
        512,
      ),
    ).toMatch(/Only model/);
    expect(
      sanitizeBody(
        Buffer.from(JSON.stringify({ model, messages: [], tools: [] })),
        model,
        512,
      ),
    ).toMatch(/tools/);
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
    const modern = JSON.parse(
      (
        sanitizeBody(
          Buffer.from(
            JSON.stringify({
              model,
              messages: [],
              max_tokens: 10,
              max_completion_tokens: 2000,
            }),
          ),
          model,
          256,
        ) as Buffer
      ).toString(),
    );
    expect(modern.max_completion_tokens).toBe(256);
    expect(modern).not.toHaveProperty("max_tokens");
  });

  it("never calls Groq for a blocked request and replaces the incoming credential", async () => {
    const upstream = vi.fn().mockResolvedValue(
      new Response('{"choices":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const server = createGroqProxy({
      apiKey: "real-test-key",
      model,
      maxOutputTokens: 64,
      freeTierConfirmed: true,
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", upstream);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const blocked = await realFetch(`${base}/openai/v1/models`, {
        headers: { Authorization: "Bearer dummy" },
      });
      expect(blocked.status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();

      const ok = await realFetch(`${base}/openai/v1/chat/completions`, {
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
      expect(String(url)).toBe(
        "https://api.groq.com/openai/v1/chat/completions",
      );
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

  it("fails closed before any upstream call when free-tier status is not confirmed", async () => {
    const upstream = vi.fn();
    const server = createGroqProxy({
      apiKey: "test-key",
      model,
      maxOutputTokens: 64,
      freeTierConfirmed: false,
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", upstream);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const response = await realFetch(`${base}/openai/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: [] }),
      });
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("GROQ_FREE_TIER_CONFIRMED");
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      server.close();
    }
  });
});
