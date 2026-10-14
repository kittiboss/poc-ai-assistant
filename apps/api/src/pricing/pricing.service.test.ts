import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { auth, basePrisma, usersWith } from '../testing/fixtures';
import { AuditService } from '../audit/audit.service';
import { PricingService } from './pricing.service';

describe('pricing versions', () => {
  it('creates a new pricing version and rejects actual external cost for local models', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'v2', version: 2 });
    const pricing = { id: 'pricing-1', versions: [{ id: 'v1', version: 1 }] };
    const prisma = { ...basePrisma(),
      aIModel: { findUnique: vi.fn().mockResolvedValue({ id: 'local-mock', local: true, pricing }) },
      pricingVersion: { create }, auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new PricingService(prisma as never, usersWith(prisma), new AuditService(prisma as never));
    const zero = { strategy: 'SIMULATION' as const, providerInputRate: '0', providerOutputRate: '0', currency: 'USD' };
    await service.createVersion(auth, 'local-mock', zero);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PRICING_VERSION_CREATE', entityId: 'pricing-1' }) });
    await expect(service.createVersion(auth, 'local-mock', { ...zero, providerInputRate: '0.01' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
