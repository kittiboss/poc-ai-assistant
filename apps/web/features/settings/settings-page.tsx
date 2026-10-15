'use client';
import { KeyRound, Languages, Server, ShieldCheck, SlidersHorizontal, SunMoon, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';
import { useApi } from '@/lib/api';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Shell } from '@/components/layout/shell';
import { ThemeSwitcher } from '@/components/layout/theme-switcher';
import { Badge, Card } from '@/components/ui/primitives';

export function SettingsPage() {
  const auth = useAuth();
  const api = useApi();
  const t = useTranslations('settings');
  const tTheme = useTranslations('theme');
  const tLanguage = useTranslations('language');
  const profile = auth.user?.profile as {
    preferred_username?: string;
    email?: string;
    realm_access?: { roles?: string[] };
  };
  return (
    <Shell active="settings">
      <div className="mx-auto max-w-4xl space-y-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold">{t('title')}</h1>
        </div>
        <Card className="p-6">
          <div className="flex gap-3">
            <SlidersHorizontal className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">{t('preferences')}</h2>
              <p className="mt-1 text-sm text-fg-secondary">{t('preferencesNote')}</p>
              <div className="mt-4 divide-y divide-line-secondary">
                <Preference icon={<SunMoon size={17} />} label={tTheme('label')} note={t('themeNote')}>
                  <ThemeSwitcher />
                </Preference>
                <Preference icon={<Languages size={17} />} label={tLanguage('label')} note={t('languageNote')}>
                  <LanguageSwitcher />
                </Preference>
              </div>
            </div>
          </div>
        </Card>
        <div className="grid gap-5 md:grid-cols-2">
          <Card className="p-6">
            <User className="text-primary" />
            <h2 className="mt-4 font-semibold">{t('identity')}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label={t('username')} value={profile.preferred_username || '—'} />
              <Row label={t('email')} value={profile.email || '—'} />
              <Row
                label={t('roles')}
                value={(profile.realm_access?.roles || [])
                  .filter((role) => ['ADMIN', 'USER'].includes(role))
                  .join(', ')}
              />
            </dl>
          </Card>
          <Card className="p-6">
            <Server className="text-primary" />
            <h2 className="mt-4 font-semibold">{t('deployment')}</h2>
            <div className="mt-4 space-y-3 text-sm">
              <p>
                <Badge tone="success">{t('localByDefault')}</Badge>
              </p>
              <p className="text-fg-secondary">{t('routing')}</p>
              <p className="text-fg-secondary">{t('resources')}</p>
              <p>
                <a
                  className="font-medium text-primary underline"
                  href={`${api.apiBase}/docs`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('apiDocs')}
                </a>
              </p>
            </div>
          </Card>
        </div>
        <Card className="p-6">
          <div className="flex gap-3">
            <ShieldCheck className="shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold">{t('privacy')}</h2>
              <p className="mt-2 text-sm text-fg-secondary">{t('privacyBody')}</p>
            </div>
          </div>
          <div className="mt-5 flex gap-3">
            <KeyRound className="shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold">{t('session')}</h2>
              <p className="mt-2 text-sm text-fg-secondary">{t('sessionBody')}</p>
            </div>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
function Preference({
  icon,
  label,
  note,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-4 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <span className="mt-0.5 text-fg-secondary">{icon}</span>
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-xs text-fg-secondary">{note}</div>
        </div>
      </div>
      <div className="shrink-0 pl-8 sm:pl-0">{children}</div>
    </div>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-secondary">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
