import { theme } from 'antd';
import type { AppThemeConfig, BrandConfig } from '@/types/brand';
import { fontStack } from './font-families';
import type { ResolvedTheme } from './theme-mode';

/** Single source of truth: AntD reads this directly, Tailwind reads it through css-vars.ts. */
export function createAntdTheme(brand: BrandConfig, mode: ResolvedTheme): AppThemeConfig {
  const overrides = brand.theme[mode];
  return {
    // A per-mode key gives light and dark tokens different selectors. With a shared key,
    // the server-rendered light tokens would keep overriding dark ones after a client switch.
    cssVar: { key: `app-${mode}` },
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorPrimary: brand.theme.colorPrimary,
      colorLink: brand.theme.colorPrimary,
      borderRadius: brand.theme.borderRadius,
      fontFamily: fontStack(brand.theme.font),
      // Room for Thai vowels and tone marks, in every language so a language switch keeps sizes;
      // matches the Tailwind line heights in globals.css.
      lineHeight: 1.7,
      ...brand.theme.token,
      ...overrides?.token,
    },
    components: overrides?.components,
  };
}
