'use client';

import { useFormatter } from 'next-intl';
import { costFormat, dateTimeFormat } from '@/i18n/formats';

/** Number and date formats shared by the admin sections, in the active locale. */
export function useAdminFormat() {
  const format = useFormatter();
  return {
    money: (value: unknown) => format.number(Number(value || 0), costFormat('USD', 6)),
    number: (value: unknown) => format.number(Number(value || 0)),
    percent: (value: string) => format.number(Number(value) / 100, { style: 'percent', maximumFractionDigits: 6 }),
    dateTime: (value: string) => format.dateTime(new Date(value), dateTimeFormat),
    // Daily buckets are UTC dates; formatting them in UTC keeps each bar on its own day.
    day: (value: string) => format.dateTime(new Date(value), { month: 'short', day: 'numeric', timeZone: 'UTC' }),
  };
}
