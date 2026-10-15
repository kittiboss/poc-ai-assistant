'use client';
import { Segmented } from 'antd';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { LOCALE_COOKIE, localeLabels, locales, type Locale } from '@/i18n/config';
import { setCookie } from '@/lib/cookies';

/** `compact` shows TH / EN, for tight spots such as the sign-in screen. */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useTranslations('language');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const changeLocale = (next: Locale) => {
    setCookie(LOCALE_COOKIE, next);
    // Re-renders the root layout with the new messages and <html lang>, keeping client state.
    startTransition(() => router.refresh());
  };

  return (
    <Segmented<Locale>
      aria-label={t('label')}
      value={locale}
      onChange={changeLocale}
      disabled={isPending}
      options={locales.map((value) => ({
        value,
        label: compact ? value.toUpperCase() : localeLabels[value],
        title: localeLabels[value],
      }))}
    />
  );
}
