import { theme, type GlobalToken } from 'antd';
import { antdTheme } from './antd-theme';

/**
 * AntD tokens exposed as --app-* CSS variables. globals.css maps them to Tailwind colors, so
 * `bg-surface` or `text-fg-secondary` always match AntD. AntD v6 scopes its own variables to
 * component classes, not :root, so they are computed here.
 */
const exposedTokens = {
  'color-primary': 'colorPrimary',
  'color-primary-hover': 'colorPrimaryHover',
  'color-primary-bg': 'colorPrimaryBg',
  'color-primary-border': 'colorPrimaryBorder',
  'color-primary-text': 'colorPrimaryText',
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
  'color-success': 'colorSuccess',
  'color-warning': 'colorWarning',
  'color-error': 'colorError',
  'radius-sm': 'borderRadiusSM',
  radius: 'borderRadius',
  'radius-lg': 'borderRadiusLG',
  'font-sans': 'fontFamily',
} as const satisfies Record<string, keyof GlobalToken>;

export function buildThemeCss(): string {
  const token = theme.getDesignToken(antdTheme);
  const layout = antdTheme.components?.Layout;
  const values: Record<string, string | number> = {
    ...Object.fromEntries(Object.entries(exposedTokens).map(([name, key]) => [name, token[key]])),
    'color-bg-sider': layout?.siderBg ?? token.colorBgContainer,
    'color-bg-header': layout?.headerBg ?? token.colorBgContainer,
  };
  const declarations = Object.entries(values)
    .map(([name, value]) => `--app-${name}:${typeof value === 'number' ? `${value}px` : value};`)
    .join('');
  return `:root{${declarations}}`;
}
