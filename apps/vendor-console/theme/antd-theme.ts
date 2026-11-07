import { theme, type ThemeConfig } from 'antd';

/**
 * The console has one look: dark, with the product's violet and the slate palette of the web
 * app's default brand (apps/web/config/brands/default.ts). AntD reads it directly and Tailwind
 * reads it through css-vars.ts, so both always agree.
 */
export const antdTheme: ThemeConfig = {
  cssVar: { key: 'console' },
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#6d5dfc',
    colorLink: '#6d5dfc',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    borderRadius: 8,
    borderRadiusLG: 12,
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
  components: {
    Layout: { siderBg: '#020617', headerBg: '#020617' },
    // The sidebar menu sits on the sider color instead of the container color. The selected item keeps
    // its violet background but plain text: violet on violet is too faint on dark.
    Menu: { itemBg: 'transparent', itemSelectedColor: '#eef1f7' },
  },
};
