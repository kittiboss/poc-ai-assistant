import { afterEach, describe, expect, it, vi } from "vitest";
import { admin, localUser } from "../testing/fixtures";
import {
  EMBEDDING_DIMENSIONS,
  contentHash,
  documentInput,
  queryInput,
  vectorLiteral,
} from "./embedding-text";
import { KnowledgeService } from "./knowledge.service";

const product = (
  productId: number,
  overrides: Record<string, unknown> = {},
) => ({
  productId,
  sku: `SKU-${productId}`,
  name: `Product ${productId}`,
  description: "A product.",
  category: "Electronics",
  subcategory: "Audio",
  brand: "Brand",
  price: "10.00",
  costPrice: "4.00",
  currency: "USD",
  stockQuantity: 3,
  weightKg: null,
  color: null,
  material: null,
  rating: "4.5",
  reviewCount: 10,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
});
const mockModel = {
  id: "mock-embedding",
  displayName: "Mock Embedding",
  provider: "MOCK",
  local: true,
  enabled: true,
  capabilities: ["embedding"],
};
const geminiModel = {
  id: "gemini-embedding",
  displayName: "Gemini Embedding 2",
  provider: "GEMINI",
  local: false,
  enabled: true,
  capabilities: ["embedding", "task-prefix", "output-dimensions"],
};
const unitVector = () =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i === 0 ? 1 : 0));

function setup(
  options: {
    model?: object | null;
    products?: object[];
    chunks?: object[];
    indexed?: number;
    rows?: object[];
  } = {},
) {
  const prisma = {
    aIModel: {
      findUnique: vi
        .fn()
        .mockResolvedValue(
          options.model === undefined ? mockModel : options.model,
        ),
    },
    product: { findMany: vi.fn().mockResolvedValue(options.products ?? []) },
    knowledgeChunk: {
      findMany: vi.fn().mockResolvedValue(options.chunks ?? []),
      count: vi.fn().mockResolvedValue(options.indexed ?? 0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => ({
        sql: strings.join("?"),
        values,
      }),
    ),
    $queryRaw: vi.fn(() => options.rows ?? []),
    $transaction: vi.fn(async (operations: unknown[]) =>
      Promise.all(operations),
    ),
  };
  const users = { syncUser: vi.fn().mockResolvedValue(localUser) };
  const gateway = {
    embed: vi.fn(async (_model: string, texts: string[]) => ({
      vectors: texts.map(unitVector),
    })),
  };
  const usage = { record: vi.fn().mockResolvedValue(undefined) };
  const governance = {
    reserve: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    checkSensitive: vi.fn().mockResolvedValue(undefined),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new KnowledgeService(
    prisma as never,
    users as never,
    gateway as never,
    usage as never,
    governance as never,
    audit as never,
  );
  return { service, prisma, gateway, usage, governance, audit };
}

describe("embedding text", () => {
  it("adds Gemini Embedding 2 task prefixes only for models that need them", () => {
    expect(documentInput("Title", "Body", true)).toBe(
      "title: Title | text: Body",
    );
    expect(queryInput("earbuds", true)).toBe(
      "task: search result | query: earbuds",
    );
    expect(queryInput("earbuds", false)).toBe("earbuds");
    expect(() => vectorLiteral([1, 2])).toThrow(/768/);
  });
});

describe("product catalog indexing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("embeds new products in batches of 100 and meters each batch as EMBEDDING usage outside any conversation", async () => {
    const { service, gateway, usage, governance, prisma, audit } = setup({
      products: Array.from({ length: 150 }, (_, i) => product(i + 1)),
    });
    expect(await service.reindex(admin)).toMatchObject({
      embeddingModel: "mock-embedding",
      pending: 150,
      batches: 2,
      removed: 0,
      started: true,
      estimatedSeconds: 0,
    });
    await service.idle();
    expect((await service.status()).lastRun).toMatchObject({
      embedded: 150,
      error: null,
      finishedAt: expect.any(String),
    });
    expect(gateway.embed.mock.calls.map(([, texts]) => texts.length)).toEqual([
      100, 50,
    ]);
    // The mock natively returns 768-d vectors, so no size is requested (LiteLLM rejects `dimensions` for it).
    expect(gateway.embed).toHaveBeenCalledWith(
      "mock-embedding",
      expect.any(Array),
      768,
      false,
    );
    expect(governance.reserve).toHaveBeenCalledTimes(2);
    expect(governance.reserve.mock.calls[0][0]).toMatchObject({
      modelId: "mock-embedding",
      external: false,
      outputTokens: 0,
    });
    expect(governance.release).toHaveBeenCalledTimes(2);
    expect(usage.record.mock.calls[0][0]).toMatchObject({
      operation: "EMBEDDING",
      conversationId: null,
      status: "COMPLETED",
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(150);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "KNOWLEDGE_REINDEX" }),
    );
  });

  it("re-embeds only changed products and removes passages of deleted ones", async () => {
    const unchanged = product(1);
    const { productPassage } = await import("@enterprise/shared");
    const passage = productPassage(unchanged);
    const { service, gateway, prisma } = setup({
      products: [unchanged, product(2, { price: "12.00" })],
      chunks: [
        {
          id: "c1",
          sourceId: "1",
          contentHash: contentHash(
            documentInput(passage.title, passage.text, false),
          ),
        },
        { id: "c2", sourceId: "2", contentHash: "outdated" },
        { id: "c3", sourceId: "99", contentHash: "deleted product" },
      ],
    });
    expect(await service.reindex(admin)).toMatchObject({
      pending: 1,
      removed: 1,
    });
    await service.idle();
    expect(gateway.embed.mock.calls[0][1]).toHaveLength(1);
    expect(prisma.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["c3"] } },
    });
  });

  it("refuses to index with a disabled or unconfigured embedding model, without calling it", async () => {
    const disabled = setup({
      model: { ...mockModel, enabled: false },
      products: [product(1)],
    });
    await expect(disabled.service.reindex(admin)).rejects.toThrow(
      /disabled in the model registry/,
    );
    vi.stubEnv("ENABLE_EXTERNAL_PROVIDERS", "false");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "gemini-embedding");
    const external = setup({ model: geminiModel, products: [product(1)] });
    await expect(external.service.reindex(admin)).rejects.toThrow(
      /not explicitly enabled and configured/,
    );
    expect(disabled.gateway.embed).not.toHaveBeenCalled();
    expect(external.gateway.embed).not.toHaveBeenCalled();
  });
});

