import { describe, expect, it } from 'vitest';
import { externalBudgetExhausted, externalDailyLimits, externalProviderAllowed, modelAllowedForUser, startOfUtcDay, toGatewayHistory } from './policies';

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


describe('external provider cost guardrails', () => {
  it('parses daily limits conservatively', () => {
    expect(externalDailyLimits({})).toEqual({ requests: 100, tokens: 100_000 });
    expect(externalDailyLimits({ EXTERNAL_DAILY_REQUEST_LIMIT: '0', EXTERNAL_DAILY_TOKEN_LIMIT: '5000' })).toEqual({ requests: 0, tokens: 5000 });
    expect(externalDailyLimits({ EXTERNAL_DAILY_REQUEST_LIMIT: '-1', EXTERNAL_DAILY_TOKEN_LIMIT: 'lots' })).toEqual({ requests: 100, tokens: 100_000 });
  });

  it('blocks once either the request or token ceiling is reached, and 0 blocks everything', () => {
    expect(externalBudgetExhausted({ requests: 99, tokens: 10 }, { requests: 100, tokens: 1000 })).toBe(false);
    expect(externalBudgetExhausted({ requests: 100, tokens: 10 }, { requests: 100, tokens: 1000 })).toBe(true);
    expect(externalBudgetExhausted({ requests: 1, tokens: 1000 }, { requests: 100, tokens: 1000 })).toBe(true);
    expect(externalBudgetExhausted({ requests: 0, tokens: 0 }, { requests: 0, tokens: 1000 })).toBe(true);
  });

  it('resets the daily window at UTC midnight', () => {
    expect(startOfUtcDay(new Date('2026-10-14T23:59:59+07:00')).toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });
});

describe('gateway history', () => {
  it('never replays failed or empty turns to a provider', () => {
    expect(toGatewayHistory([
      { role: 'USER', content: 'first', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: '', status: 'ERROR' },
      { role: 'ASSISTANT', content: 'partial', status: 'ERROR' },
      { role: 'USER', content: 'again', status: 'COMPLETED' },
      { role: 'ASSISTANT', content: 'half an answer', status: 'INTERRUPTED' },
      { role: 'ASSISTANT', content: '  ', status: 'INTERRUPTED' },
      { role: 'USER', content: 'next', status: 'COMPLETED' },
    ])).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'again' },
      { role: 'assistant', content: 'half an answer' },
      { role: 'user', content: 'next' },
    ]);
  });
});
