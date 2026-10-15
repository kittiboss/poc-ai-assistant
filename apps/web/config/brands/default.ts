import type { BrandConfig } from '@/types/brand';

/** The product's own look. Token overrides keep the original slate palette in both modes. */
export const defaultBrand: BrandConfig = {
  id: 'default',
  name: 'Enterprise AI',
  organization: 'Enterprise AI',
  logo: { icon: '/brands/default/icon.svg' },
  favicon: '/brands/default/icon.svg',
  defaultLocale: 'en',
  theme: {
    defaultMode: 'light',
    colorPrimary: '#6d5dfc',
    borderRadius: 12,
    font: 'notoSansThai',
    // Status seeds from the original emerald/amber/red badges and alerts.
    token: { borderRadiusLG: 16, colorSuccess: '#10b981', colorWarning: '#f59e0b', colorError: '#ef4444' },
    light: {
      token: {
        colorTextBase: '#172033',
        colorText: '#172033',
        colorTextSecondary: '#64748b',
        colorTextTertiary: '#94a3b8',
        colorBgLayout: '#f7f8fc',
        colorBorder: '#cbd5e1',
        colorBorderSecondary: '#e2e8f0',
      },
    },
    dark: {
      token: {
        colorTextBase: '#eef1f7',
        colorText: '#eef1f7',
        colorTextSecondary: '#94a3b8',
        colorTextTertiary: '#64748b',
        colorBgBase: '#0d1017',
        colorBgLayout: '#0d1017',
        colorBgContainer: '#0f172a',
        colorBgElevated: '#1e293b',
        colorBorder: '#334155',
        colorBorderSecondary: '#1e293b',
      },
      components: { Layout: { siderBg: '#020617', headerBg: '#020617' } },
    },
  },
};
