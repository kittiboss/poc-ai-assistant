'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Shell } from '@/components/layout/shell';
import { cn } from '@/lib/cn';

const tabs = [
  { key: 'overview', href: '/admin' },
  { key: 'models', href: '/admin/models' },
  { key: 'workspace', href: '/admin/workspace' },
  { key: 'activity', href: '/admin/activity' },
] as const;

/**
 * The admin console, one tab per part with its own URL. Only the overview has filters, so a filter
 * never looks like it should change a setting.
 */
export function AdminLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('admin');
  const pathname = usePathname();
  return (
    <Shell active="admin">
      <div className="mx-auto max-w-7xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-8">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-sm text-fg-secondary">{t('intro')}</p>
        {/* Scrolls sideways on a narrow phone instead of wrapping. */}
        <nav aria-label={t('tabs.label')} className="-mx-4 mt-5 overflow-x-auto px-4 md:mx-0 md:px-0">
          <div className="flex min-w-max gap-6 border-b border-line-secondary">
            {tabs.map((tab) => {
              const current = pathname === tab.href;
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  aria-current={current ? 'page' : undefined}
                  className={cn(
                    '-mb-px border-b-2 py-3 text-sm whitespace-nowrap transition',
                    current
                      ? 'border-primary font-medium text-primary'
                      : 'border-transparent text-fg-secondary hover:text-fg',
                  )}
                >
                  {t(`tabs.${tab.key}`)}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="mt-6 space-y-7">{children}</div>
      </div>
    </Shell>
  );
}
