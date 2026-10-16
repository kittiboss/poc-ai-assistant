import type en from '@/messages/en.json';
import type th from '@/messages/th.json';
import type { Locale } from './config';

// Type-checks translation keys and locale values across the app.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}

// Fails type checking when one language file has a key the other lacks.
type SameKeys<A extends B, B extends A> = [A, B];
export type MessagesInSync = SameKeys<typeof th, typeof en>;
