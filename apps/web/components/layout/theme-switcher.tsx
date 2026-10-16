'use client';
import { Segmented } from 'antd';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ThemeMode } from '@/theme/theme-mode';
import { useThemeMode } from '@/theme/theme-mode-provider';

const options: Array<{ value: ThemeMode; icon: React.ReactNode }> = [
  { value: 'light', icon: <Sun size={14} /> },
  { value: 'system', icon: <Monitor size={14} /> },
  { value: 'dark', icon: <Moon size={14} /> },
];

export function ThemeSwitcher() {
  const t = useTranslations('theme');
  const { mode, setMode } = useThemeMode();
  return (
    <Segmented<ThemeMode>
      aria-label={t('label')}
      value={mode}
      onChange={setMode}
      options={options.map(({ value, icon }) => ({
        value,
        title: t(value),
        label: (
          <span className="flex items-center gap-1.5">
            {icon}
            {t(value)}
          </span>
        ),
      }))}
    />
  );
}
