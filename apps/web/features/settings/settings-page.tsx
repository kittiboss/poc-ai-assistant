'use client';
import { Card } from 'antd';
import { KeyRound, Languages, Server, ShieldCheck, SlidersHorizontal, SunMoon, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';
import { apiUrl } from '@/lib/api/client';
import { useRoles } from '@/lib/auth/use-roles';
import { LanguageSwitcher } from '@/components/layout/language-switcher';
import { Shell } from '@/components/layout/shell';
import { StatusTag } from '@/components/ui/status-tag';
import { ThemeSwitcher } from '@/components/layout/theme-switcher';

// Matches the padding of the original cards; AntD's default body padding is smaller.
const cardStyles = { body: { padding: 24 } };

export function SettingsPage() {
  const auth = useAuth();
  const roles = useRoles();
  const t = useTranslations('settings');
  const tTheme = useTranslations('theme');
  const tLanguage = useTranslations('language');
  const profile = auth.user?.profile;
  return (
    <Shell active="settings">
      <div className="mx-auto max-w-4xl space-y-6 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <div>
          <p className="text-sm font-medium text-primary">{t('eyebrow')}</p>
          <h1 className="mt-1 text-3xl font-semibold">{t('title')}</h1>
        </div>
        <Card className="shadow-sm" styles={cardStyles}>
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
          <Card className="shadow-sm" styles={cardStyles}>
            <User className="text-primary" />
            <h2 className="mt-4 font-semibold">{t('identity')}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Row label={t('username')} value={profile?.preferred_username || '—'} />
              <Row label={t('email')} value={profile?.email || '—'} />
              <Row label={t('roles')} value={roles.filter((role) => ['ADMIN', 'USER'].includes(role)).join(', ')} />
            </dl>
          </Card>
          <Card className="shadow-sm" styles={cardStyles}>
            <Server className="text-primary" />
            <h2 className="mt-4 font-semibold">{t('deployment')}</h2>
            <div className="mt-4 space-y-3 text-sm">
              <p>
                <StatusTag tone="success">{t('localByDefault')}</StatusTag>
              </p>
              <p className="text-fg-secondary">{t('routing')}</p>
              <p className="text-fg-secondary">{t('resources')}</p>
              <p>
                <a
                  className="font-medium text-primary underline"
                  href={`${apiUrl()}/docs`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('apiDocs')}
                </a>
              </p>
            </div>
          </Card>
        </div>
        <Card className="shadow-sm" styles={cardStyles}>
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
