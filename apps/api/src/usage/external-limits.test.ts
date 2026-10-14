import { describe, expect, it } from 'vitest';
import { externalBudgetExhausted, externalDailyLimits, startOfUtcDay } from './external-limits';

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
