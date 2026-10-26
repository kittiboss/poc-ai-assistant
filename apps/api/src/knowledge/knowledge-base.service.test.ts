import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
} from "@nestjs/common";
import { PRODUCT_COLUMNS } from "@enterprise/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayError } from "../gateway/gateway.service";
import { admin, localUser } from "../testing/fixtures";
import { EMBEDDING_DIMENSIONS, documentInput, queryInput } from "./embedding-text";
import { csvSections, fileType } from "./knowledge-base.sections";
import { KnowledgeBaseService, pauseReason } from "./knowledge-base.service";
import { KnowledgeService } from "./knowledge.service";
import type { EngineConfig } from "./rag-engine.client";

const models: Record<string, object> = {
  "mock-embedding": {
    id: "mock-embedding",
    displayName: "Mock Embedding",
    provider: "MOCK",
    local: true,
    enabled: true,
    capabilities: ["embedding"],
  },
  "gemini-embedding": {
    id: "gemini-embedding",
    displayName: "Gemini Embedding 2",
    provider: "GEMINI",
    local: false,
    enabled: true,
    capabilities: ["embedding", "task-prefix", "output-dimensions"],
  },
};
const unit = () => Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

function engineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return {
    tenant: "a",
    limits: {
      enabled: true,
      embeddingModels: ["mock-embedding", "gemini-embedding"],
      allowedTypes: ["csv", "txt", "md", "pdf"],
      maxDocuments: 20,
      maxFileMb: 5,
      maxTextMb: 10,
      maxChunksPerDocument: 500,
      maxTotalChunks: 3000,
      maxTopK: 8,
    },
    settings: { embeddingModel: "mock-embedding", topK: 5, minScore: 0, chunkSize: 1400, chunkOverlap: 300 },
    effective: { topK: 5, minScore: 0 },
    problem: null,
    active: { version: 1, model: "mock-embedding" },
    target: { version: 1, model: "mock-embedding" },
    usage: { documents: 1, textBytes: 100, chunks: 2, pendingChunks: 0, pausedDocuments: 0, sensitiveDocuments: 0 },
    ...overrides,
  };
}

/** A fake central engine: answers by path and records every call. */
function fakeEngine(routes: Record<string, (body?: any) => unknown>) {
  const calls: Array<{ path: string; method: string; body?: any }> = [];
  return {
    calls,
    enabled: () => true,
    request: vi.fn(async (path: string, init: { method?: string; body?: unknown } = {}) => {
      calls.push({ path, method: init.method ?? "GET", body: init.body });
      const key = Object.keys(routes).find((route) => path.startsWith(route));
      if (!key) throw new Error(`unexpected engine call ${path}`);
      return routes[key](init.body);
    }),
  };
}

function setup(
  options: {
    engine?: ReturnType<typeof fakeEngine>;
    governance?: { externalBlocked?: boolean; sensitiveMode?: "WARN" | "BLOCK" };
    embed?: (texts: string[]) => Promise<{ vectors: number[][] }>;
    credit?: object | null;
  } = {},
) {
  // As in a vendor-managed deployment: the platform decides which external models are entitled.
  vi.stubEnv("MODEL_ACCESS", "vendor-gateway");
  vi.stubEnv("ENABLE_EXTERNAL_PROVIDERS", "true");
  const engine = options.engine ?? fakeEngine({ "/v1/config": () => engineConfig() });
  const prisma = {
    aIModel: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => models[where.id] ?? null) },
  };
  const users = { syncUser: vi.fn().mockResolvedValue(localUser) };
  const gateway = {
    embed: vi.fn(async (_model: string, texts: string[]) =>
      options.embed ? options.embed(texts) : { vectors: texts.map(unit) },
    ),
    credit: vi.fn().mockResolvedValue(options.credit ?? null),
  };
  const usage = { record: vi.fn().mockResolvedValue(undefined) };
  const governance = {
    reserve: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    checkSensitive: vi.fn().mockResolvedValue(undefined),
    settings: vi.fn().mockResolvedValue({
      externalBlocked: false,
      retentionDays: 0,
      sensitiveMode: "WARN",
      ...options.governance,
    }),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const knowledge = new KnowledgeService(
    prisma as never,
    users as never,
    gateway as never,
    usage as never,
    governance as never,
    audit as never,
    engine as never,
  );
  const service = new KnowledgeBaseService(
    engine as never,
    knowledge,
    users as never,
    governance as never,
    audit as never,
    gateway as never,
  );
  return { service, knowledge, engine, gateway, usage, governance, audit };
}

