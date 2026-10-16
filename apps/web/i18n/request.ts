import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { getBrand } from '@/config/brands';
import { isLocale, LOCALE_COOKIE } from './config';

// No time zone here on purpose: dates follow each user's device (see browser-time-zone.tsx).
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : getBrand().defaultLocale;
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
