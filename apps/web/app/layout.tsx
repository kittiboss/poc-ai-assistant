import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { getBrand } from '@/config/brands';
import { cn } from '@/lib/cn';
import { brandFontClassNames } from '@/theme/fonts';
import { isResolvedTheme, isThemeMode, resolveTheme, SYSTEM_THEME_COOKIE, THEME_COOKIE } from '@/theme/theme-mode';
import { themeInitScript } from '@/theme/theme-script';
import { AppProviders } from './providers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrand();
  const t = await getTranslations('meta');
  return {
    title: brand.name,
    description: t('description'),
    applicationName: brand.name,
    authors: [{ name: brand.organization }],
    icons: { icon: brand.favicon },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Draw under notches and home indicators; the shell pads with env(safe-area-inset-*).
  viewportFit: 'cover',
  // Android: shrink the layout when the keyboard opens so the chat input stays visible.
  interactiveWidget: 'resizes-content',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const brand = getBrand();
  const locale = await getLocale();
  // Rendering with the saved theme avoids a light-to-dark flash, which makes every page dynamic.
  const cookieStore = await cookies();
  const storedMode = cookieStore.get(THEME_COOKIE)?.value;
  const storedSystemTheme = cookieStore.get(SYSTEM_THEME_COOKIE)?.value;
  const initialMode = isThemeMode(storedMode) ? storedMode : brand.theme.defaultMode;
  const initialSystemTheme = isResolvedTheme(storedSystemTheme) ? storedSystemTheme : 'light';
  const dark = resolveTheme(initialMode, initialSystemTheme) === 'dark';

  return (
    // The inline script may change the class before React hydrates.
    <html lang={locale} className={cn(brandFontClassNames[brand.theme.font], dark && 'dark')} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript(brand.theme.defaultMode) }} />
      </head>
      <body>
        {/* `layer` puts AntD styles in @layer antd, ordered in globals.css */}
        <AntdRegistry layer>
          <NextIntlClientProvider>
            <AppProviders brand={brand} initialMode={initialMode} initialSystemTheme={initialSystemTheme}>
              {children}
            </AppProviders>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
