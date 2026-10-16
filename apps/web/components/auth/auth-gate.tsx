'use client';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';
import { useBrand } from '@/components/brand/brand-provider';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Button, Card } from '@/components/ui/primitives';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const brand = useBrand();
  const locale = useLocale();
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  // Asks Keycloak to show its own pages in the same language when the realm supports it.
  const signIn = () => auth.signinRedirect({ ui_locales: locale });
  if (auth.isLoading || auth.activeNavigator)
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoaderCircle className="animate-spin text-primary" aria-label={tCommon('loading')} />
      </main>
    );
  if (auth.error)
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="max-w-md p-8">
          <h1 className="text-xl font-semibold">{t('signInFailed')}</h1>
          <p className="mt-2 text-sm text-error">{auth.error.message}</p>
          <Button className="mt-5" onClick={signIn}>
            {t('tryAgain')}
          </Button>
        </Card>
      </main>
    );
  if (!auth.isAuthenticated)
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-layout p-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--app-color-primary)_35%,transparent),transparent_35%),radial-gradient(circle_at_80%_70%,color-mix(in_srgb,var(--app-color-info)_20%,transparent),transparent_30%)]" />
        <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))]">
          <LanguageSwitcher compact />
        </div>
        <Card className="relative w-full max-w-md bg-surface/70 p-9 backdrop-blur-xl">
          <div className="mb-6 inline-flex rounded-brand-lg bg-primary p-3 text-on-primary">
            <LockKeyhole />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{brand.name}</h1>
          <p className="mt-3 text-sm leading-6 text-fg-secondary">{t('intro')}</p>
          <Button className="mt-7 w-full" onClick={signIn}>
            {t('continue')}
          </Button>
          <p className="mt-4 text-center text-xs text-fg-tertiary">{t('noPaidProvider')}</p>
        </Card>
      </main>
    );
  return children;
}
