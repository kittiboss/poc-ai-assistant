const SCALE = 1_000_000_000n;

/**
 * A USD amount in billionths, exactly as vendor-control keeps it. Accepts its 9-decimal strings and
 * the numbers of the credit summary.
 */
export function nanoUsd(value: string | number): bigint {
  const text = typeof value === 'number' ? value.toFixed(9) : value.trim();
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^[-+]/, '').split('.');
  const amount = BigInt(whole || '0') * SCALE + BigInt(fraction.padEnd(9, '0').slice(0, 9));
  return negative ? -amount : amount;
}

/**
 * `$3.97413807`, `$0.0000012`, `$2.00`: exact to the billionth, without trailing zeros, so the tiny
 * charges of a single request stay readable. `sign` puts a + before credit added.
 */
export function formatUsd(value: string | number | bigint, { sign = false } = {}): string {
  const amount = typeof value === 'bigint' ? value : nanoUsd(value);
  const size = amount < 0n ? -amount : amount;
  const fraction = (size % SCALE).toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  const prefix = amount < 0n ? '−' : sign && amount > 0n ? '+' : '';
  return `${prefix}$${(size / SCALE).toLocaleString('en-US')}.${fraction}`;
}

export const formatNumber = (value: number | string) => Number(value).toLocaleString('en-US');

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const dateTimeSeconds = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });

/** `9 Nov 2026, 14:05` in the viewer's time zone; `seconds` for ledger rows that happen close together. */
export const formatDateTime = (value: string | Date, { seconds = false } = {}) =>
  (seconds ? dateTimeSeconds : dateTime).format(new Date(value));

/** Bytes as MB with two decimals, as the knowledge limits are set in MB. */
export const formatMb = (bytes: number) => (bytes / 1_048_576).toFixed(2);
