'use client';

import { createContext, use, useCallback, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { getCookie, setCookie } from '@/lib/cookies';
import {
  DARK_MEDIA_QUERY,
  isThemeMode,
  resolveTheme,
  SYSTEM_THEME_COOKIE,
  THEME_COOKIE,
  type ResolvedTheme,
  type ThemeMode,
} from './theme-mode';

interface ThemeModeContextValue {
  /** What the user picked */
  mode: ThemeMode;
  /** What is actually shown */
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

// The chosen mode lives in a cookie (read by the server too); setMode notifies these listeners.
const modeListeners = new Set<() => void>();

function subscribeToMode(onChange: () => void) {
  modeListeners.add(onChange);
  return () => {
    modeListeners.delete(onChange);
  };
}

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_MEDIA_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

interface ThemeModeProviderProps {
  /** Mode from the cookie, or the brand default when there is none */
  initialMode: ThemeMode;
  /** OS preference from the cookie, used until the browser reports the real value */
  initialSystemTheme: ResolvedTheme;
  /** Brand default, used when the cookie is missing or invalid */
  defaultMode: ThemeMode;
  children: ReactNode;
}

export function ThemeModeProvider({ initialMode, initialSystemTheme, defaultMode, children }: ThemeModeProviderProps) {
  const readMode = useCallback(() => {
    const stored = getCookie(THEME_COOKIE);
    return isThemeMode(stored) ? stored : defaultMode;
  }, [defaultMode]);
  // Server snapshots match the server render; the browser values take over right after hydration.
  const mode = useSyncExternalStore(subscribeToMode, readMode, () => initialMode);
  const systemTheme = useSyncExternalStore(subscribeToSystemTheme, getSystemTheme, () => initialSystemTheme);
  const resolvedTheme = resolveTheme(mode, systemTheme);

  // Also re-applies the class after React's dev-mode remount resets <html> attributes.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  useLayoutEffect(() => {
    setCookie(SYSTEM_THEME_COOKIE, systemTheme);
  }, [systemTheme]);

  const setMode = useCallback((next: ThemeMode) => {
    setCookie(THEME_COOKIE, next);
    modeListeners.forEach((listener) => listener());
  }, []);

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode]);

  return <ThemeModeContext value={value}>{children}</ThemeModeContext>;
}

export function useThemeMode() {
  const context = use(ThemeModeContext);
  if (!context) throw new Error('useThemeMode must be used inside <ThemeModeProvider>');
  return context;
}