describe("external indexing pace", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("paces external batches, waits out a provider rate limit, and reports a stop without losing saved batches", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ENABLE_EXTERNAL_PROVIDERS", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "gemini-embedding");
    vi.stubEnv("RAG_EXTERNAL_BATCH_SIZE", "100");
    vi.stubEnv("RAG_EXTERNAL_BATCH_INTERVAL_MS", "61000");
    const { service, gateway, prisma } = setup({
      model: geminiModel,
      products: Array.from({ length: 250 }, (_, i) => product(i + 1)),
    });
    const quota = Object.assign(
      new (await import("@nestjs/common")).HttpException("quota", 429),
    );
    gateway.embed
      .mockImplementationOnce(async (_m: string, texts: string[]) => ({
        vectors: texts.map(unitVector),
      }))
      .mockRejectedValueOnce(quota)
      .mockImplementationOnce(async (_m: string, texts: string[]) => ({
        vectors: texts.map(unitVector),
      }))
      .mockRejectedValue(new Error("daily limit"));
    expect(await service.reindex(admin)).toMatchObject({
      pending: 250,
      batches: 3,
      estimatedSeconds: 122,
    });
    await vi.runAllTimersAsync();
    await service.idle();
    // Batch 1, then (after one interval) batch 2 is rate-limited and retried, then batch 3 fails for good.
    expect(gateway.embed).toHaveBeenCalledTimes(4);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(200);
    expect((await service.status()).lastRun).toMatchObject({
      embedded: 200,
      error: "daily limit",
    });
  });
});

