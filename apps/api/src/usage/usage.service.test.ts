import { Provider, RequestStatus, UsageKind } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { basePrisma, localUser, usersWith } from '../testing/fixtures';
import { PricingService } from '../pricing/pricing.service';
import { UsageService } from './usage.service';

describe('usage tracking', () => {
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
    const service = new UsageService(prisma as never, usersWith(prisma), new PricingService(prisma as never, usersWith(prisma), {} as never));
    await service.record({
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
});
