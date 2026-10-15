export const locales = ['th', 'en'] as const;

export type Locale = (typeof locales)[number];
