import { theme, type GlobalToken } from 'antd';
import type { BrandConfig } from '@/types/brand';
import { createAntdTheme } from './antd-theme';
import { fontStack } from './font-families';
import type { ResolvedTheme } from './theme-mode';

/**
 * AntD tokens exposed as --app-* CSS variables. globals.css maps them to Tailwind
 * colors, so `bg-primary` or `text-fg-secondary` always match AntD in both modes.
 * AntD v6 scopes its own variables to component classes, not :root, so they are computed here.
 */
const exposedTokens = {
  'color-primary': 'colorPrimary',
  'color-primary-hover': 'colorPrimaryHover',
  'color-primary-active': 'colorPrimaryActive',
  'color-primary-bg': 'colorPrimaryBg',
  'color-primary-bg-hover': 'colorPrimaryBgHover',
  'color-primary-border': 'colorPrimaryBorder',
  'color-primary-text': 'colorPrimaryText',
  'color-text-light-solid': 'colorTextLightSolid',
  'color-bg-layout': 'colorBgLayout',
  'color-bg-container': 'colorBgContainer',
  'color-bg-elevated': 'colorBgElevated',
  'color-fill': 'colorFill',
  'color-fill-secondary': 'colorFillSecondary',
  'color-fill-tertiary': 'colorFillTertiary',
  'color-fill-quaternary': 'colorFillQuaternary',
  'color-border': 'colorBorder',
  'color-border-secondary': 'colorBorderSecondary',
  'color-text': 'colorText',
  'color-text-secondary': 'colorTextSecondary',
  'color-text-tertiary': 'colorTextTertiary',
  'color-text-quaternary': 'colorTextQuaternary',
  'color-success': 'colorSuccess',
  'color-success-bg': 'colorSuccessBg',
  'color-success-text': 'colorSuccessText',
  'color-warning': 'colorWarning',
  'color-warning-bg': 'colorWarningBg',
  'color-warning-text': 'colorWarningText',
  'color-error': 'colorError',
  'color-error-hover': 'colorErrorHover',
  'color-error-bg': 'colorErrorBg',
  'color-error-border': 'colorErrorBorder',
  'color-error-text': 'colorErrorText',
  'color-info': 'colorInfo',
  'radius-sm': 'borderRadiusSM',
  radius: 'borderRadius',
  'radius-lg': 'borderRadiusLG',
} as const satisfies Record<string, keyof GlobalToken>;

function declarations(brand: BrandConfig, mode: ResolvedTheme): string {
  const config = createAntdTheme(brand, mode);
  const token = theme.getDesignToken(config);
  const layout = config.components?.Layout;
  const values: Record<string, string | number> = {
    ...Object.fromEntries(Object.entries(exposedTokens).map(([name, key]) => [name, token[key]])),
    // Sidebar and page headers: the brand's Layout tokens if set, otherwise plain containers.
    'color-bg-sider': layout?.siderBg ?? token.colorBgContainer,
    'color-bg-header': layout?.headerBg ?? token.colorBgContainer,
  };
  return Object.entries(values)
    .map(([name, value]) => `--app-${name}:${typeof value === 'number' ? `${value}px` : value};`)
    .join('');
}

/** Both modes are emitted, so switching theme is only a class toggle on <html>. */
export function buildThemeCss(brand: BrandConfig): string {
  return `:root{--app-font-sans:${fontStack(brand.theme.font)};${declarations(brand, 'light')}}:root.dark{${declarations(brand, 'dark')}}`;
}
