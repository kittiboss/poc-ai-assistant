import { Provider, RequestStatus, UsageKind } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { basePrisma, localUser, usersWith } from "../testing/fixtures";
import { PricingService } from "../pricing/pricing.service";
import { UsageService } from "./usage.service";

describe("usage tracking", () => {
  it("writes one synthetic, zero-actual-cost usage snapshot keyed by request ID", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      ...basePrisma(),
      pricingVersion: {
        findFirst: vi.fn().mockResolvedValue({
          id: "price-v1",
          version: 1,
          strategy: "SIMULATION",
          providerInputRate: 0,
          providerOutputRate: 0,
          cachedInputRate: null,
          additionalFee: 0,
          customerInputRate: 0,
          customerOutputRate: 0,
          markupPercent: 50,
          simulationInputRate: 2.5,
          simulationOutputRate: 3.571428571428,
          currency: "USD",
        }),
      },
      usageRecord: { upsert },
    };
    const service = new UsageService(
      prisma as never,
      usersWith(prisma),
      new PricingService(prisma as never, usersWith(prisma), {} as never),
    );
    await service.record({
      requestId: "request-unique",
      userId: localUser.id,
      conversationId: "conversation-1",
      model: { id: "local-mock", provider: Provider.MOCK, local: true },
      input: "Explain Docker Compose",
      output: "This is a mock AI response for local POC testing.",
      durationMs: 42,
      status: RequestStatus.COMPLETED,
      usage: { prompt_tokens: 5, completion_tokens: 12 },
    });
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ requestId: "request-unique" });
    expect(call.create.usageKind).toBe(UsageKind.SYNTHETIC);
    expect(call.create.actualProviderCost).toBe("0.000000000000");
    expect(call.create.pricingVersionId).toBe("price-v1");
    expect(call.create.pricingSnapshot.version).toBe(1);
  });

  it("keeps completed usage separate from active token reservations in the live snapshot", async () => {
    const prisma = {
      ...basePrisma(),
      usageRecord: {
        aggregate: vi
          .fn()
          .mockResolvedValueOnce({
            _count: 4,
            _sum: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
          })
          .mockResolvedValueOnce({
            _count: 2,
            _sum: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
          }),
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: "latest", totalTokens: 25 }]),
      },
      usageReservation: {
        aggregate: vi
          .fn()
          .mockResolvedValue({ _count: 1, _sum: { tokens: 2048 } }),
      },
    };
    const service = new UsageService(
      prisma as never,
      usersWith(prisma),
      {} as never,
    );
    const result = await service.live({
      sub: "kc-user-1",
      username: "employee1",
      roles: ["USER"],
    });
    expect(result.totals).toEqual({
      requests: 4,
      inputTokens: 80,
      outputTokens: 20,
      totalTokens: 100,
    });
    expect(result.today.totalTokens).toBe(40);
    expect(result.active).toEqual({ requests: 1, reservedTokens: 2048 });
    expect(result.recent).toEqual([{ id: "latest", totalTokens: 25 }]);
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });

  it("reports each model's usage today against its MODEL quota and the shared external limit", async () => {
    vi.stubEnv("EXTERNAL_DAILY_REQUEST_LIMIT", "33");
    vi.stubEnv("EXTERNAL_DAILY_TOKEN_LIMIT", "33333");
    const now = new Date("2026-10-29T04:40:00Z");
    const model = (
      id: string,
      provider: Provider,
      local: boolean,
      enabled = true,
    ) => ({
      id,
      displayName: id,
      provider,
      local,
      enabled,
    });
    const prisma = {
      aIModel: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            model("local-mock", Provider.MOCK, true),
            model("gemini-embedding", Provider.GEMINI, false, false),
            model("google-gemini", Provider.GEMINI, false, false),
            model("groq-llama", Provider.GROQ, false),
          ]),
      },
      usageRecord: {
        groupBy: vi.fn().mockResolvedValue([
          { modelId: "groq-llama", _count: 3, _sum: { totalTokens: 6000 } },
          {
            modelId: "gemini-embedding",
            _count: 5,
            _sum: { totalTokens: 16063 },
          },
        ]),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _count: 8, _sum: { totalTokens: 22063 } }),
      },
      usageReservation: {
        groupBy: vi
          .fn()
          .mockResolvedValue([
            { modelId: "groq-llama", _count: 1, _sum: { tokens: 2048 } },
          ]),
        aggregate: vi
          .fn()
          .mockResolvedValue({ _count: 1, _sum: { tokens: 2048 } }),
      },
      quotaPolicy: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              scope: "MODEL",
              subject: "groq-llama",
              dailyRequests: 20,
              dailyTokens: null,
            },
          ]),
      },
    };
    const service = new UsageService(prisma as never, {} as never, {} as never);
    const result = await service.modelsToday(now);

    expect(result.resetsAt).toEqual(new Date("2026-10-30T00:00:00Z"));
    expect(result.external).toEqual({
      requests: { used: 8, reserved: 1, limit: 33 },
      tokens: { used: 22063, reserved: 2048, limit: 33333 },
    });
    // A disabled model still shows when it was used today; one that was not is left out.
    expect(result.models.map((m) => m.modelId)).toEqual([
      "local-mock",
      "gemini-embedding",
      "groq-llama",
    ]);
    expect(result.models[0]).toMatchObject({
      external: false,
      requests: { used: 0, reserved: 0, limit: null },
      tokens: { used: 0, reserved: 0, limit: null },
    });
    expect(result.models[2]).toMatchObject({
      external: true,
      requests: { used: 3, reserved: 1, limit: 20 },
      tokens: { used: 6000, reserved: 2048, limit: null },
    });
    const today = new Date("2026-10-29T00:00:00Z");
    expect(prisma.usageRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { createdAt: { gte: today } } }),
    );
    expect(prisma.usageReservation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: { expiresAt: { gt: now } } }),
    );
    expect(prisma.quotaPolicy.findMany).toHaveBeenCalledWith({
      where: { scope: "MODEL" },
    });
    vi.unstubAllEnvs();
  });
});
