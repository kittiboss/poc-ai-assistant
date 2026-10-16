'use client';

import type { ReactNode } from 'react';
import { ApiProvider } from '@/components/api/api-provider';
import { AuthProvider } from '@/components/auth/auth-provider';
import { BrandProvider } from '@/components/brand/brand-provider';
import { BrowserTimeZone } from '@/i18n/browser-time-zone';
import { UIStoreProvider } from '@/stores/ui-store-provider';
import { AntdProvider } from '@/theme/antd-provider';
import type { ResolvedTheme, ThemeMode } from '@/theme/theme-mode';
import { ThemeModeProvider } from '@/theme/theme-mode-provider';
import { ThemeStyles } from '@/theme/theme-styles';
import type { BrandConfig } from '@/types/brand';

/** Everything that wraps every page, including the sign-in screens of AuthGate. */
export function AppProviders({
  brand,
  initialMode,
  initialSystemTheme,
  children,
}: {
  brand: BrandConfig;
  initialMode: ThemeMode;
  initialSystemTheme: ResolvedTheme;
  children: ReactNode;
}) {
  return (
    <BrowserTimeZone>
      <BrandProvider brand={brand}>
        <ThemeStyles />
        <ThemeModeProvider
          initialMode={initialMode}
          initialSystemTheme={initialSystemTheme}
          defaultMode={brand.theme.defaultMode}
        >
          <AntdProvider>
            <UIStoreProvider>
              <AuthProvider>
                <ApiProvider>{children}</ApiProvider>
              </AuthProvider>
            </UIStoreProvider>
          </AntdProvider>
        </ThemeModeProvider>
      </BrandProvider>
    </BrowserTimeZone>
  );
}
