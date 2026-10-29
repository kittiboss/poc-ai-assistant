import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspace.service";
import { GovernanceService } from "./governance.service";
import { chunkPages, extractDocument } from "./documents";
import { auth, localUser, usersWith } from "../testing/fixtures";

describe("workspace authorization and bounded extraction", () => {
  it("rejects retrieval from another user project before querying chunks", async () => {
    const prisma = {
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      $queryRaw: vi.fn(),
    };
    const service = new WorkspaceService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.search(localUser.id, "foreign-project", "salary"),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it("does not permit a disallowed template even if a caller knows its ID", async () => {
    const prisma = {
      user: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ instructions: "" }),
      },
      memory: { findMany: vi.fn().mockResolvedValue([]) },
      promptTemplate: {
        findUnique: vi
          .fn()
          .mockResolvedValue({
            enabled: true,
            allowedRoles: ["ADMIN"],
            allowedModels: [],
          }),
      },
    };
    const service = new WorkspaceService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.context(
        localUser.id,
        ["USER"],
        null,
        "hi",
        "local-mock",
        "admin-template",
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("keeps page numbers and bounded chunks and rejects scanned or invalid documents", async () => {
    const chunks = chunkPages([{ page: 4, text: "a".repeat(3000) }]);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.content.length <= 1400 && c.page === 4)).toBe(
      true,
    );
    expect(() => chunkPages([{ page: 1, text: "" }])).toThrow(/OCR/);
    await expect(
      extractDocument("payload.exe", Buffer.from("hello")),
    ).rejects.toThrow(/Supported/);
    await expect(
      extractDocument("wrong.pdf", Buffer.from("not a pdf")),
    ).rejects.toThrow(/Invalid PDF/);
    await expect(
      extractDocument("huge.txt", Buffer.alloc(6 * 1024 * 1024)),
    ).rejects.toThrow(/5 MB/);
    await expect(
      extractDocument("thai.txt", Buffer.from("สวัสดี")),
    ).resolves.toEqual([{ text: "สวัสดี", page: null }]);
  });
});

describe("governance admission", () => {
  const setup = (policy: object | null, blocked = false) => {
    const tx = {
      $executeRaw: vi.fn(),
      applicationSetting: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ value: { externalBlocked: blocked } }),
      },
      user: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ ...localUser, department: "Engineering" }),
      },
      pricingVersion: {
        findFirst: vi
          .fn()
          .mockResolvedValue({
            currency: "USD",
            simulationInputRate: "2",
            simulationOutputRate: "3",
          }),
      },
      quotaPolicy: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            policy
              ? [
                  {
                    scope: "USER",
                    subject: localUser.id,
                    dailyRequests: null,
                    dailyTokens: null,
                    perRequestTokens: null,
                    dailySimulatedBudget: null,
                    ...policy,
                  },
                ]
              : [],
          ),
      },
      usageRecord: {
        aggregate: vi
          .fn()
          .mockResolvedValue({
            _count: 0,
            _sum: { totalTokens: 0, simulatedProviderCost: 0 },
          }),
      },
      usageReservation: {
        aggregate: vi
          .fn()
          .mockResolvedValue({
            _count: 1,
            _sum: { tokens: 600, simulatedCost: "0.0018" },
          }),
        create: vi.fn(),
      },
    };
    const prisma = {
      ...tx,
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)),
    };
    return {
      tx,
      service: new GovernanceService(
        prisma as never,
        usersWith(prisma),
        {} as never,
      ),
    };
  };
  const args = {
    requestId: "test",
    userId: localUser.id,
    modelId: "local-mock",
    roles: auth.roles,
    external: false,
    input: "hello",
    outputTokens: 100,
  };
  it("counts pending reservations before admitting another request", async () => {
    const { service, tx } = setup({ dailyRequests: 1 });
    await expect(service.reserve(args)).rejects.toMatchObject({ status: 429 });
    expect(tx.usageReservation.create).not.toHaveBeenCalled();
  });
  it("tells a refused request how much it needed and how much was left", async () => {
    const refusal = async (promise: Promise<unknown>) =>
      ((await promise.catch((error: HttpException) => error)) as HttpException).getResponse();
    // 5 input bytes + 100 output + 512 margin, with 600 already held by a running request.
    expect(await refusal(setup({ dailyTokens: 1000 }).service.reserve(args))).toMatchObject({
      statusCode: 429,
      code: "QUOTA_EXCEEDED",
      message: expect.stringContaining("needs up to 617, 400 of 1000 left"),
      quota: { scope: "USER", subject: localUser.id, unit: "tokens", period: "day", limit: 1000, used: 600, needed: 617 },
    });
    vi.stubEnv("EXTERNAL_DAILY_REQUEST_LIMIT", "100");
    vi.stubEnv("EXTERNAL_DAILY_TOKEN_LIMIT", "1000");
    const external = (await refusal(setup(null).service.reserve({ ...args, external: true }))) as {
      quota: { resetsAt: Date };
    };
    expect(external).toMatchObject({
      code: "QUOTA_EXCEEDED",
      quota: { scope: "INSTALLATION", subject: "external", unit: "tokens", limit: 1000, used: 600, needed: 617 },
    });
    expect(external.quota.resetsAt.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    vi.unstubAllEnvs();
  });
  it("enforces per-request tokens and decimal simulated budgets", async () => {
    await expect(
      setup({ perRequestTokens: 1 }).service.reserve(args),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      setup({ dailySimulatedBudget: "0.002" }).service.reserve(args),
    ).rejects.toMatchObject({ status: 429 });
    await expect(setup(null).service.reserve(args)).resolves.toBeUndefined();
  });
  it("kill switch blocks external but leaves local requests available", async () => {
    const { service, tx } = setup(null, true);
    await expect(
      service.reserve({ ...args, external: true }),
    ).rejects.toMatchObject({ status: 403 });
    expect(tx.usageReservation.create).not.toHaveBeenCalled();
    await service.reserve(args);
    expect(tx.usageReservation.create).toHaveBeenCalledOnce();
  });
  it("a BLOCK sensitive policy cannot be bypassed with acknowledgment", async () => {
    const prisma = {
      applicationSetting: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ value: { sensitiveMode: "BLOCK" } }),
      },
    };
    const service = new GovernanceService(
      prisma as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.checkSensitive("password=example123", true),
    ).rejects.toMatchObject({ status: 400 });
    prisma.applicationSetting.findUnique.mockResolvedValue({
      value: { sensitiveMode: "WARN" },
    });
    await expect(
      service.checkSensitive("password=example123", true),
    ).resolves.toBeUndefined();
    await expect(
      service.checkSensitive("password=example123", false),
    ).rejects.toMatchObject({ status: 400 });
  });
});
