import { afterEach, describe, expect, it, vi } from 'vitest';
import { admin } from '../testing/fixtures';
import { modelsService, prismaWith } from '../testing/model-fixtures';

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
});
