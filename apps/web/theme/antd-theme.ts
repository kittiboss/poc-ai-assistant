import { theme, type ThemeConfig } from 'antd';
import type { BrandConfig } from '@/types/brand';
import { fontStack } from './font-families';
import type { ResolvedTheme } from './theme-mode';

/** Single source of truth: AntD reads this directly, Tailwind reads it through css-vars.ts. */
export function createAntdTheme(brand: BrandConfig, mode: ResolvedTheme): ThemeConfig {
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
      ...brand.theme.token,
      ...overrides?.token,
    },
    components: overrides?.components,
  };
}
