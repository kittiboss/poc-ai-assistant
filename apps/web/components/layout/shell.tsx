'use client';
import { Drawer, Grid } from 'antd';
import Link from 'next/link';
import { BarChart3, Bot, Gauge, LogOut, Menu, Settings, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from 'react-oidc-context';
import { BrandLogo } from '@/components/brand/brand-logo';
import { useBrand } from '@/components/brand/brand-provider';
import { useRoles } from '@/lib/auth/use-roles';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';

type Section = 'chat' | 'usage' | 'live-usage' | 'admin' | 'settings';

/** Same width as the desktop sidebar (w-72). */
const DRAWER_WIDTH = 288;

/**
 * md and up: the sidebar sits beside the page. Below md: the same sidebar opens in a drawer from
 * the menu button in the header. Pages without their own `header` only get the header on small screens.
 */
export function Shell({
  children,
  active,
  sidebar,
  header,
}: {
  children: React.ReactNode;
  active: Section;
  sidebar?: React.ReactNode;
  header?: React.ReactNode;
}) {
  const mobileNavOpen = useUIStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUIStore((state) => state.setMobileNavOpen);
  const screens = Grid.useBreakpoint();
  const t = useTranslations('nav');
  const navigation = <Navigation active={active} sidebar={sidebar} onNavigate={() => setMobileNavOpen(false)} />;

  return (
    <div className="flex h-dvh overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line-secondary bg-sider md:flex">
        {navigation}
      </aside>
      <Drawer
        placement="left"
        size={DRAWER_WIDTH}
        // Closes by itself if the window grows to the desktop layout.
        open={mobileNavOpen && !screens.md}
        onClose={() => setMobileNavOpen(false)}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <div className="flex h-full flex-col bg-sider pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          {navigation}
        </div>
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={cn('shrink-0 bg-header pt-[env(safe-area-inset-top)]', !header && 'md:hidden')}>
          {/* The border sits inside the fixed height so it lines up with the sidebar's top block. */}
          <div className="flex h-14 items-center gap-2 border-b border-line-secondary px-3 md:h-16 md:px-6">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('openMenu')}
              className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-brand text-fg-secondary hover:bg-fill-tertiary md:hidden"
            >
              <Menu size={20} />
            </button>
            {header ?? <BrandTitle />}
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function BrandTitle() {
  const brand = useBrand();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <BrandLogo size={28} decorative />
      <span className="truncate font-semibold">{brand.name}</span>
    </div>
  );
}

function Navigation({
  active,
  sidebar,
  onNavigate,
}: {
  active: Section;
  sidebar?: React.ReactNode;
  onNavigate: () => void;
}) {
  const auth = useAuth();
  const brand = useBrand();
  const t = useTranslations('nav');
  const roles = useRoles();
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line-secondary px-5">
        <BrandLogo size={36} decorative />
        <div className="min-w-0">
          <div className="truncate font-semibold">{brand.name}</div>
          <div className="text-[11px] text-fg-secondary">{t('tagline')}</div>
        </div>
      </div>
      {sidebar || <div className="flex-1" />}
      <nav className="space-y-1 border-t border-line-secondary p-3">
        <Nav href="/" icon={<Bot size={17} />} selected={active === 'chat'} onNavigate={onNavigate}>
          {t('chat')}
        </Nav>
        <Nav href="/usage" icon={<BarChart3 size={17} />} selected={active === 'usage'} onNavigate={onNavigate}>
          {t('usage')}
        </Nav>
        <Nav href="/usage/live" icon={<Gauge size={17} />} selected={active === 'live-usage'} onNavigate={onNavigate}>
          {t('liveUsage')}
        </Nav>
        {roles.includes('ADMIN') && (
          <Nav href="/admin" icon={<ShieldCheck size={17} />} selected={active === 'admin'} onNavigate={onNavigate}>
            {t('admin')}
          </Nav>
        )}
        <Nav href="/settings" icon={<Settings size={17} />} selected={active === 'settings'} onNavigate={onNavigate}>
          {t('settings')}
        </Nav>
        <button
          onClick={() => auth.signoutRedirect()}
          className="flex w-full items-center gap-3 rounded-brand px-3 py-2 text-sm text-fg-secondary hover:bg-fill-tertiary"
        >
          <LogOut size={17} /> {t('logout')}
        </button>
      </nav>
      <div className="truncate px-5 pb-4 text-xs text-fg-secondary">
        {t('signedInAs', { username: auth.user?.profile.preferred_username ?? '' })}
      </div>
    </>
  );
}

function Nav({
  href,
  icon,
  selected,
  onNavigate,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  selected: boolean;
  onNavigate: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        'flex items-center gap-3 rounded-brand px-3 py-2 text-sm transition',
        selected ? 'bg-primary-soft font-medium text-primary' : 'text-fg-secondary hover:bg-fill-tertiary',
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