const file = (name: string, text: string) => ({
  originalname: name,
  buffer: Buffer.from(text),
  size: Buffer.byteLength(text),
});

afterEach(() => vi.unstubAllEnvs());

describe("knowledge base files", () => {
  it("accepts the four plan file types", () => {
    expect(["a.csv", "b.TXT", "c.md", "d.markdown", "e.pdf", "f.docx"].map(fileType)).toEqual([
      "csv",
      "txt",
      "md",
      "md",
      "pdf",
      null,
    ]);
  });

  it("turns CSV rows into titled sections, and keeps the catalog's passage format", () => {
    expect(csvSections("name,policy\nRefunds,45 days\n,\nShipping,", "rules.csv")).toEqual([
      { title: "Refunds", text: "name: Refunds\npolicy: 45 days" },
      { title: "Shipping", text: "name: Shipping" },
    ]);
    const catalog = [
      PRODUCT_COLUMNS.join(","),
      "1,ELC-0001,Headphones,Wireless,Electronics,Audio,Acme,99.00,40.00,USD,5,0.30,Black,Plastic,4.5,10,true,2026-01-01 00:00:00,2026-01-01 00:00:00",
    ].join("\n");
    const [product] = csvSections(catalog, "products.csv");
    expect(product.title).toBe("Headphones (ELC-0001)");
    expect(product.text).toContain("Brand: Acme");
    expect(() => csvSections("only,a,header", "x.csv")).toThrow(BadRequestException);
  });
});

describe("knowledge base uploads", () => {
  it("refuses a type the plan does not allow before reading the file", async () => {
    const engine = fakeEngine({
      "/v1/config": () => engineConfig({ limits: { ...engineConfig().limits, allowedTypes: ["pdf"] } }),
    });
    const { service } = setup({ engine });
    await expect(service.upload(admin, file("notes.txt", "hello"), false)).rejects.toThrow(/pdf/);
    expect(engine.calls.map((c) => c.path)).toEqual(["/v1/config"]);
  });

  it("sends extracted sections with the uploader for quotas, and starts indexing", async () => {
    const engine = fakeEngine({
      "/v1/config": () => engineConfig(),
      "/v1/documents": () => ({ id: "doc-1", chunks: 1 }),
      "/v1/index/next": () => ({ version: 1, model: "mock-embedding", items: [], remaining: 0 }),
    });
    const { service, audit, governance } = setup({ engine });
    await service.upload(admin, file("policy.md", "Refunds within 45 days. Contact help@example.com"), false);
    await service.idle();
    const sent = engine.calls.find((c) => c.path === "/v1/documents")!.body;
    expect(sent).toMatchObject({
      filename: "policy.md",
      type: "md",
      sections: [{ text: "Refunds within 45 days. Contact help@example.com" }],
      sensitiveFindings: 1,
      requestedBy: { userId: localUser.id, roles: admin.roles },
    });
    // A local model keeps the text in the platform: no review needed, but the finding is kept.
    expect(governance.checkSensitive).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: "KNOWLEDGE_DOCUMENT_UPLOAD", entityId: "doc-1" }));
    expect(engine.calls.some((c) => c.path.startsWith("/v1/index/next"))).toBe(true);
  });

  it("applies the kill switch and the sensitive review when an external model would receive the text", async () => {
    const external = engineConfig({ settings: { ...engineConfig().settings, embeddingModel: "gemini-embedding" } });
    const blocked = setup({
      engine: fakeEngine({ "/v1/config": () => external }),
      governance: { externalBlocked: true },
    });
    await expect(blocked.service.upload(admin, file("a.txt", "text"), false)).rejects.toBeInstanceOf(ForbiddenException);
    const review = setup({ engine: fakeEngine({ "/v1/config": () => external }) });
    review.governance.checkSensitive.mockRejectedValueOnce(new BadRequestException({ code: "SENSITIVE_CONTEXT" }));
    await expect(review.service.upload(admin, file("a.txt", "password: hunter22"), false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(review.governance.checkSensitive).toHaveBeenCalledWith("password: hunter22", false);
  });
});