describe("product retrieval", () => {
  afterEach(() => vi.unstubAllEnvs());
  const args = {
    userId: localUser.id,
    roles: ["USER"],
    query: "water resistant earbuds",
    conversationId: "conversation-1",
    requestId: "req-1",
  };

  it("refuses an unindexed catalog instead of answering without it", async () => {
    const { service, gateway } = setup({ indexed: 0 });
    await expect(service.retrieve(args)).rejects.toThrow(/not been indexed/);
    expect(gateway.embed).not.toHaveBeenCalled();
  });

  it("embeds the query with the Gemini task prefix after the sensitive-data check, and maps results to citations", async () => {
    vi.stubEnv("ENABLE_EXTERNAL_PROVIDERS", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "gemini-embedding");
    vi.stubEnv("RAG_TOP_K", "3");
    const rows = [
      {
        id: "chunk-2",
        sourceId: "2",
        title: "Auralis Nova Wireless Earbuds (ELC-0002)",
        content: "Product: Auralis Nova",
        score: 0.81234,
      },
    ];
    const { service, gateway, governance, usage, prisma } = setup({
      model: geminiModel,
      indexed: 200,
      rows,
    });
    const citations = await service.retrieve(args);
    expect(governance.checkSensitive).toHaveBeenCalledWith(
      "water resistant earbuds",
      undefined,
    );
    expect(gateway.embed).toHaveBeenCalledWith(
      "gemini-embedding",
      ["task: search result | query: water resistant earbuds"],
      768,
      true,
    );
    expect(usage.record.mock.calls[0][0]).toMatchObject({
      requestId: "req-1:retrieval",
      conversationId: "conversation-1",
      operation: "EMBEDDING",
    });
    const query = prisma.$queryRaw.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(query[0].join("?")).toContain('"embeddingModel" =');
    expect(query.slice(1)).toEqual(
      expect.arrayContaining(["gemini-embedding", 3]),
    );
    expect(citations).toEqual([
      {
        id: "chunk-2",
        sourceId: "product:2",
        filename: "Auralis Nova Wireless Earbuds (ELC-0002)",
        page: null,
        content: "Product: Auralis Nova",
        kind: "product",
        score: 0.812,
      },
    ]);
  });

  it("uses small paced batches for external models by default", async () => {
    vi.stubEnv("ENABLE_EXTERNAL_PROVIDERS", "true");
    vi.stubEnv("GEMINI_API_KEY", "test-only");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "gemini-embedding");
    const { service } = setup({
      model: geminiModel,
      products: Array.from({ length: 100 }, (_, i) => product(i + 1)),
    });
    expect(service.batchSize(geminiModel as never)).toBe(25);
    expect(service.batchSize(mockModel as never)).toBe(100);
    expect(await service.reindex(admin)).toMatchObject({
      batches: 4,
      estimatedSeconds: 47,
    });
    service["indexing"] = false; // the background run is not awaited in this test
  });

  it("records a provider rate limit as zero tokens, since the call was refused", async () => {
    const { HttpException } = await import("@nestjs/common");
    const { service, gateway, usage } = setup({ indexed: 10 });
    gateway.embed.mockRejectedValueOnce(new HttpException("quota", 429));
    await expect(service.retrieve(args)).rejects.toThrow("quota");
    expect(usage.record.mock.calls[0][0]).toMatchObject({
      status: "ERROR",
      usage: { prompt_tokens: 0, completion_tokens: 0 },
    });
  });

  it("records a failed embedding call and still releases the reservation", async () => {
    const { service, gateway, usage, governance } = setup({ indexed: 10 });
    gateway.embed.mockRejectedValueOnce(
      Object.assign(new Error("free-tier quota"), { status: 429 }),
    );
    await expect(service.retrieve(args)).rejects.toThrow(/free-tier quota/);
    expect(usage.record.mock.calls[0][0]).toMatchObject({
      status: "ERROR",
      operation: "EMBEDDING",
    });
    expect(governance.release).toHaveBeenCalledWith("req-1:retrieval");
  });
});
