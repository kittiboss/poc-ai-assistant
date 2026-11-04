import { StreamableFile } from '@nestjs/common';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { customerResponse } from './vendor-response.interceptor';
describe('vendor/customer response boundary', () => {
  it('strips cost/margin data recursively, including audit and usage snapshots', () => {
    const response = customerResponse({ records: [{ actualProviderCost: '1', simulatedProviderCost: '2', pricingSnapshot: { secret: true }, totalTokens: 10, simulatedCustomerCharge: '3' }], audit: { before: { markupPercent: '50', providerInputRate: '2', customerInputRate: '3' } } });
    expect(response).toEqual({ records: [{ totalTokens: 10, simulatedCustomerCharge: '3' }], audit: { before: { customerInputRate: '3' } } });
  });

  it('passes a file through unchanged, such as a chat image', () => {
    const file = new StreamableFile(Readable.from([Buffer.from('image bytes')]), { type: 'image/png' });
    expect(customerResponse(file)).toBe(file);
  });
});
