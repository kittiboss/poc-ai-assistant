import Big from 'big.js';

export type Role = 'ADMIN' | 'USER';
export type Provider = 'MOCK' | 'OLLAMA' | 'OPENAI' | 'ANTHROPIC' | 'GEMINI';
export type PricingStrategy = 'PASS_THROUGH' | 'PERCENTAGE_MARKUP' | 'FIXED_RATE' | 'SIMULATION';
export type UsageKind = 'ACTUAL' | 'ESTIMATED' | 'SYNTHETIC';

export interface PriceInput {
  inputTokens: number;
  outputTokens: number;
  providerInputPerMillion: string;
  providerOutputPerMillion: string;
  additionalProviderFee?: string;
  fixedInputPerMillion?: string;
  fixedOutputPerMillion?: string;
  markupPercent?: string;
  strategy: PricingStrategy;
  simulatedProviderCost?: string;
}

export interface PriceResult {
  actualProviderCost: string;
  customerCharge: string;
  simulatedProviderCost: string;
  simulatedCustomerCharge: string;
  grossMargin: string;
}

const MILLION = new Big(1_000_000);
const money = (value: Big) => value.round(12, Big.roundHalfUp).toFixed(12);

/** Decimal-safe pricing. All rates are currency units per one million tokens. */
export function calculatePrice(input: PriceInput): PriceResult {
  const provider = new Big(input.inputTokens)
    .times(input.providerInputPerMillion || '0')
    .plus(new Big(input.outputTokens).times(input.providerOutputPerMillion || '0'))
    .div(MILLION)
    .plus(input.additionalProviderFee || '0');
  const markup = new Big(input.markupPercent || '0').div(100);
  let customer = provider;
  let simulatedProvider = new Big(0);
  let simulatedCustomer = new Big(0);

  if (input.strategy === 'PERCENTAGE_MARKUP') customer = provider.times(new Big(1).plus(markup));
  if (input.strategy === 'FIXED_RATE') {
    customer = new Big(input.inputTokens)
      .times(input.fixedInputPerMillion || '0')
      .plus(new Big(input.outputTokens).times(input.fixedOutputPerMillion || '0'))
      .div(MILLION);
  }
  if (input.strategy === 'SIMULATION') {
    customer = new Big(0);
    simulatedProvider = new Big(input.simulatedProviderCost || provider.toString());
    simulatedCustomer = simulatedProvider.times(new Big(1).plus(markup));
  }

  return {
    actualProviderCost: money(provider),
    customerCharge: money(customer),
    simulatedProviderCost: money(simulatedProvider),
    simulatedCustomerCharge: money(simulatedCustomer),
    grossMargin: money(customer.minus(provider)),
  };
}

/** Deliberately transparent estimate for providers that omit tokenizer metadata. */
export function estimateTokens(text: string): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export * from './workspace';
