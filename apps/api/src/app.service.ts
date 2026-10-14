import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MessageRole, MessageStatus, PricingStrategy, Prisma, Provider, RequestStatus, UsageKind } from '@prisma/client';
import { calculatePrice, estimateTokens } from '@enterprise/shared';
import Big from 'big.js';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AuthUser } from './auth';
import type { PreviewPricingDto, SendMessageDto, UpdatePricingDto } from './dto';
import { GatewayService } from './gateway.service';
import { PrismaService } from './prisma.service';
import { externalProviderAllowed, isExternalProvider, modelAllowedForUser } from './policies';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService, private readonly gateway: GatewayService) {}

  async syncUser(auth: AuthUser) {
    const user = await this.prisma.user.upsert({
      where: { externalId: auth.sub },
      update: { username: auth.username, email: auth.email },
      create: { externalId: auth.sub, username: auth.username, email: auth.email },
    });
    const roles = await this.prisma.role.findMany({ where: { name: { in: auth.roles } } });
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId: user.id, roleId: { notIn: roles.map((r) => r.id) } } }),
      this.prisma.userRole.createMany({ data: roles.map((role) => ({ userId: user.id, roleId: role.id })), skipDuplicates: true }),
    ]);
    return user;
  }

  async listModels(auth: AuthUser) {
    const user = await this.syncUser(auth);
    const models = await this.prisma.aIModel.findMany({
      include: { permissions: { where: { userId: user.id } }, pricing: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } },
      orderBy: [{ local: 'desc' }, { displayName: 'asc' }],
    });
    const externalSwitch = process.env.ENABLE_EXTERNAL_PROVIDERS === 'true';
    return Promise.all(models.map(async (model) => {
      const credential = this.credentialFor(model.provider);
      const permitted = modelAllowedForUser(model.allowedRoles, auth.roles, model.permissions[0]?.allowed);
      const configured = externalProviderAllowed(model.provider, externalSwitch, credential);
      const available = model.enabled && permitted && configured && (model.provider === Provider.OLLAMA ? await this.ollamaAvailable(model.providerModelId) : await this.gateway.available(model.id));
      const price = model.pricing?.versions[0];
      return {
        id: model.id, displayName: model.displayName, provider: model.provider, providerModelId: model.providerModelId,
        enabled: model.enabled, permitted, available, local: model.local, contextWindow: model.contextWindow,
        capabilities: model.capabilities, status: !model.enabled ? 'Disabled' : !permitted ? 'Not permitted' : !configured ? 'Not configured' : available ? 'Available' : 'Unavailable',
        externalApiCost: model.local ? '0' : price?.providerInputRate.toString() || null,
      };
    }));
  }

  private credentialFor(provider: Provider) {
    return provider === Provider.OPENAI ? process.env.OPENAI_API_KEY : provider === Provider.ANTHROPIC ? process.env.ANTHROPIC_API_KEY : provider === Provider.GEMINI ? process.env.GEMINI_API_KEY : 'local';
  }

  private async ollamaAvailable(providerModelId: string) {
    try {
      const response = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(1200) });
      if (!response.ok) return false;
      const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      return Boolean(payload.models?.some((model) => model.name === providerModelId || model.model === providerModelId));
    } catch { return false; }
  }

  async createConversation(auth: AuthUser, title?: string) {
    const user = await this.syncUser(auth);
    return this.prisma.conversation.create({ data: { userId: user.id, title: title?.trim() || 'New conversation' } });
  }

  async conversations(auth: AuthUser, search?: string) {
    const user = await this.syncUser(auth);
    return this.prisma.conversation.findMany({
      where: { userId: user.id, deletedAt: null, ...(search ? { title: { contains: search, mode: 'insensitive' } } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
  }

  async conversation(auth: AuthUser, id: string) {
    const user = await this.syncUser(auth);
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, userId: user.id, deletedAt: null }, include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  async renameConversation(auth: AuthUser, id: string, title: string) {
    const user = await this.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { title: title.trim() } });
    if (!result.count) throw new NotFoundException('Conversation not found');
    return this.prisma.conversation.findUnique({ where: { id } });
  }

  async deleteConversation(auth: AuthUser, id: string) {
    const user = await this.syncUser(auth);
    const result = await this.prisma.conversation.updateMany({ where: { id, userId: user.id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!result.count) throw new NotFoundException('Conversation not found');
  }

  async streamMessage(auth: AuthUser, conversationId: string, dto: SendMessageDto, response: Response) {
    const user = await this.syncUser(auth);
    const conversation = await this.prisma.conversation.findFirst({ where: { id: conversationId, userId: user.id, deletedAt: null } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const model = await this.prisma.aIModel.findUnique({
      where: { id: dto.modelId }, include: { permissions: { where: { userId: user.id } } },
    });
    if (!model || !model.enabled) throw new BadRequestException('Model is disabled or unknown');
    if (!modelAllowedForUser(model.allowedRoles, auth.roles, model.permissions[0]?.allowed)) throw new ForbiddenException('Model is not allowed for this user');
    if (!externalProviderAllowed(model.provider, process.env.ENABLE_EXTERNAL_PROVIDERS === 'true', this.credentialFor(model.provider))) {
      throw new ForbiddenException('External provider is not explicitly enabled and configured');
    }
    const requestId = dto.requestId || randomUUID();
    const [duplicateUsage, duplicateMessage] = await Promise.all([
      this.prisma.usageRecord.findUnique({ where: { requestId } }),
      this.prisma.message.findUnique({ where: { requestId } }),
    ]);
    if (duplicateUsage || duplicateMessage) throw new BadRequestException('This request ID has already been processed');
    const [, assistant] = await this.prisma.$transaction([
      this.prisma.message.create({ data: { conversationId, role: MessageRole.USER, content: dto.content, status: MessageStatus.COMPLETED } }),
      this.prisma.message.create({ data: { conversationId, role: MessageRole.ASSISTANT, content: '', status: MessageStatus.STREAMING, modelId: model.id, requestId } }),
      this.prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date(), ...(conversation.title === 'New conversation' ? { title: dto.content.slice(0, 70) } : {}) } }),
    ]);
    const messages = (await this.prisma.message.findMany({ where: { conversationId, id: { not: assistant.id } }, orderBy: { createdAt: 'desc' }, take: 50 })).reverse();

    response.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    response.flushHeaders();
    const aborter = new AbortController();
    response.on('close', () => { if (!response.writableEnded) aborter.abort(); });
    const started = Date.now();
    let content = '';
    let status: RequestStatus = RequestStatus.STREAMING;
    let usage;
    try {
      usage = await this.gateway.stream(
        model.id,
        messages.map((message) => ({ role: message.role.toLowerCase() as 'user' | 'assistant' | 'system', content: message.content })),
        aborter.signal,
        (text) => { content += text; response.write(`event: token\ndata: ${JSON.stringify({ text })}\n\n`); },
      );
      status = RequestStatus.COMPLETED;
      await this.prisma.message.update({ where: { id: assistant.id }, data: { content, status: MessageStatus.COMPLETED } });
      await this.recordUsage({ requestId, userId: user.id, conversationId, model, input: messages.map((m) => m.content).join(' '), output: content, durationMs: Date.now() - started, status, usage });
      response.write(`event: done\ndata: ${JSON.stringify({ requestId, messageId: assistant.id })}\n\n`);
      response.end();
    } catch (error) {
      const cancelled = aborter.signal.aborted;
      status = cancelled ? RequestStatus.CANCELLED : RequestStatus.ERROR;
      await this.prisma.message.update({ where: { id: assistant.id }, data: { content, status: cancelled ? MessageStatus.INTERRUPTED : MessageStatus.ERROR } });
      await this.recordUsage({ requestId, userId: user.id, conversationId, model, input: messages.map((m) => m.content).join(' '), output: content, durationMs: Date.now() - started, status, usage }).catch(() => undefined);
      if (!cancelled && !response.writableEnded) {
        response.write(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : 'Generation failed' })}\n\n`);
        response.end();
      }
    }
  }

  private async recordUsage(args: { requestId: string; userId: string; conversationId: string; model: { id: string; provider: Provider; local: boolean }; input: string; output: string; durationMs: number; status: RequestStatus; usage?: { prompt_tokens?: number; completion_tokens?: number } }) {
    const pricing = await this.prisma.pricingVersion.findFirst({ where: { configuration: { modelId: args.model.id }, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }] });
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

  async myUsage(auth: AuthUser) {
    const user = await this.syncUser(auth);
    const [records, totals, byModel] = await Promise.all([
      this.prisma.usageRecord.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { model: { select: { displayName: true } } } }),
      this.prisma.usageRecord.aggregate({ where: { userId: user.id }, _count: true, _sum: { inputTokens: true, outputTokens: true, totalTokens: true, actualProviderCost: true, customerCharge: true, simulatedProviderCost: true, simulatedCustomerCharge: true } }),
      this.prisma.usageRecord.groupBy({ by: ['modelId'], where: { userId: user.id }, _count: true, _sum: { totalTokens: true } }),
    ]);
    return { totals, byModel, records };
  }

  async adminSummary() {
    const [users, requests, tokens, byProvider, byModel, costs] = await Promise.all([
      this.prisma.user.count(), this.prisma.usageRecord.count(),
      this.prisma.usageRecord.aggregate({ _sum: { inputTokens: true, outputTokens: true, totalTokens: true } }),
      this.prisma.usageRecord.groupBy({ by: ['provider'], _count: true, _sum: { totalTokens: true } }),
      this.prisma.usageRecord.groupBy({ by: ['modelId'], _count: true, _sum: { totalTokens: true } }),
      this.prisma.usageRecord.aggregate({ _sum: { actualProviderCost: true, customerCharge: true, simulatedProviderCost: true, simulatedCustomerCharge: true } }),
    ]);
    return { users, requests, tokens: tokens._sum, byProvider, byModel, costs: costs._sum };
  }

  async adminModels() {
    return this.prisma.aIModel.findMany({ include: { pricing: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } }, orderBy: { displayName: 'asc' } });
  }

  async updateModel(auth: AuthUser, id: string, data: { enabled?: boolean; allowedRoles?: string[] }) {
    const actor = await this.syncUser(auth);
    const before = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Model not found');
    if (isExternalProvider(before.provider) && data.enabled && !externalProviderAllowed(before.provider, process.env.ENABLE_EXTERNAL_PROVIDERS === 'true', this.credentialFor(before.provider))) throw new BadRequestException('External models require both ENABLE_EXTERNAL_PROVIDERS=true and valid provider credentials');
    const after = await this.prisma.aIModel.update({ where: { id }, data });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'MODEL_UPDATE', entityType: 'AIModel', entityId: id, before: before as unknown as Prisma.InputJsonValue, after: after as unknown as Prisma.InputJsonValue } });
    return after;
  }

  async setModelPermission(auth: AuthUser, userId: string, modelId: string, allowed: boolean) {
    const actor = await this.syncUser(auth);
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const result = await this.prisma.userModelPermission.upsert({ where: { userId_modelId: { userId, modelId } }, update: { allowed }, create: { userId, modelId, allowed } });
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'MODEL_PERMISSION_UPDATE', entityType: 'UserModelPermission', entityId: `${userId}:${modelId}`, after: result as unknown as Prisma.InputJsonValue } });
    return result;
  }

  async users() {
    return this.prisma.user.findMany({ select: { id: true, username: true, email: true, createdAt: true, roles: { include: { role: true } }, modelPermissions: true }, orderBy: { username: 'asc' } });
  }

  async pricing(modelId?: string) {
    return this.prisma.pricingConfiguration.findMany({
      where: modelId ? { modelId } : {}, include: { model: true, versions: { orderBy: { version: 'desc' } } }, orderBy: { model: { displayName: 'asc' } },
    });
  }

  calculatePreview(dto: PreviewPricingDto) {
    const simulated = new Big(dto.inputTokens).times(dto.simulationInputRate || '0').plus(new Big(dto.outputTokens).times(dto.simulationOutputRate || '0')).div(1_000_000);
    return calculatePrice({ inputTokens: dto.inputTokens, outputTokens: dto.outputTokens, providerInputPerMillion: dto.providerInputRate, providerOutputPerMillion: dto.providerOutputRate, additionalProviderFee: dto.additionalFee, fixedInputPerMillion: dto.customerInputRate, fixedOutputPerMillion: dto.customerOutputRate, markupPercent: dto.markupPercent, strategy: dto.strategy, simulatedProviderCost: simulated.toString() });
  }

  async updatePricing(auth: AuthUser, modelId: string, dto: UpdatePricingDto) {
    const actor = await this.syncUser(auth);
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
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'PRICING_VERSION_CREATE', entityType: 'PricingConfiguration', entityId: model.pricing.id, before: previous as unknown as Prisma.InputJsonValue, after: created as unknown as Prisma.InputJsonValue } });
    return created;
  }
}
