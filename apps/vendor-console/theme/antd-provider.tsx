'use client';

import { App, ConfigProvider } from 'antd';
import { useMemo, type ReactNode } from 'react';
import { antdTheme } from './antd-theme';
import { buildThemeCss } from './css-vars';

/** AntD's dark theme, plus the same tokens as --app-* variables for Tailwind. */
export function AntdProvider({ children }: { children: ReactNode }) {
  const css = useMemo(() => buildThemeCss(), []);
  return (
    <>
      <style href="console-theme" precedence="default">
        {css}
      </style>
      <ConfigProvider theme={antdTheme}>
        <App component={false}>{children}</App>
      </ConfigProvider>
    </>
  );
}
