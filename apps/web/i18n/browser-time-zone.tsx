'use client';

import { NextIntlClientProvider, useLocale, useMessages, useTimeZone } from 'next-intl';
import { useSyncExternalStore, type ReactNode } from 'react';

const subscribe = () => () => {};
const getBrowserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * Dates and times follow each user's device. The server can't know that time zone, so the server
 * one is kept for hydration and the browser's takes over right after; no dates render before login.
 */
export function BrowserTimeZone({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const messages = useMessages();
  const serverTimeZone = useTimeZone();
  const timeZone = useSyncExternalStore(subscribe, getBrowserTimeZone, () => serverTimeZone);
  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
      {children}
    </NextIntlClientProvider>
  );
}
