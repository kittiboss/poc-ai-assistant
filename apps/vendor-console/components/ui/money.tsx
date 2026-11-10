'use client';

import { Input, type FormRule, type InputProps } from 'antd';
import { formatUsd, nanoUsd } from '@/lib/format';
import { USD_AMOUNT } from '@/lib/limits';

/** A USD amount typed as text, so it reaches vendor-control exactly as written. */
export function MoneyInput(props: InputProps) {
  return <Input prefix="$" inputMode="decimal" autoComplete="off" spellCheck={false} {...props} />;
}

/**
 * Rules for a MoneyInput: a decimal with at most 9 places (what vendor-control accepts), more than $0
 * when `positive`, and at most `max`. `name` is the field as it reads in a sentence.
 */
export function moneyRules({
  name,
  positive = false,
  max,
  required = true,
}: {
  name: string;
  positive?: boolean;
  max?: number;
  required?: boolean;
}): FormRule[] {
  return [
    { required, message: `Enter ${name}` },
    {
      validator: async (_, value?: string) => {
        const text = value?.trim();
        if (!text) return;
        if (!USD_AMOUNT.test(text)) throw new Error('Use a number like 2 or 0.15, with at most 9 decimal places');
        const amount = nanoUsd(text);
        if (positive && amount <= 0n) throw new Error(`${capitalize(name)} must be more than $0`);
        if (max !== undefined && amount > nanoUsd(max))
          throw new Error(`${capitalize(name)} can be at most ${formatUsd(max)}`);
      },
    },
  ];
}

const capitalize = (text: string) => text.replace(/^(the|an?) /, '').replace(/^./, (c) => c.toUpperCase());

/** `2.500000000` → `2.5`: a stored amount as a form starts from it. */
export const plainUsd = (value: string) => value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
