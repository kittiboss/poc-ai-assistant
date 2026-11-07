'use client';

import { Drawer, Grid, Menu, Tag } from 'antd';
import { Menu as MenuIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { activeNavItem, navItems } from './nav-items';

const SIDEBAR_WIDTH = 240;

/**
 * md and up: the sidebar sits beside the page. Below md it comes in a drawer from the menu button
 * in the header. The header shows the current page's name.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const screens = Grid.useBreakpoint();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const active = activeNavItem(pathname);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className="hidden shrink-0 border-r border-line-secondary bg-sider md:block"
        style={{ width: SIDEBAR_WIDTH }}
      >
        <Navigation activeHref={active?.href} />
      </aside>
      <Drawer
        placement="left"
        size={SIDEBAR_WIDTH}
        // Closes by itself if the window grows to the desktop layout.
        open={drawerOpen && !screens.md}
        onClose={() => setDrawerOpen(false)}
        closable={false}
        styles={{ body: { padding: 0 } }}
      >
        <div className="h-full bg-sider">
          <Navigation activeHref={active?.href} onNavigate={() => setDrawerOpen(false)} />
        </div>
      </Drawer>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line-secondary bg-header px-3 md:h-16 md:px-6">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="-ml-1 grid h-10 w-10 cursor-pointer place-items-center rounded-brand text-fg-secondary hover:bg-fill-tertiary md:hidden"
          >
            <MenuIcon size={20} />
          </button>
          <h1 className="truncate text-base font-semibold md:text-lg">{active?.label ?? 'Vendor Console'}</h1>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}

function Navigation({ activeHref, onNavigate }: { activeHref?: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Console" className="flex h-full flex-col">
      {/* Same height as the page header, so their borders line up. */}
      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line-secondary px-4 md:h-16">
        {/* eslint-disable-next-line @next/next/no-img-element -- a 28px SVG needs no optimization */}
        <img src="/icon.svg" alt="" width={28} height={28} />
        <div className="min-w-0 leading-tight">
          <div className="truncate font-semibold">Vendor Console</div>
          <Tag variant="filled" color="warning" className="me-0 mt-0.5 text-[10px] leading-4">
            Simulation
          </Tag>
        </div>
      </div>
      <Menu
        mode="inline"
        className="flex-1 border-e-0! px-2 py-3"
        selectedKeys={activeHref ? [activeHref] : []}
        items={navItems.map(({ href, label, icon: Icon }) => ({
          key: href,
          icon: <Icon size={18} aria-hidden />,
          label: (
            <Link href={href} onClick={onNavigate}>
              {label}
            </Link>
          ),
        }))}
      />
    </nav>
  );
}
