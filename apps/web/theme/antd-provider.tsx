'use client';

import { XProvider } from '@ant-design/x';
import { App } from 'antd';
import { useLocale } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import { useBrand } from '@/components/brand/brand-provider';
import { antdLocales } from '@/i18n/antd-locale';
import dayjs from '@/i18n/dayjs';
import { createAntdTheme } from './antd-theme';
import { useThemeMode } from './theme-mode-provider';

/** XProvider is AntD's ConfigProvider plus Ant Design X settings. */
export function AntdProvider({ children }: { children: ReactNode }) {
  const brand = useBrand();
  const { resolvedTheme } = useThemeMode();
  const locale = useLocale();
  // DatePicker month and day names come from dayjs, which has one global locale.
  if (dayjs.locale() !== locale) dayjs.locale(locale);
  const themeConfig = useMemo(() => createAntdTheme(brand, resolvedTheme), [brand, resolvedTheme]);

  return (
    <XProvider theme={themeConfig} locale={antdLocales[locale]}>
      <App component={false}>{children}</App>
    </XProvider>
  );
}
