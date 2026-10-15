export const locales = ['th', 'en'] as const;

export type Locale = (typeof locales)[number];

/** The user's language; the app sits behind a login, so it lives in a cookie instead of the URL. */
export const LOCALE_COOKIE = 'NEXT_LOCALE';

/** Language names are always shown in their own language. */
export const localeLabels: Record<Locale, string> = {
  th: 'ไทย',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
