'use client';
import { Button, Card } from 'antd';
import { LoaderCircle, LockKeyhole } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';
import { useBrand } from '@/components/brand/brand-provider';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { useUIStore } from '@/stores/ui-store-provider';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const brand = useBrand();
  const locale = useLocale();
  const t = useTranslations('auth');
  const tCommon = useTranslations('common');
  const sessionExpired = useUIStore((state) => state.sessionExpired);
  const signIn = () =>
    auth.signinRedirect({
      // Back to this page after signing in; Keycloak shows its own pages in this language when the realm supports it.
      redirect_uri: `${window.location.origin}${window.location.pathname}`,
      ui_locales: locale,
    });
  // react-oidc-context also reports isLoading during a background token renewal (signinSilent);
  // that must not replace, and so remount, the page.
  const busy = auth.activeNavigator ? auth.activeNavigator !== 'signinSilent' : auth.isLoading;
  if (busy)
    return (
      <main className="grid min-h-dvh place-items-center">
        <LoaderCircle className="animate-spin text-primary" aria-label={tCommon('loading')} />
      </main>
    );
  // A failed background renewal must not hide a session that is still valid.
  if (auth.isAuthenticated) return children;
  if (auth.error && !sessionExpired && !['renewSilent', 'signinSilent'].includes(auth.error.source))
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card className="max-w-md shadow-sm" styles={{ body: { padding: 32 } }}>
          <h1 className="text-xl font-semibold">{t('signInFailed')}</h1>
          <p className="mt-2 text-sm text-error">{auth.error.message}</p>
          <Button type="primary" size="large" className="mt-5" onClick={signIn}>
            {t('tryAgain')}
          </Button>
        </Card>
      </main>
    );
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-layout p-6">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_srgb,var(--app-color-primary)_35%,transparent),transparent_35%),radial-gradient(circle_at_80%_70%,color-mix(in_srgb,var(--app-color-info)_20%,transparent),transparent_30%)]" />
      <div className="absolute top-[calc(1rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))]">
        <LanguageSwitcher compact />
      </div>
      <Card
        className="relative w-full max-w-md bg-surface/70 shadow-sm backdrop-blur-xl"
        styles={{ body: { padding: 36 } }}
      >
        <div className="mb-6 inline-flex rounded-brand-lg bg-primary p-3 text-on-primary">
          <LockKeyhole />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{brand.name}</h1>
        {sessionExpired && (
          <p role="status" className="mt-4 rounded-brand bg-warning-soft px-3 py-2 text-sm text-warning-text">
            {t('sessionExpired')}
          </p>
        )}
        <p className="mt-3 text-sm leading-6 text-fg-secondary">{t('intro')}</p>
        <Button type="primary" size="large" block className="mt-7" onClick={signIn}>
          {t('continue')}
        </Button>
        <p className="mt-4 text-center text-xs text-fg-tertiary">{t('noPaidProvider')}</p>
      </Card>
    </main>
  );
}
