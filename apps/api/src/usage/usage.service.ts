import { Injectable } from "@nestjs/common";
import {
  Provider,
  RequestStatus,
  UsageKind,
  UsageOperation,
} from "@prisma/client";
import { calculatePrice, estimateTokens } from "@enterprise/shared";
import Big from "big.js";
import type { AuthUser } from "../common/auth/auth.decorators";
import { PrismaService } from "../common/prisma/prisma.service";
import type { GatewayUsage } from "../gateway/gateway.service";
import {
  EXTERNAL_PROVIDERS,
  isExternalProvider,
  vendorGateway,
} from "../models/model-policies";
import { PricingService } from "../pricing/pricing.service";
import { UsersService } from "../users/users.service";
import {
  externalBudgetExhausted,
  externalDailyLimits,
  startOfUtcDay,
} from "./external-limits";

export type UsageInput = {
  requestId: string;
  userId: string;
  /** Null for work outside a conversation, such as indexing the product catalog. */
  conversationId: string | null;
  model: { id: string; provider: Provider; local: boolean };
  operation?: UsageOperation;
  input: string;
  output: string;
  durationMs: number;
  status: RequestStatus;
  usage?: GatewayUsage;
};

@Injectable()
export class UsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly pricing: PricingService,
  ) {}

  /** One record per request ID (idempotent), with the pricing version used and a full price snapshot. */
  async record(args: UsageInput) {
    const pricing = await this.pricing.versionAt(args.model.id);
    if (!pricing) throw new Error("Pricing configuration missing");
    const inputTokens = args.usage?.prompt_tokens ?? estimateTokens(args.input);
    const outputTokens =
      args.usage?.completion_tokens ?? estimateTokens(args.output);
    const simulatedProvider = new Big(inputTokens)
      .times(pricing.simulationInputRate.toString())
      .plus(
        new Big(outputTokens).times(pricing.simulationOutputRate.toString()),
      )
      .div(1_000_000);
    const providerInputRate = args.model.local
      ? "0"
      : pricing.providerInputRate.toString();
    const providerOutputRate = args.model.local
      ? "0"
      : pricing.providerOutputRate.toString();
    const price = calculatePrice({
      inputTokens,
      outputTokens,
      providerInputPerMillion: providerInputRate,
      providerOutputPerMillion: providerOutputRate,
      additionalProviderFee: args.model.local
        ? "0"
        : pricing.additionalFee.toString(),
      fixedInputPerMillion: pricing.customerInputRate.toString(),
      fixedOutputPerMillion: pricing.customerOutputRate.toString(),
      markupPercent: pricing.markupPercent.toString(),
      strategy: pricing.strategy,
      simulatedProviderCost: simulatedProvider.toString(),
    });
    const kind =
      args.model.provider === Provider.MOCK
        ? UsageKind.SYNTHETIC
        : args.usage
          ? UsageKind.ACTUAL
          : UsageKind.ESTIMATED;
    await this.prisma.usageRecord.upsert({
      where: { requestId: args.requestId },
      update: {},
      create: {
        requestId: args.requestId,
        userId: args.userId,
        conversationId: args.conversationId,
        modelId: args.model.id,
        operation: args.operation ?? UsageOperation.CHAT,
        pricingVersionId: pricing.id,
        provider: args.model.provider,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        durationMs: args.durationMs,
        status: args.status,
        usageKind: kind,
        currency: pricing.currency,
        actualProviderCost: price.actualProviderCost,
        customerCharge: vendorGateway() ? "0" : price.customerCharge,
        simulatedProviderCost: price.simulatedProviderCost,
        simulatedCustomerCharge: vendorGateway() ? args.usage?.billing?.charge ?? "0" : price.simulatedCustomerCharge,
        pricingSnapshot: {
          ...(args.usage?.billing ? { gatewayBilling: args.usage.billing } : {}),
          version: pricing.version,
          strategy: pricing.strategy,
          providerInputRate,
          providerOutputRate,
          cachedInputRate: pricing.cachedInputRate?.toString() || null,
          additionalFee: args.model.local
            ? "0"
            : pricing.additionalFee.toString(),
          customerInputRate: pricing.customerInputRate.toString(),
          customerOutputRate: pricing.customerOutputRate.toString(),
          markupPercent: pricing.markupPercent.toString(),
          simulationInputRate: pricing.simulationInputRate.toString(),
          simulationOutputRate: pricing.simulationOutputRate.toString(),
        },
      },
    });
  }

  async mine(auth: AuthUser) {
    const user = await this.users.syncUser(auth);
    const [records, totals, byModel] = await Promise.all([
      this.prisma.usageRecord.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { model: { select: { displayName: true } } },
      }),
      this.prisma.usageRecord.aggregate({
        where: { userId: user.id },
        _count: true,
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          actualProviderCost: true,
          customerCharge: true,
          simulatedProviderCost: true,
          simulatedCustomerCharge: true,
        },
      }),
      this.prisma.usageRecord.groupBy({
        by: ["modelId"],
        where: { userId: user.id },
        _count: true,
        _sum: { totalTokens: true },
      }),
    ]);
    return { totals, byModel, records };
  }

  /** Lightweight snapshot for the live UI. In-flight tokens are reservations, never reported as consumed usage. */
  async live(auth: AuthUser) {
    const user = await this.users.findOrSyncUser(auth);
    const today = startOfUtcDay();
    const where = { userId: user.id };
    const [totals, todayTotals, active, recent] = await Promise.all([
      this.prisma.usageRecord.aggregate({
        where,
        _count: true,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.usageRecord.aggregate({
        where: { ...where, createdAt: { gte: today } },
        _count: true,
        _sum: { inputTokens: true, outputTokens: true, totalTokens: true },
      }),
      this.prisma.usageReservation.aggregate({
        where: { userId: user.id, expiresAt: { gt: new Date() } },
        _count: true,
        _sum: { tokens: true },
      }),
      this.prisma.usageRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          requestId: true,
          modelId: true,
          provider: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          durationMs: true,
          status: true,
          usageKind: true,
          createdAt: true,
          model: { select: { displayName: true } },
        },
      }),
    ]);
    const summary = (value: typeof totals) => ({
      requests: value._count,
      inputTokens: value._sum.inputTokens || 0,
      outputTokens: value._sum.outputTokens || 0,
      totalTokens: value._sum.totalTokens || 0,
    });
    return {
      updatedAt: new Date(),
      pollAfterMs: 1500,
      totals: summary(totals),
      today: summary(todayTotals),
      active: {
        requests: active._count,
        reservedTokens: active._sum.tokens || 0,
      },
      recent,
    };
  }

  /**
   * Today's use of each model against its daily limits, counted the way admission
   * (GovernanceService.reserve) counts it: completed records plus active reservations, installation-wide.
   */
  async modelsToday(now = new Date()) {
    const today = startOfUtcDay(now);
    const active = { expiresAt: { gt: now } };
    const external = { in: [...EXTERNAL_PROVIDERS] as Provider[] };
    const [models, used, reserved, policies, externalUsed, externalReserved] =
      await Promise.all([
        this.prisma.aIModel.findMany({
          select: {
            id: true,
            displayName: true,
            provider: true,
            local: true,
            enabled: true,
          },
          orderBy: [{ local: "desc" }, { displayName: "asc" }],
        }),
        this.prisma.usageRecord.groupBy({
          by: ["modelId"],
          where: { createdAt: { gte: today } },
          _count: true,
          _sum: { totalTokens: true },
        }),
        this.prisma.usageReservation.groupBy({
          by: ["modelId"],
          where: active,
          _count: true,
          _sum: { tokens: true },
        }),
        this.prisma.quotaPolicy.findMany({ where: { scope: "MODEL" } }),
        this.prisma.usageRecord.aggregate({
          where: { createdAt: { gte: today }, provider: external },
          _count: true,
          _sum: { totalTokens: true },
        }),
        this.prisma.usageReservation.aggregate({
          where: { ...active, external: true },
          _count: true,
          _sum: { tokens: true },
        }),
      ]);
    const usedBy = new Map(used.map((row) => [row.modelId, row]));
    const reservedBy = new Map(reserved.map((row) => [row.modelId, row]));
    const policyFor = new Map(policies.map((policy) => [policy.subject, policy]));
    const limits = externalDailyLimits();
    return {
      updatedAt: now,
      pollAfterMs: 5000,
      resetsAt: new Date(today.getTime() + 86_400_000),
      external: {
        requests: {
          used: externalUsed._count,
          reserved: externalReserved._count,
          limit: limits.requests,
        },
        tokens: {
          used: externalUsed._sum.totalTokens || 0,
          reserved: externalReserved._sum.tokens || 0,
          limit: limits.tokens,
        },
      },
      models: models
        .filter((model) => model.enabled || usedBy.has(model.id))
        .map((model) => {
          const done = usedBy.get(model.id);
          const held = reservedBy.get(model.id);
          const policy = policyFor.get(model.id);
          return {
            modelId: model.id,
            displayName: model.displayName,
            provider: model.provider,
            local: model.local,
            external: isExternalProvider(model.provider),
            requests: {
              used: done?._count ?? 0,
              reserved: held?._count ?? 0,
              limit: policy?.dailyRequests ?? null,
            },
            tokens: {
              used: done?._sum.totalTokens || 0,
              reserved: held?._sum.tokens || 0,
              limit: policy?.dailyTokens ?? null,
            },
          };
        }),
    };
  }

  async externalUsageToday() {
    const usage = await this.prisma.usageRecord.aggregate({
      where: {
        provider: { in: [...EXTERNAL_PROVIDERS] as Provider[] },
        createdAt: { gte: startOfUtcDay() },
      },
      _count: true,
      _sum: { totalTokens: true },
    });
    return { requests: usage._count, tokens: usage._sum.totalTokens || 0 };
  }

  async externalBudgetExhausted() {
    return externalBudgetExhausted(
      await this.externalUsageToday(),
      externalDailyLimits(),
    );
  }
}
