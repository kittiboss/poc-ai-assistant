import type { ThemeConfig } from 'antd';
import type { Locale } from '@/i18n/config';
import type { BrandFontKey } from '@/theme/font-families';
import type { ThemeMode } from '@/theme/theme-mode';

/** Ant Design overrides for one mode, including component tokens such as Layout.siderBg. */
export type BrandModeTheme = Pick<ThemeConfig, 'token' | 'components'>;

/**
 * Everything that differs between customer installations. Keep it plain JSON (no functions or
 * imports) so it can later be loaded at runtime, e.g. from a file mounted at deploy time.
 */
export interface BrandConfig {
  /** Unique key; also the folder of its assets under public/brands */
  id: string;
  /** Product name shown in the UI and the browser tab */
  name: string;
  /** Organization that owns this installation */
  organization: string;
  logo: {
    /** Square mark shown next to the product name */
    icon: string;
  };
  favicon: string;
  defaultLocale: Locale;
  theme: {
    /** Used until the user picks a mode */
    defaultMode: ThemeMode;
    colorPrimary: string;
    /** Base corner radius in px; Ant Design derives the small and large radii from it */
    borderRadius: number;
    /** One of the fonts bundled in theme/fonts.ts */
    font: BrandFontKey;
    /** Ant Design token overrides for both modes */
    token?: ThemeConfig['token'];
    light?: BrandModeTheme;
    dark?: BrandModeTheme;
  };
}
