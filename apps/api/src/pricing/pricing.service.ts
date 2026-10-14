import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PricingStrategy } from '@prisma/client';
import { calculatePrice } from '@enterprise/shared';
import Big from 'big.js';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { PreviewPricingDto, UpdatePricingDto } from './pricing.dto';

/** Pricing versions are append-only (also enforced by a database trigger); usage keeps its own snapshot. */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService, private readonly users: UsersService, private readonly audit: AuditService) {}

  list(modelId?: string) {
    return this.prisma.pricingConfiguration.findMany({
      where: modelId ? { modelId } : {}, include: { model: true, versions: { orderBy: { version: 'desc' } } }, orderBy: { model: { displayName: 'asc' } },
    });
  }

  /** The version in effect at `at`; a future-dated version applies only once its effective time arrives. */
  versionAt(modelId: string, at = new Date()) {
    return this.prisma.pricingVersion.findFirst({ where: { configuration: { modelId }, effectiveAt: { lte: at } }, orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }] });
  }

  preview(dto: PreviewPricingDto) {
    const simulated = new Big(dto.inputTokens).times(dto.simulationInputRate || '0').plus(new Big(dto.outputTokens).times(dto.simulationOutputRate || '0')).div(1_000_000);
    return calculatePrice({ inputTokens: dto.inputTokens, outputTokens: dto.outputTokens, providerInputPerMillion: dto.providerInputRate, providerOutputPerMillion: dto.providerOutputRate, additionalProviderFee: dto.additionalFee, fixedInputPerMillion: dto.customerInputRate, fixedOutputPerMillion: dto.customerOutputRate, markupPercent: dto.markupPercent, strategy: dto.strategy, simulatedProviderCost: simulated.toString() });
  }

  async createVersion(auth: AuthUser, modelId: string, dto: UpdatePricingDto) {
    const actor = await this.users.syncUser(auth);
    const model = await this.prisma.aIModel.findUnique({ where: { id: modelId }, include: { pricing: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } } });
    if (!model?.pricing) throw new NotFoundException('Model pricing not found');
    if (model.local && (new Big(dto.providerInputRate).gt(0) || new Big(dto.providerOutputRate).gt(0) || new Big(dto.additionalFee || 0).gt(0))) throw new BadRequestException('Local models must have zero actual external provider cost');
    const previous = model.pricing.versions[0];
    const created = await this.prisma.pricingVersion.create({ data: {
      configurationId: model.pricing.id, version: (previous?.version || 0) + 1, strategy: dto.strategy as PricingStrategy,
      providerInputRate: dto.providerInputRate, providerOutputRate: dto.providerOutputRate, cachedInputRate: dto.cachedInputRate,
      additionalFee: dto.additionalFee || '0', customerInputRate: dto.customerInputRate || '0', customerOutputRate: dto.customerOutputRate || '0',
      markupPercent: dto.markupPercent || '0', simulationInputRate: dto.simulationInputRate || '0', simulationOutputRate: dto.simulationOutputRate || '0',
      currency: dto.currency.toUpperCase(), effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : new Date(), createdBy: actor.externalId,
    } });
    await this.audit.record({ actorId: actor.id, action: 'PRICING_VERSION_CREATE', entityType: 'PricingConfiguration', entityId: model.pricing.id, before: previous, after: created });
    return created;
  }
}