describe("knowledge base settings", () => {
  it("asks for review before re-indexing flagged documents with an external model", async () => {
    const config = engineConfig({ usage: { ...engineConfig().usage, sensitiveDocuments: 2 } });
    const engine = fakeEngine({
      "/v1/config": () => config,
      "/v1/settings": () => ({ reindex: true, version: 2 }),
      "/v1/index/next": () => ({ version: 2, model: "gemini-embedding", items: [], remaining: 0 }),
    });
    const { service } = setup({ engine });
    await expect(service.updateSettings(admin, { embeddingModel: "gemini-embedding" })).rejects.toMatchObject({
      response: { code: "SENSITIVE_CONTEXT", canAcknowledge: true },
    });
    const result = await service.updateSettings(admin, { embeddingModel: "gemini-embedding", acknowledgeSensitive: true });
    expect(result.reindex).toBe(true);
    expect(engine.calls.find((c) => c.path === "/v1/settings")!.body).toEqual({
      embeddingModel: "gemini-embedding",
      requestedBy: { userId: localUser.id, roles: admin.roles },
    });
    const strict = setup({ engine, governance: { sensitiveMode: "BLOCK" } });
    await expect(
      strict.service.updateSettings(admin, { embeddingModel: "gemini-embedding", acknowledgeSensitive: true }),
    ).rejects.toMatchObject({ response: { canAcknowledge: false } });
  });
});

describe("knowledge base indexing", () => {
  const batch = (model = "mock-embedding") => ({
    version: 1,
    model,
    requestedBy: { userId: localUser.id, roles: ["ADMIN", "USER"] },
    items: [
      { chunkId: "c1", title: "Policy", text: "Refunds within 45 days" },
      { chunkId: "c2", title: "Policy", text: "Shipping takes 3 days" },
    ],
    remaining: 2,
  });

  it("embeds through the metered path as the uploader and stores the vectors", async () => {
    let served = false;
    const engine = fakeEngine({
      "/v1/index/next": () => (served ? { version: 1, model: "mock-embedding", items: [], remaining: 0 } : ((served = true), batch())),
      "/v1/index/vectors": () => ({ stored: 2, remaining: 0 }),
    });
    const { service, gateway, governance, usage } = setup({ engine });
    service.kick();
    await service.idle();
    expect(gateway.embed.mock.calls[0][1]).toEqual([
      documentInput("Policy", "Refunds within 45 days", false),
      documentInput("Policy", "Shipping takes 3 days", false),
    ]);
    const requestId = governance.reserve.mock.calls[0][0].requestId;
    expect(requestId).toMatch(/^rag-index:[0-9a-f-]{36}$/);
    expect(governance.reserve).toHaveBeenCalledWith(expect.objectContaining({ userId: localUser.id, external: false }));
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ requestId, operation: "EMBEDDING", conversationId: null }));
    const stored = engine.calls.find((c) => c.path === "/v1/index/vectors")!.body;
    expect(stored).toMatchObject({ version: 1, model: "mock-embedding" });
    expect(stored.items.map((i: { chunkId: string }) => i.chunkId)).toEqual(["c1", "c2"]);
  });

  it("fetches again when settings changed while a batch was embedding", async () => {
    let round = 0;
    const engine = fakeEngine({
      "/v1/index/next": () => (++round <= 2 ? batch() : { version: 2, model: "mock-embedding", items: [], remaining: 0 }),
      "/v1/index/vectors": () => {
        if (round === 1) throw new ConflictException({ code: "STALE_VERSION" });
        return { stored: 2 };
      },
    });
    const { service } = setup({ engine });
    service.kick();
    await service.idle();
    expect(engine.calls.filter((c) => c.path === "/v1/index/vectors")).toHaveLength(2);
  });

  it.each([
    ["no credit", gatewayError(400, "budget_exceeded"), "CREDIT_EXHAUSTED"],
    ["provider rate limit", gatewayError(429), "RATE_LIMITED"],
    ["kill switch", new ForbiddenException("External providers are paused by the administrator"), "POLICY"],
    ["daily limit", new HttpException("Daily external requests quota would be exceeded", 429), "DAILY_LIMIT"],
    ["other", new Error("boom"), "ERROR"],
  ])("pauses on %s with a reason the admin sees", async (_name, error, reason) => {
    expect(pauseReason(error)).toBe(reason);
    const engine = fakeEngine({
      "/v1/index/next": () => batch(),
      "/v1/index/pause": () => ({ paused: 1 }),
    });
    const { service, governance } = setup({ engine });
    governance.reserve.mockRejectedValueOnce(error);
    service.kick();
    await service.idle();
    expect(engine.calls.find((c) => c.path === "/v1/index/pause")!.body).toEqual({ reason });
  });

  it("does not send text to an external model while external providers are paused", async () => {
    const engine = fakeEngine({
      "/v1/index/next": () => batch("gemini-embedding"),
      "/v1/index/pause": () => ({ paused: 1 }),
    });
    const { service, gateway } = setup({ engine, governance: { externalBlocked: true } });
    service.kick();
    await service.idle();
    expect(gateway.embed).not.toHaveBeenCalled();
    expect(engine.calls.find((c) => c.path === "/v1/index/pause")!.body).toEqual({ reason: "POLICY" });
  });

  it("resumes paused work whose cause may have cleared, but not while credit is still spent", async () => {
    const config = engineConfig({ usage: { ...engineConfig().usage, pausedDocuments: 1, pendingChunks: 2 } });
    const engine = fakeEngine({
      "/v1/config": () => config,
      "/v1/index/resume": () => ({ resumed: 1 }),
      "/v1/index/next": () => ({ version: 1, model: "mock-embedding", items: [], remaining: 0 }),
    });
    const { service } = setup({ engine, credit: { exhausted: true } });
    await service.tick();
    await service.idle();
    expect(engine.calls.find((c) => c.path === "/v1/index/resume")!.body.reasons).toEqual(["RATE_LIMITED", "DAILY_LIMIT"]);
    expect(engine.calls.some((c) => c.path.startsWith("/v1/index/next"))).toBe(true);
  });
});

