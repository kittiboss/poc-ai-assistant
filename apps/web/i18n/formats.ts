/** Shared Intl options, used with next-intl's useFormatter() so output follows the active locale. */
export const dateTimeFormat = { dateStyle: 'medium', timeStyle: 'medium' } as const;

/**
 * Costs are tiny amounts, so they keep more fraction digits than a normal currency value.
 * The narrow symbol keeps "$" in every locale (Thai would otherwise show the wider "US$").
 */
export const costFormat = (
  currency: string,
  minimumFractionDigits: number,
  maximumFractionDigits = minimumFractionDigits,
) =>
  ({
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits,
    maximumFractionDigits,
  }) as const;
