import { describe, expect, it } from 'vitest';
import { credentialFor, externalProviderAllowed, modelAllowedForUser } from './model-policies';

describe('provider and model authorization policy', () => {
  it('requires both the external switch and credentials', () => {
    expect(externalProviderAllowed('OPENAI', false, 'secret')).toBe(false);
    expect(externalProviderAllowed('OPENAI', true, '')).toBe(false);
    expect(externalProviderAllowed('OPENAI', true, 'secret')).toBe(true);
    expect(externalProviderAllowed('MOCK', false)).toBe(true);
  });
  it('reads each provider credential from its own variable and treats local providers as credential-free', () => {
    const env = { OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' };
    expect([credentialFor('OPENAI', env), credentialFor('ANTHROPIC', env), credentialFor('GEMINI', env)]).toEqual(['o', 'a', 'g']);
    expect(credentialFor('MOCK', {})).toBe('local');
  });
  it('honors explicit user permissions over role defaults', () => {
    expect(modelAllowedForUser(['USER'], ['USER'])).toBe(true);
    expect(modelAllowedForUser(['USER'], ['USER'], false)).toBe(false);
    expect(modelAllowedForUser(['ADMIN'], ['USER'], true)).toBe(true);
  });
});
