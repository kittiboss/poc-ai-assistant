'use client';
import { Avatar, Drawer, Dropdown, Grid, Tooltip, type MenuProps } from 'antd';
import {
  BarChart3,
  Gauge,
  LogOut,
  Menu,
  MoreVertical,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { flushSync } from 'react-dom';
import { useAuth } from 'react-oidc-context';
import { BrandLogo } from '@/components/brand/brand-logo';
import { useBrand } from '@/components/brand/brand-provider';
import { ChatSidebar, NewChatButton } from '@/features/chat/chat-sidebar';
import { useRoles } from '@/lib/auth/use-roles';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/ui-store-provider';

type Section = 'chat' | 'usage' | 'live-usage' | 'admin' | 'settings';

/** Same width as the desktop sidebar (w-72). */
const DRAWER_WIDTH = 288;

const iconButton =
  'grid h-10 w-10 shrink-0 place-items-center rounded-brand text-fg-secondary hover:bg-fill-tertiary cursor-pointer';

/**
 * md and up: the sidebar sits beside the page, open by default; the button at its top right folds it
 * into a narrow rail, whose logo opens it again. Below md: the open sidebar comes in a drawer from the
 * menu button in the header. Every page's sidebar has the chat list, so a chat is one click away, and
 * the other pages and logging out are in the account menu at its bottom. Pages without their own
 * `header` only get the header on small screens.
 */
export function Shell({
  children,
  active,
  header,
}: {
  children: React.ReactNode;
  active: Section;
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
              onNavigate={() => setMobileNavOpen(false)}
              onClose={() => toggleSidebar(false)}
              closeButtonRef={closeButton}
            />
          </div>
        ) : (
          <Rail active={active} onOpen={() => toggleSidebar(true)} openButtonRef={openButton} />
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
  onNavigate,
  onClose,
  closeButtonRef,
}: {
  active: Section;
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
      <ChatSidebar />
      <div className="border-t border-line-secondary p-2">
        <AccountMenu active={active} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/** The folded sidebar (md and up): New chat and the avatar that opens the account menu. */
function Rail({
  active,
  onOpen,
  openButtonRef,
}: {
  active: Section;
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
      <div className="flex flex-1 flex-col items-center gap-2 py-3">
        <NewChatButton collapsed />
      </div>
      <div className="pb-3">
        <AccountMenu active={active} collapsed />
      </div>
    </div>
  );
}

/**
 * The signed-in user, which opens the menu of pages and logging out (chats are in the sidebar). Kept in
 * one button so more pages never take room from the chat list. Folded, only the avatar shows and the
 * menu starts with the user.
 */
function AccountMenu({
  active,
  collapsed = false,
  onNavigate,
}: {
  active: Section;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const auth = useAuth();
  const router = useRouter();
  const roles = useRoles();
  const t = useTranslations('nav');
  const username = auth.user?.profile.preferred_username ?? '';
  const email = auth.user?.profile.email;

  const page = (key: Section, href: string, icon: React.ReactNode, label: string) => ({
    key,
    icon,
    label,
    onClick: () => {
      onNavigate?.();
      router.push(href);
    },
  });
  const items: MenuProps['items'] = [
    ...(collapsed
      ? [
          {
            key: 'user',
            type: 'group' as const,
            label: (
              <>
                <div className="truncate font-semibold text-fg">{username}</div>
                {email && <div className="truncate">{email}</div>}
              </>
            ),
          },
          { type: 'divider' as const },
        ]
      : []),
    page('usage', '/usage', <BarChart3 size={16} />, t('usage')),
    page('live-usage', '/usage/live', <Gauge size={16} />, t('liveUsage')),
    ...(roles.includes('ADMIN') ? [page('admin', '/admin', <ShieldCheck size={16} />, t('admin'))] : []),
    page('settings', '/settings', <Settings size={16} />, t('settings')),
    { type: 'divider' },
    { key: 'logout', icon: <LogOut size={16} />, label: t('logout'), onClick: () => auth.signoutRedirect() },
  ];

  return (
    <Dropdown
      trigger={['click']}
      placement={collapsed ? 'rightBottom' : 'topLeft'}
      menu={{ items, selectable: true, selectedKeys: [active] }}
      // As wide as the button in the open sidebar (18rem less the padding around it).
      classNames={{ root: collapsed ? 'min-w-60' : 'min-w-68' }}
    >
      <button
        type="button"
        className={cn(
          'flex cursor-pointer items-center rounded-brand text-left transition hover:bg-fill-tertiary [&.ant-dropdown-open]:bg-fill-tertiary',
          collapsed ? 'p-1' : 'w-full gap-3 px-2 py-1.5',
        )}
      >
        {/* No profile pictures yet, so the avatar is the username's first letter. */}
        <Avatar aria-hidden className="shrink-0 bg-primary font-semibold">
          {username.charAt(0).toUpperCase()}
        </Avatar>
        <span className="sr-only">{t('accountMenu')}</span>
        <span className={cn('min-w-0 flex-1', collapsed && 'sr-only')}>
          <span className="block truncate text-sm font-semibold">{username}</span>
          {email && <span className="block truncate text-xs text-fg-secondary">{email}</span>}
        </span>
        {!collapsed && <MoreVertical size={16} className="shrink-0 text-fg-tertiary" />}
      </button>
    </Dropdown>
  );
}
