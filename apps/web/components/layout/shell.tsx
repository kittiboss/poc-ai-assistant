'use client';
import { Drawer, Grid } from 'antd';
import Link from 'next/link';
import {
  BarChart3,
  Bot,
  Gauge,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from 'react-oidc-context';
import { BrandLogo } from '@/components/brand/brand-logo';
import { useBrand } from '@/components/brand/brand-provider';
import { useRoles } from '@/lib/auth/use-roles';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';

type Section = 'chat' | 'usage' | 'live-usage' | 'admin' | 'settings';

/** Same width as the desktop sidebar (w-72). */
const DRAWER_WIDTH = 288;

const iconButton = 'grid h-10 w-10 shrink-0 place-items-center rounded-brand text-fg-secondary hover:bg-fill-tertiary';

/**
 * md and up: the sidebar sits beside the page, open by default; the button at its top right folds it
 * away and a button in the header brings it back. Below md: the same sidebar opens in a drawer from
 * the menu button in the header. Pages without their own `header` only get the header on small screens
 * or while the sidebar is closed.
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
  const sidebarOpen = useUIStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const screens = Grid.useBreakpoint();
  const t = useTranslations('nav');
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // Keyboard focus follows the toggle between the sidebar and the header instead of dropping to the page.
  // preventScroll: the sidebar is still 0 px wide when its button gets focus.
  const toggleSidebar = (open: boolean) => {
    flushSync(() => setSidebarOpen(open));
    (open ? closeButton : openButton).current?.focus({ preventScroll: true });
  };

  return (
    <div className="flex h-dvh overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside
        // A closed sidebar keeps its content (and its scroll position) but is out of the tab order.
        inert={!sidebarOpen}
        className={cn(
          'hidden shrink-0 overflow-hidden transition-[width] duration-200 motion-reduce:transition-none md:block',
          sidebarOpen ? 'w-72' : 'w-0',
        )}
      >
        {/* Fixed width, so the content slides out instead of reflowing while the sidebar folds. */}
        <div className="flex h-full w-72 flex-col border-r border-line-secondary bg-sider">
          <Navigation
            active={active}
            sidebar={sidebar}
            onNavigate={() => setMobileNavOpen(false)}
            onClose={() => toggleSidebar(false)}
            closeButtonRef={closeButton}
          />
        </div>
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
          <Navigation
            active={active}
            sidebar={sidebar}
            onNavigate={() => setMobileNavOpen(false)}
            onClose={() => setMobileNavOpen(false)}
          />
        </div>
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className={cn('shrink-0 bg-header pt-[env(safe-area-inset-top)]', !header && sidebarOpen && 'md:hidden')}
        >
          {/* The border sits inside the fixed height so it lines up with the sidebar's top block. */}
          <div className="flex h-14 items-center gap-2 border-b border-line-secondary px-3 md:h-16 md:px-6">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label={t('openMenu')}
              className={cn(iconButton, '-ml-1 md:hidden')}
            >
              <Menu size={20} />
            </button>
            <button
              ref={openButton}
              type="button"
              onClick={() => toggleSidebar(true)}
              aria-label={t('openSidebar')}
              title={t('openSidebar')}
              className={cn(iconButton, '-ml-2 hidden', !sidebarOpen && 'md:grid')}
            >
              <PanelLeftOpen size={20} />
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
  onClose,
  closeButtonRef,
}: {
  active: Section;
  sidebar?: React.ReactNode;
  onNavigate: () => void;
  onClose: () => void;
  closeButtonRef?: React.Ref<HTMLButtonElement>;
}) {
  const auth = useAuth();
  const brand = useBrand();
  const t = useTranslations('nav');
  const roles = useRoles();
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line-secondary pr-3 pl-5">
        <BrandLogo size={36} decorative />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{brand.name}</div>
          <div className="text-[11px] text-fg-secondary">{t('tagline')}</div>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label={t('closeSidebar')}
          title={t('closeSidebar')}
          className={iconButton}
        >
          <PanelLeftClose size={20} />
        </button>
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