describe("central knowledge retrieval", () => {
  const search = {
    model: "mock-embedding",
    version: 1,
    topK: 5,
    citations: [
      { chunkId: "c1", documentId: "d1", filename: "policy.pdf", title: "policy.pdf", page: 3, content: "Refunds within 45 days", score: 0.91 },
      { chunkId: "c2", documentId: "d2", filename: "products.csv", title: "Headphones (ELC-0001)", page: null, content: "Product: Headphones", score: 0.5 },
    ],
  };

  it("embeds the query with the active index's model through quotas, and cites the engine's passages", async () => {
    const engine = fakeEngine({ "/v1/config": () => engineConfig(), "/v1/search": () => search });
    const { knowledge, governance, gateway } = setup({ engine });
    const citations = await knowledge.retrieve({
      userId: localUser.id,
      roles: ["USER"],
      query: "How long do refunds take?",
      conversationId: "conv-1",
      requestId: "req-1",
    });
    expect(governance.reserve).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-1:retrieval", external: false }));
    expect(governance.checkSensitive).not.toHaveBeenCalled();
    expect(gateway.embed.mock.calls[0][1]).toEqual([queryInput("How long do refunds take?", false)]);
    expect(engine.calls.find((c) => c.path === "/v1/search")!.body).toMatchObject({ model: "mock-embedding" });
    expect(citations).toEqual([
      { id: "c1", sourceId: "document:d1", filename: "policy.pdf", page: 3, content: "Refunds within 45 days", kind: "document", score: 0.91 },
      { id: "c2", sourceId: "document:d2", filename: "products.csv · Headphones (ELC-0001)", page: null, content: "Product: Headphones", kind: "document", score: 0.5 },
    ]);
  });

  it("refuses with the engine's reason instead of answering without the knowledge base", async () => {
    const turnedOff = setup({
      engine: fakeEngine({ "/v1/config": () => engineConfig({ problem: "The knowledge base is turned off for your organization" }) }),
    });
    const args = { userId: localUser.id, roles: ["USER"], query: "q", conversationId: "c", requestId: "r" };
    await expect(turnedOff.knowledge.retrieve(args)).rejects.toThrow(/turned off/);
    const empty = setup({ engine: fakeEngine({ "/v1/config": () => engineConfig({ active: null }) }) });
    await expect(empty.knowledge.retrieve(args)).rejects.toThrow(/no indexed documents/);
    expect(empty.gateway.embed).not.toHaveBeenCalled();
  });

  it("points catalog import and reindex to the knowledge base", async () => {
    const { knowledge } = setup();
    await expect(knowledge.importProducts(admin, "x")).rejects.toBeInstanceOf(ConflictException);
    await expect(knowledge.reindex(admin)).rejects.toBeInstanceOf(ConflictException);
    expect((await knowledge.status()).source).toBe("knowledge-base");
  });
});
