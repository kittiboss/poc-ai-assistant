import { Injectable } from '@nestjs/common';
import { Provider, RequestStatus, UsageKind } from '@prisma/client';
import { calculatePrice, estimateTokens } from '@enterprise/shared';
import Big from 'big.js';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import type { GatewayUsage } from '../gateway/gateway.service';
import { EXTERNAL_PROVIDERS } from '../models/model-policies';
import { PricingService } from '../pricing/pricing.service';
import { UsersService } from '../users/users.service';
import { externalBudgetExhausted, externalDailyLimits, startOfUtcDay } from './external-limits';

export type UsageInput = {
  requestId: string; userId: string; conversationId: string;
  model: { id: string; provider: Provider; local: boolean };
  input: string; output: string; durationMs: number; status: RequestStatus; usage?: GatewayUsage;
};

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService, private readonly users: UsersService, private readonly pricing: PricingService) {}

  /** One record per request ID (idempotent), with the pricing version used and a full price snapshot. */
  async record(args: UsageInput) {
    const pricing = await this.pricing.versionAt(args.model.id);
    if (!pricing) throw new Error('Pricing configuration missing');
    const inputTokens = args.usage?.prompt_tokens ?? estimateTokens(args.input);
    const outputTokens = args.usage?.completion_tokens ?? estimateTokens(args.output);
    const simulatedProvider = new Big(inputTokens).times(pricing.simulationInputRate.toString()).plus(new Big(outputTokens).times(pricing.simulationOutputRate.toString())).div(1_000_000);
    const providerInputRate = args.model.local ? '0' : pricing.providerInputRate.toString();
    const providerOutputRate = args.model.local ? '0' : pricing.providerOutputRate.toString();
    const price = calculatePrice({
      inputTokens, outputTokens, providerInputPerMillion: providerInputRate, providerOutputPerMillion: providerOutputRate,
      additionalProviderFee: args.model.local ? '0' : pricing.additionalFee.toString(),
      fixedInputPerMillion: pricing.customerInputRate.toString(), fixedOutputPerMillion: pricing.customerOutputRate.toString(),
      markupPercent: pricing.markupPercent.toString(), strategy: pricing.strategy,
      simulatedProviderCost: simulatedProvider.toString(),
    });
    const kind = args.model.provider === Provider.MOCK ? UsageKind.SYNTHETIC : args.usage ? UsageKind.ACTUAL : UsageKind.ESTIMATED;
    await this.prisma.usageRecord.upsert({
      where: { requestId: args.requestId }, update: {}, create: {
        requestId: args.requestId, userId: args.userId, conversationId: args.conversationId, modelId: args.model.id,
        pricingVersionId: pricing.id, provider: args.model.provider, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
        durationMs: args.durationMs, status: args.status, usageKind: kind, currency: pricing.currency,
        actualProviderCost: price.actualProviderCost, customerCharge: price.customerCharge,
        simulatedProviderCost: price.simulatedProviderCost, simulatedCustomerCharge: price.simulatedCustomerCharge,
        pricingSnapshot: { version: pricing.version, strategy: pricing.strategy, providerInputRate, providerOutputRate, cachedInputRate: pricing.cachedInputRate?.toString() || null, additionalFee: args.model.local ? '0' : pricing.additionalFee.toString(), customerInputRate: pricing.customerInputRate.toString(), customerOutputRate: pricing.customerOutputRate.toString(), markupPercent: pricing.markupPercent.toString(), simulationInputRate: pricing.simulationInputRate.toString(), simulationOutputRate: pricing.simulationOutputRate.toString() },
      },
    });
  }

  async mine(auth: AuthUser) {
    const user = await this.users.syncUser(auth);
    const [records, totals, byModel] = await Promise.all([
      this.prisma.usageRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { model: { select: { displayName: true } } } }),
      this.prisma.usageRecord.aggregate({ where: { userId: user.id }, _count: true, _sum: { inputTokens: true, outputTokens: true, totalTokens: true, actualProviderCost: true, customerCharge: true, simulatedProviderCost: true, simulatedCustomerCharge: true } }),
      this.prisma.usageRecord.groupBy({ by: ['modelId'], where: { userId: user.id }, _count: true, _sum: { totalTokens: true } }),
    ]);
    return { totals, byModel, records };
  }

  async externalUsageToday() {
    const usage = await this.prisma.usageRecord.aggregate({
      where: { provider: { in: [...EXTERNAL_PROVIDERS] as Provider[] }, createdAt: { gte: startOfUtcDay() } },
      _count: true, _sum: { totalTokens: true },
    });
    return { requests: usage._count, tokens: usage._sum.totalTokens || 0 };
  }

  async externalBudgetExhausted() {
    return externalBudgetExhausted(await this.externalUsageToday(), externalDailyLimits());
  }
}
