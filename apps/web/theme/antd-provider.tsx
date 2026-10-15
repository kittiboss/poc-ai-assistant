'use client';

import { XProvider } from '@ant-design/x';
import { App } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { useBrand } from '@/components/brand/brand-provider';
import { createAntdTheme } from './antd-theme';
import { useThemeMode } from './theme-mode-provider';

/** XProvider is AntD's ConfigProvider plus Ant Design X settings. */
export function AntdProvider({ children }: { children: ReactNode }) {
  const brand = useBrand();
  const { resolvedTheme } = useThemeMode();
  const themeConfig = useMemo(() => createAntdTheme(brand, resolvedTheme), [brand, resolvedTheme]);

  return (
    <XProvider theme={themeConfig}>
      <App component={false}>{children}</App>
    </XProvider>
  );
}
