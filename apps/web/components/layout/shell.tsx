'use client';
import Link from 'next/link';
import { BarChart3, Bot, LogOut, Settings, ShieldCheck, SunMoon } from 'lucide-react';
import { useAuth } from 'react-oidc-context';
import { BrandLogo } from '@/components/brand/brand-logo';
import { useBrand } from '@/components/brand/brand-provider';
import { cn } from '@/lib/cn';
import { ThemeSwitcher } from './theme-switcher';

export function Shell({
  children,
  active,
  sidebar,
}: {
  children: React.ReactNode;
  active: 'chat' | 'usage' | 'admin' | 'settings';
  sidebar?: React.ReactNode;
}) {
  const auth = useAuth();
  const brand = useBrand();
  const roles = (auth.user?.profile as { realm_access?: { roles?: string[] } })?.realm_access?.roles || [];
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line-secondary bg-sider">
        <div className="flex h-16 items-center gap-3 border-b border-line-secondary px-5">
          <BrandLogo size={36} decorative />
          <div>
            <div className="font-semibold">{brand.name}</div>
            <div className="text-[11px] text-fg-secondary">LOCAL POC</div>
          </div>
        </div>
        {sidebar || <div className="flex-1" />}
        <nav className="space-y-1 border-t border-line-secondary p-3">
          <Nav href="/" icon={<Bot size={17} />} selected={active === 'chat'}>
            Chat
          </Nav>
          <Nav href="/usage" icon={<BarChart3 size={17} />} selected={active === 'usage'}>
            Usage dashboard
          </Nav>
          {roles.includes('ADMIN') && (
            <Nav href="/admin" icon={<ShieldCheck size={17} />} selected={active === 'admin'}>
              Admin console
            </Nav>
          )}
          <Nav href="/settings" icon={<Settings size={17} />} selected={active === 'settings'}>
            Settings
          </Nav>
          <div className="flex items-center justify-between gap-3 py-1 pr-1 pl-3 text-sm text-fg-secondary">
            <span className="flex items-center gap-3">
              <SunMoon size={17} /> Theme
            </span>
            <ThemeSwitcher />
          </div>
          <button
            onClick={() => auth.signoutRedirect()}
            className="flex w-full items-center gap-3 rounded-brand px-3 py-2 text-sm text-fg-secondary hover:bg-fill-tertiary"
          >
            <LogOut size={17} /> Logout
          </button>
        </nav>
        <div className="px-5 pb-4 text-xs text-fg-secondary">
          Signed in as {auth.user?.profile.preferred_username as string}
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
function Nav({
  href,
  icon,
  selected,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
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
