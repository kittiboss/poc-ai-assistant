import { BadRequestException, ForbiddenException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/auth/auth.decorators';
import { PrismaService } from '../common/prisma/prisma.service';
import { GatewayService } from '../gateway/gateway.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import { credentialFor, externalProviderAllowed, isExternalProvider, modelAllowedForUser } from './model-policies';

const externalSwitch = () => process.env.ENABLE_EXTERNAL_PROVIDERS === 'true';

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
    const models = await this.prisma.aIModel.findMany({
      include: { permissions: { where: { userId: user.id } } },
      orderBy: [{ local: 'desc' }, { displayName: 'asc' }],
    });
    const reachable = await this.reachability(models.filter((model) => model.enabled));
    const budgetExhausted = models.some((model) => model.enabled && isExternalProvider(model.provider)) && await this.usage.externalBudgetExhausted();
    return models.map((model) => {
      const permitted = modelAllowedForUser(model.allowedRoles, auth.roles, model.permissions[0]?.allowed);
      const configured = externalProviderAllowed(model.provider, externalSwitch(), credentialFor(model.provider));
      const limited = isExternalProvider(model.provider) && budgetExhausted;
      const available = model.enabled && permitted && configured && !limited && reachable(model);
      return {
        id: model.id, displayName: model.displayName, provider: model.provider, providerModelId: model.providerModelId,
        enabled: model.enabled, permitted, available, local: model.local, contextWindow: model.contextWindow,
        capabilities: model.capabilities,
        status: !model.enabled ? 'Disabled' : !permitted ? 'Not permitted' : !configured ? 'Not configured' : limited ? 'Daily limit reached' : available ? 'Available' : 'Unavailable',
      };
    });
  }

  /** Every check a chat request must pass before anything is persisted or streamed. */
  async resolveForChat(userId: string, roles: string[], modelId: string) {
    const model = await this.prisma.aIModel.findUnique({
      where: { id: modelId }, include: { permissions: { where: { userId } } },
    });
    if (!model || !model.enabled) throw new BadRequestException('Model is disabled or unknown');
    if (!modelAllowedForUser(model.allowedRoles, roles, model.permissions[0]?.allowed)) throw new ForbiddenException('Model is not allowed for this user');
    if (!externalProviderAllowed(model.provider, externalSwitch(), credentialFor(model.provider))) {
      throw new ForbiddenException('External provider is not explicitly enabled and configured');
    }
    if (isExternalProvider(model.provider) && await this.usage.externalBudgetExhausted()) {
      throw new HttpException('The daily external-provider limit for this installation has been reached. Local models remain available.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return model;
  }

  async adminList() {
    const models = await this.prisma.aIModel.findMany({ include: { pricing: { include: { versions: { orderBy: { version: 'desc' }, take: 1 } } } }, orderBy: { displayName: 'asc' } });
    const reachable = await this.reachability(models);
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
    const after = await this.prisma.aIModel.update({ where: { id }, data });
    await this.audit.record({ actorId: actor.id, action: 'MODEL_UPDATE', entityType: 'AIModel', entityId: id, before, after });
    return after;
  }

  /** One gateway route lookup per call; Ollama is asked only when an Ollama model is in scope. Neither reaches a paid provider. */
  private async reachability(models: Array<{ provider: Provider }>) {
    const [routes, ollama] = await Promise.all([
      models.length ? this.gateway.routes() : Promise.resolve(new Set<string>()),
      models.some((model) => model.provider === Provider.OLLAMA) ? this.ollamaModels() : Promise.resolve(new Set<string>()),
    ]);
    return (model: { id: string; provider: Provider; providerModelId: string }) =>
      routes.has(model.id) && (model.provider !== Provider.OLLAMA || ollama.has(model.providerModelId));
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
