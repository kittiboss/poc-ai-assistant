import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { MAX_CHAT_IMAGES } from '../attachments/attachments.service';
import { GatewayService, gatewayError, type GatewayRoute } from '../gateway/gateway.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import { credentialFor, externalProviderAllowed, imagesAvailable, isExternalProvider, modelAllowedForUser, vendorGateway } from './model-policies';
import { VISION_MODELS, type VisionFigures } from './vision-models';

const externalSwitch = () => process.env.ENABLE_EXTERNAL_PROVIDERS === 'true';

/** Whether this deployment may send images to `model` at all: object storage, `vision`, and its figures. */
const mayReceiveImages = (model: { id: string; capabilities: string[] }) =>
  imagesAvailable() && model.capabilities.includes('vision') && VISION_MODELS.has(model.id);

/**
 * The images a chat may hold for `model` and the tokens counted per image, or null when it cannot
 * receive them: the model's own figures (VISION_MODELS). A vendor-managed deployment also needs
 * `vision` on the gateway's route, whose limit may be lower and whose tokens per image are what the
 * platform reserves.
 */
function imageFiguresOf(model: { id: string; capabilities: string[] }, routes: Map<string, GatewayRoute>): VisionFigures | null {
  if (!mayReceiveImages(model)) return null;
  const own = VISION_MODELS.get(model.id)!;
  const maxImages = Math.min(own.maxImages, MAX_CHAT_IMAGES);
  if (!vendorGateway()) return { maxImages, imageTokens: own.imageTokens };
  const route = routes.get(model.id);
  return route?.vision
    ? { maxImages: Math.min(route.maxImages ?? maxImages, maxImages), imageTokens: route.imageTokens ?? own.imageTokens }
    : null;
}

