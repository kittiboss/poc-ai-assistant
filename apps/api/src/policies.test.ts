import { describe, expect, it } from 'vitest';
import { externalProviderAllowed, modelAllowedForUser } from './policies';

describe('provider and model authorization policy', () => {
  it('requires both the external switch and credentials', () => {
    expect(externalProviderAllowed('OPENAI', false, 'secret')).toBe(false);
    expect(externalProviderAllowed('OPENAI', true, '')).toBe(false);
    expect(externalProviderAllowed('OPENAI', true, 'secret')).toBe(true);
    expect(externalProviderAllowed('MOCK', false)).toBe(true);
  });
  it('honors explicit user permissions over role defaults', () => {
    expect(modelAllowedForUser(['USER'], ['USER'])).toBe(true);
    expect(modelAllowedForUser(['USER'], ['USER'], false)).toBe(false);
    expect(modelAllowedForUser(['ADMIN'], ['USER'], true)).toBe(true);
  });
});

