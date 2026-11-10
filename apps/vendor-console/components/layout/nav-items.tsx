import { BadgeDollarSign, Building2, Gauge, type LucideIcon } from 'lucide-react';

export type NavItem = { href: string; label: string; icon: LucideIcon };

/** The console's pages, in sidebar order. A page owns every URL below its href. */
export const navItems: NavItem[] = [
  { href: '/tenants', label: 'Tenants', icon: Building2 },
  { href: '/usage', label: 'Usage', icon: Gauge },
  { href: '/pricing', label: 'Pricing', icon: BadgeDollarSign },
];

export function activeNavItem(pathname: string): NavItem | undefined {
  return navItems.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`));
}
