import { describe, expect, it } from 'vitest';
import { calculatePrice, estimateTokens } from './index';

describe('pricing', () => {
  it('uses decimal-safe percentage markup', () => {
    const result = calculatePrice({
      inputTokens: 3000,
      outputTokens: 700,
      providerInputPerMillion: '2.5',
      providerOutputPerMillion: '3.571428571428',
      markupPercent: '50',
      strategy: 'PERCENTAGE_MARKUP',
    });
    expect(result.actualProviderCost).toBe('0.010000000000');
    expect(result.customerCharge).toBe('0.015000000000');
  });

  it('keeps simulation separate from actual cost and charge', () => {
    const result = calculatePrice({
      inputTokens: 3000,
      outputTokens: 700,
      providerInputPerMillion: '0',
      providerOutputPerMillion: '0',
      simulatedProviderCost: '0.01',
      markupPercent: '50',
      strategy: 'SIMULATION',
    });
    expect(result.actualProviderCost).toBe('0.000000000000');
    expect(result.customerCharge).toBe('0.000000000000');
    expect(result.simulatedCustomerCharge).toBe('0.015000000000');
  });

  it('estimates tokens deterministically', () => expect(estimateTokens('12345')).toBe(2));
});

