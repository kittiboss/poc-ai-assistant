'use client';
import { Avatar, Drawer, Grid, Tooltip } from 'antd';
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
 * into a narrow rail of icons, whose logo opens it again. Below md: the open sidebar comes in a drawer
 * from the menu button in the header. Pages without their own `header` only get the header on small screens.
 */
export function Shell({
  children,
  active,
  sidebar,
  railActions,
  header,
}: {
  children: React.ReactNode;
  active: Section;
  /** The page's part of the open sidebar, between the brand and the menu */
  sidebar?: React.ReactNode;
  /** The page's icon buttons in the folded sidebar, in place of `sidebar` */
  railActions?: React.ReactNode;
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

  // Keyboard focus moves to the button that undoes the toggle instead of dropping to the page.
  // preventScroll: the sidebar is still changing width when the button gets focus.
  const toggleSidebar = (open: boolean) => {
    flushSync(() => setSidebarOpen(open));
    (open ? closeButton : openButton).current?.focus({ preventScroll: true });
  };

  return (
    <div className="flex h-dvh overflow-hidden pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <aside
        className={cn(
          'hidden shrink-0 overflow-hidden border-r border-line-secondary bg-sider transition-[width] duration-200 motion-reduce:transition-none md:block',
          sidebarOpen ? 'w-72' : 'w-16',
        )}
      >
        {sidebarOpen ? (
          // Fixed width, so the content slides in instead of reflowing while the sidebar widens.
          <div className="flex h-full w-72 flex-col">
            <Navigation
              active={active}
              sidebar={sidebar}
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => toggleSidebar(false)}
              closeButtonRef={closeButton}
            />
          </div>
        ) : (
          <Rail active={active} actions={railActions} onOpen={() => toggleSidebar(true)} openButtonRef={openButton} />
        )}
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
        <header className={cn('shrink-0 bg-header pt-[env(safe-area-inset-top)]', !header && 'md:hidden')}>
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

/** The open sidebar, beside the page or in the drawer. */
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
  const brand = useBrand();
  const t = useTranslations('nav');
  return (
    <>
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line-secondary px-3">
        <BrandLogo size={40} decorative />
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
        <NavItems active={active} onNavigate={onNavigate} />
      </nav>
      <UserProfile />
    </>
  );
}

/** The folded sidebar (md and up): the page's actions, the menu as icons and the user's avatar. */
function Rail({
  active,
  actions,
  onOpen,
  openButtonRef,
}: {
  active: Section;
  actions?: React.ReactNode;
  onOpen: () => void;
  openButtonRef: React.Ref<HTMLButtonElement>;
}) {
  const t = useTranslations('nav');
  return (
    <div className="flex h-full w-16 flex-col items-center">
      <div className="flex h-16 w-full shrink-0 items-center justify-center border-b border-line-secondary">
        <Tooltip title={t('openSidebar')} placement="right">
          {/* The brand's mark turns into the open icon on hover or keyboard focus. */}
          <button
            ref={openButtonRef}
            type="button"
            onClick={onOpen}
            aria-label={t('openSidebar')}
            className={cn(iconButton, 'group')}
          >
            <BrandLogo size={40} decorative className="group-hover:hidden group-focus-visible:hidden" />
            <PanelLeftOpen size={20} className="hidden group-hover:block group-focus-visible:block" />
          </button>
        </Tooltip>
      </div>
      <div className="flex flex-1 flex-col items-center gap-2 py-3">{actions}</div>
      <nav className="flex flex-col items-center gap-1 py-3">
        <NavItems active={active} collapsed />
      </nav>
      <UserProfile collapsed />
    </div>
  );
}

function NavItems({
  active,
  collapsed = false,
  onNavigate,
}: {
  active: Section;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const auth = useAuth();
  const t = useTranslations('nav');
  const roles = useRoles();
  const link = (section: Section, href: string, icon: React.ReactNode, label: string) => (
    <NavItem
      href={href}
      icon={icon}
      label={label}
      selected={active === section}
      collapsed={collapsed}
      onClick={onNavigate}
    />
  );
  return (
    <>
      {link('chat', '/', <Bot size={17} />, t('chat'))}
      {link('usage', '/usage', <BarChart3 size={17} />, t('usage'))}
      {link('live-usage', '/usage/live', <Gauge size={17} />, t('liveUsage'))}
      {roles.includes('ADMIN') && link('admin', '/admin', <ShieldCheck size={17} />, t('admin'))}
      {link('settings', '/settings', <Settings size={17} />, t('settings'))}
      <NavItem
        icon={<LogOut size={17} />}
        label={t('logout')}
        collapsed={collapsed}
        onClick={() => auth.signoutRedirect()}
      />
    </>
  );
}

/** A menu link, or a button without `href`. Folded, only its icon shows and the label is a tooltip. */
function NavItem({
  href,
  icon,
  label,
  selected = false,
  collapsed,
  onClick,
}: {
  href?: string;
  icon: React.ReactNode;
  label: string;
  selected?: boolean;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const className = cn(
    'flex items-center gap-3 rounded-brand text-sm transition',
    collapsed ? 'h-10 w-10 justify-center' : 'w-full px-3 py-2',
    selected ? 'bg-primary-soft font-medium text-primary' : 'text-fg-secondary hover:bg-fill-tertiary',
  );
  const content = (
    <>
      {icon}
      {!collapsed && label}
    </>
  );
  const ariaLabel = collapsed ? label : undefined;
  const item = href ? (
    <Link href={href} onClick={onClick} aria-label={ariaLabel} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className={className}>
      {content}
    </button>
  );
  return collapsed ? (
    <Tooltip title={label} placement="right">
      {item}
    </Tooltip>
  ) : (
    item
  );
}

/** The signed-in user, display only for now. Folded, only the avatar shows and the rest is a tooltip. */
function UserProfile({ collapsed = false }: { collapsed?: boolean }) {
  const auth = useAuth();
  const t = useTranslations('nav');
  const username = auth.user?.profile.preferred_username ?? '';
  const email = auth.user?.profile.email;
  const label = t('signedInAs', { username });
  // No profile pictures yet, so the avatar is the username's first letter.
  const initial = username.charAt(0).toUpperCase();

  if (collapsed)
    return (
      <div className="flex h-16 items-center pt-1 pb-4">
        <Tooltip
          placement="right"
          title={
            <>
              <div className="font-semibold">{username}</div>
              {email && <div className="text-xs">{email}</div>}
            </>
          }
        >
          <span role="img" aria-label={label} className="flex">
            <Avatar className="bg-primary font-semibold">{initial}</Avatar>
          </span>
        </Tooltip>
      </div>
    );
  return (
    <div role="group" aria-label={label} className="flex h-16 items-center gap-3 px-4 pt-1 pb-4">
      <Avatar aria-hidden className="shrink-0 bg-primary font-semibold">
        {initial}
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{username}</div>
        {email && <div className="truncate text-xs text-fg-secondary">{email}</div>}
      </div>
    </div>
  );
}
