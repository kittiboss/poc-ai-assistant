import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin } from '../testing/fixtures';
import { gateway, modelsService, prismaWith } from '../testing/model-fixtures';

describe('model availability and external provider guardrails', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows an external model as unavailable once the daily limit is reached, without touching local models', async () => {
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'true');
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    vi.stubEnv('EXTERNAL_DAILY_REQUEST_LIMIT', '10');
    const within = await modelsService(prismaWith({ requests: 9, tokens: 100 })).forUser(admin);
    expect(within.find((model) => model.id === 'google-gemini')).toMatchObject({ available: true, status: 'Available' });
    const limited = await modelsService(prismaWith({ requests: 10, tokens: 100 })).forUser(admin);
    expect(limited.find((model) => model.id === 'google-gemini')).toMatchObject({ available: false, status: 'Daily limit reached' });
    expect(limited.find((model) => model.id === 'local-mock')).toMatchObject({ available: true, status: 'Available' });
  });

  it('treats an API key alone as insufficient to use an external model', async () => {
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'false');
    vi.stubEnv('GEMINI_API_KEY', 'test-only');
    const listed = await modelsService(prismaWith({ requests: 0, tokens: 0 })).forUser(admin);
    expect(listed.find((model) => model.id === 'google-gemini')).toMatchObject({ available: false, status: 'Not configured' });
  });

  it('offers only chat-capable models for chat and refuses embedding-only models', async () => {
    const prisma = prismaWith({ requests: 0, tokens: 0 });
    await modelsService(prisma).forUser(admin);
    expect(prisma.aIModel.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { capabilities: { has: 'chat' } } }));
    prisma.aIModel.findUnique.mockResolvedValueOnce({ id: 'mock-embedding', provider: 'MOCK', enabled: true, local: true, allowedRoles: ['ADMIN', 'USER'], capabilities: ['embedding'], permissions: [] });
    await expect(modelsService(prisma).resolveForChat('user-1', ['USER'], 'mock-embedding')).rejects.toThrow('This model cannot be used for chat');
  });

  it('shows every model as out of credit, and refuses chat, once the prepaid credit is used up', async () => {
    vi.stubEnv('MODEL_ACCESS', 'vendor-gateway');
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'true');
    const spent = { currency: 'USD', limit: 5, spent: 5.01, remaining: 0, exhausted: true };
    gateway.credit.mockResolvedValueOnce(spent);
    const listed = await modelsService(prismaWith({ requests: 0, tokens: 0 })).forUser(admin);
    // Local models are billed through the gateway too.
    expect(listed.map((model) => [model.id, model.status, model.available])).toEqual([
      ['local-mock', 'Credit exhausted', false],
      ['google-gemini', 'Credit exhausted', false],
    ]);
    gateway.credit.mockResolvedValueOnce(spent);
    const error = await modelsService(prismaWith({ requests: 0, tokens: 0 })).resolveForChat('user-1', ['ADMIN'], 'google-gemini').catch((cause) => cause);
    expect(error.getStatus()).toBe(402);
    expect(error.getResponse()).toMatchObject({ code: 'CREDIT_EXHAUSTED' });
  });

  it("refuses to enable a model the platform gateway does not route for this organization", async () => {
    vi.stubEnv('MODEL_ACCESS', 'vendor-gateway');
    vi.stubEnv('ENABLE_EXTERNAL_PROVIDERS', 'true');
    const prisma = prismaWith({ requests: 0, tokens: 0 });
    prisma.aIModel.findUnique.mockResolvedValueOnce({ id: 'openai-gpt', provider: 'OPENAI', enabled: false });
    await expect(modelsService(prisma).update(admin, 'openai-gpt', { enabled: true })).rejects.toThrow(/not included in your organization's plan/);
  });
});