@Injectable()
export class ModelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly gateway: GatewayService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  async forUser(auth: AuthUser) {
    const user = await this.users.syncUser(auth);
    // Embedding-only models serve retrieval and never appear as chat choices.
    const models = await this.prisma.aIModel.findMany({
      where: { capabilities: { has: 'chat' } },
      include: { permissions: { where: { userId: user.id } } },
      orderBy: [{ local: 'desc' }, { displayName: 'asc' }],
    });
    const [{ reachable, routes }, credit] = await Promise.all([this.reachability(models.filter((model) => model.enabled)), this.gateway.credit()]);
    const budgetExhausted = models.some((model) => model.enabled && isExternalProvider(model.provider)) && await this.usage.externalBudgetExhausted();
    // Every model, local ones included, is billed through the platform gateway's prepaid credit.
    const creditExhausted = credit?.exhausted === true;
    return models.map((model) => {
      const permitted = modelAllowedForUser(model.allowedRoles, auth.roles, model.permissions[0]?.allowed);
      const configured = externalProviderAllowed(model.provider, externalSwitch(), credentialFor(model.provider));
      const limited = isExternalProvider(model.provider) && budgetExhausted;
      const available = model.enabled && permitted && configured && !limited && !creditExhausted && reachable(model);
      // The composer offers images only for models that report vision, and no more than maxImages a chat.
      const maxImages = imageFiguresOf(model, routes)?.maxImages ?? null;
      return {
        id: model.id, displayName: model.displayName, provider: model.provider, providerModelId: model.providerModelId,
        enabled: model.enabled, permitted, available, local: model.local, contextWindow: model.contextWindow,
        capabilities: maxImages !== null ? model.capabilities : model.capabilities.filter((capability) => capability !== 'vision'),
        ...(maxImages !== null && { maxImages }),
        status: !model.enabled ? 'Disabled' : !permitted ? 'Not permitted' : !configured ? 'Not configured' : creditExhausted ? 'Credit exhausted' : limited ? 'Daily limit reached' : available ? 'Available' : 'Unavailable',
      };
    });
  }

  /** Every check a chat request must pass before anything is persisted or streamed. */
  async resolveForChat(userId: string, roles: string[], modelId: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId }, include: { permissions: { where: { userId } } },
    });
    if (!model || !model.enabled) throw new BadRequestException('Model is disabled or unknown');
    if (!model.capabilities.includes('chat')) throw new BadRequestException('This model cannot be used for chat');
    if (!modelAllowedForUser(model.allowedRoles, roles, model.permissions[0]?.allowed)) throw new ForbiddenException('Model is not allowed for this user');
    if (!externalProviderAllowed(model.provider, externalSwitch(), credentialFor(model.provider))) {
      throw new ForbiddenException('External provider is not explicitly enabled and configured');
    }
    if (isExternalProvider(model.provider) && await this.usage.externalBudgetExhausted()) {
      throw new HttpException('The daily external-provider limit for this installation has been reached. Local models remain available.', HttpStatus.TOO_MANY_REQUESTS);
    }
    if ((await this.gateway.credit())?.exhausted) throw gatewayError(HttpStatus.BAD_REQUEST, 'budget_exceeded');
    return model;
  }

  /**
   * How many images a chat may hold for this model and how many tokens each counts, or null when it
   * cannot receive them here. In a vendor-managed deployment the platform gateway's image limits for
   * this organization decide, and it counts what the platform reserves per image.
   */
  async imageFigures(model: { id: string; capabilities: string[] }) {
    // The gateway is asked only when its answer decides.
    const asks = vendorGateway() && mayReceiveImages(model);
    return imageFiguresOf(model, asks ? await this.gateway.routes() : new Map());
  }

  /** How many images a chat may hold for this model, or null when it cannot receive them here. */
  async imageLimit(model: { id: string; capabilities: string[] }) {
    return (await this.imageFigures(model))?.maxImages ?? null;
  }

  async adminList() {
    const models = await this.prisma.aIModel.findMany({ include: { pricing: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } }, orderBy: { displayName: 'asc' } });
    const { reachable } = await this.reachability(models);
    return models.map((model) => {
      const configured = externalProviderAllowed(model.provider, externalSwitch(), credentialFor(model.provider));
      const routed = reachable(model);
      return { ...model, configured, reachable: routed, status: !configured ? 'Not configured' : !routed ? 'Unavailable' : model.enabled ? 'Available' : 'Ready (disabled)' };
    });
  }

  async update(auth: AuthUser, id: string, data: { enabled?: boolean; allowedRoles?: string[] }) {
    const actor = await this.users.syncUser(auth);
    const before = await this.prisma.aIModel.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Model not found');
    if (isExternalProvider(before.provider) && data.enabled && !externalProviderAllowed(before.provider, externalSwitch(), credentialFor(before.provider))) throw new BadRequestException('External models require both ENABLE_EXTERNAL_PROVIDERS=true and valid provider credentials');
    if (vendorGateway() && data.enabled && !(await this.gateway.routes()).has(id)) throw new BadRequestException("This model is not included in your organization's plan on the platform gateway");
    const after = await this.prisma.aIModel.update({ where: { id }, data });
    await this.audit.record({ actorId: actor.id, action: 'MODEL_UPDATE', entityType: 'AIModel', entityId: id, before, after });
    return after;
  }

  /** One gateway route lookup per call; Ollama is asked only when an Ollama model is in scope. Neither reaches a paid provider. */
  private async reachability(models: Array<{ provider: Provider }>) {
    const [routes, ollama] = await Promise.all([
      models.length ? this.gateway.routes() : Promise.resolve(new Map<string, GatewayRoute>()),
      models.some((model) => model.provider === Provider.OLLAMA) ? this.ollamaModels() : Promise.resolve(new Set<string>()),
    ]);
    const reachable = (model: { id: string; provider: Provider; providerModelId: string }) =>
      routes.has(model.id) && (model.provider !== Provider.OLLAMA || ollama.has(model.providerModelId));
    return { reachable, routes };
  }

  private async ollamaModels() {
    try {
      const response = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(1200) });
      if (!response.ok) return new Set<string>();
      const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
      return new Set((payload.models || []).flatMap((model) => [model.name, model.model]).filter((name): name is string => Boolean(name)));
    } catch { return new Set<string>(); }
  }
}
