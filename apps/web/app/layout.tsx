import { AntdRegistry } from '@ant-design/nextjs-registry';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { getBrand } from '@/config/brands';
import { cn } from '@/lib/cn';
import { brandFontClassNames } from '@/theme/fonts';
import { isResolvedTheme, isThemeMode, resolveTheme, SYSTEM_THEME_COOKIE, THEME_COOKIE } from '@/theme/theme-mode';
import { themeInitScript } from '@/theme/theme-script';
import { AppProviders } from './providers';
import 'highlight.js/styles/github-dark.css';
import './globals.css';

export function generateMetadata(): Metadata {
  const brand = getBrand();
  return {
    title: brand.name,
    description: 'Self-hosted enterprise AI assistant POC',
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
  // Rendering with the saved theme avoids a light-to-dark flash, which makes every page dynamic.
  const cookieStore = await cookies();
  const storedMode = cookieStore.get(THEME_COOKIE)?.value;
  const storedSystemTheme = cookieStore.get(SYSTEM_THEME_COOKIE)?.value;
  const initialMode = isThemeMode(storedMode) ? storedMode : brand.theme.defaultMode;
  const initialSystemTheme = isResolvedTheme(storedSystemTheme) ? storedSystemTheme : 'light';
  const dark = resolveTheme(initialMode, initialSystemTheme) === 'dark';

  return (
    // The inline script may change the class before React hydrates; the UI text is English only.
    <html lang="en" className={cn(brandFontClassNames[brand.theme.font], dark && 'dark')} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript(brand.theme.defaultMode) }} />
      </head>
      <body>
        {/* `layer` puts AntD styles in @layer antd, ordered in globals.css */}
        <AntdRegistry layer>
          <AppProviders brand={brand} initialMode={initialMode} initialSystemTheme={initialSystemTheme}>
            {children}
          </AppProviders>
        </AntdRegistry>
      </body>
    </html>
  );
}
