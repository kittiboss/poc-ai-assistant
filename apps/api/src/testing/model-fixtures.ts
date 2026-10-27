import { Provider } from '@prisma/client';
import { vi } from 'vitest';
import { ModelsService } from '../models/models.service';
import { UsageService } from '../usage/usage.service';
import { basePrisma, usersWith } from './fixtures';

/** A local mock and an external Gemini model, both enabled and routed by the gateway. */
export const models = [
  { id: 'local-mock', displayName: 'Local Mock', provider: Provider.MOCK, providerModelId: 'mock-enterprise', enabled: true, allowedRoles: ['ADMIN', 'USER'], local: true, contextWindow: 8192, capabilities: ['chat', 'streaming'], permissions: [] },
  { id: 'google-gemini', displayName: 'Gemini', provider: Provider.GEMINI, providerModelId: 'gemini-3.5-flash-lite', enabled: true, allowedRoles: ['ADMIN'], local: false, contextWindow: 1048576, capabilities: ['chat', 'streaming'], permissions: [] },
];
// credit() is null: the dev stack's gateway sets no prepaid budget.
export const gateway = { routes: vi.fn().mockResolvedValue(new Set(['local-mock', 'google-gemini'])), credit: vi.fn().mockResolvedValue(null) };
export const prismaWith = (used: { requests: number; tokens: number }) => ({ ...basePrisma(),
  aIModel: { findMany: vi.fn().mockResolvedValue(models), findUnique: vi.fn().mockResolvedValue(models[1]) },
  usageRecord: { aggregate: vi.fn().mockResolvedValue({ _count: used.requests, _sum: { totalTokens: used.tokens } }) },
});
export const modelsService = (prisma: ReturnType<typeof prismaWith>) =>
  new ModelsService(prisma as never, usersWith(prisma), gateway as never, new UsageService(prisma as never, usersWith(prisma), {} as never), {} as never);
