import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Provider, RequestStatus, UsageKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AppService } from './app.service';

const auth = { sub: 'kc-user-1', username: 'employee1', roles: ['USER'] };
const localUser = { id: '00000000-0000-0000-0000-000000000001', externalId: auth.sub, username: auth.username };

function basePrisma() {
  return {
    user: { upsert: vi.fn().mockResolvedValue(localUser) },
    role: { findMany: vi.fn().mockResolvedValue([]) },
    userRole: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
  };
}

describe('application persistence and authorization', () => {
  it('scopes conversation reads to the authenticated Keycloak subject', async () => {
    const prisma = { ...basePrisma(), conversation: { findFirst: vi.fn().mockResolvedValue(null) } };
    const service = new AppService(prisma as never, {} as never);
    await expect(service.conversation(auth, '10000000-0000-0000-0000-000000000001')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: expect.any(String), userId: localUser.id, deletedAt: null } }));
  });

  it('persists chats and soft-deletes them so historical usage remains referentially intact', async () => {
    const created = { id: 'conversation-1', userId: localUser.id, title: 'Saved chat' };
    const prisma = { ...basePrisma(), conversation: {
      create: vi.fn().mockResolvedValue(created),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    } };
    const service = new AppService(prisma as never, {} as never);
    await expect(service.createConversation(auth, 'Saved chat')).resolves.toEqual(created);
    await service.deleteConversation(auth, created.id);
    expect(prisma.conversation.create).toHaveBeenCalledWith({ data: { userId: localUser.id, title: 'Saved chat' } });
    expect(prisma.conversation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { deletedAt: expect.any(Date) } }));
  });

  it('writes one synthetic, zero-actual-cost usage snapshot keyed by request ID', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = { ...basePrisma(),
      pricingVersion: { findFirst: vi.fn().mockResolvedValue({
        id: 'price-v1', version: 1, strategy: 'SIMULATION', providerInputRate: 0, providerOutputRate: 0,
        cachedInputRate: null, additionalFee: 0, customerInputRate: 0, customerOutputRate: 0,
        markupPercent: 50, simulationInputRate: 2.5, simulationOutputRate: 3.571428571428, currency: 'USD',
      }) },
      usageRecord: { upsert },
    };
    const service = new AppService(prisma as never, {} as never);
    await (service as unknown as { recordUsage(args: unknown): Promise<void> }).recordUsage({
      requestId: 'request-unique', userId: localUser.id, conversationId: 'conversation-1',
      model: { id: 'local-mock', provider: Provider.MOCK, local: true }, input: 'Explain Docker Compose',
      output: 'This is a mock AI response for local POC testing.', durationMs: 42,
      status: RequestStatus.COMPLETED, usage: { prompt_tokens: 5, completion_tokens: 12 },
    });
    const call = upsert.mock.calls[0][0];
    expect(call.where).toEqual({ requestId: 'request-unique' });
    expect(call.create.usageKind).toBe(UsageKind.SYNTHETIC);
    expect(call.create.actualProviderCost).toBe('0.000000000000');
    expect(call.create.pricingVersionId).toBe('price-v1');
    expect(call.create.pricingSnapshot.version).toBe(1);
  });

  it('creates a new pricing version and rejects actual external cost for local models', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'v2', version: 2 });
    const pricing = { id: 'pricing-1', versions: [{ id: 'v1', version: 1 }] };
    const prisma = { ...basePrisma(),
      aIModel: { findUnique: vi.fn().mockResolvedValue({ id: 'local-mock', local: true, pricing }) },
      pricingVersion: { create }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new AppService(prisma as never, {} as never);
    const zero = { strategy: 'SIMULATION' as const, providerInputRate: '0', providerOutputRate: '0', currency: 'USD' };
    await service.updatePricing(auth, 'local-mock', zero);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }));
    await expect(service.updatePricing(auth, 'local-mock', { ...zero, providerInputRate: '0.01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

