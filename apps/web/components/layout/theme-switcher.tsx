'use client';
import { Segmented } from 'antd';
import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemeMode } from '@/theme/theme-mode';
import { useThemeMode } from '@/theme/theme-mode-provider';

const options: Array<{ value: ThemeMode; label: string; icon: React.ReactNode }> = [
  { value: 'light', label: 'Light', icon: <Sun size={14} /> },
  { value: 'system', label: 'System', icon: <Monitor size={14} /> },
  { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
];

export function ThemeSwitcher() {
  const { mode, setMode } = useThemeMode();
  return (
    <Segmented<ThemeMode>
      size="small"
      aria-label="Theme"
      value={mode}
      onChange={setMode}
      options={options.map(({ value, label, icon }) => ({
        value,
        title: label,
        label: (
          <span className="flex h-6 items-center" aria-label={label}>
            {icon}
          </span>
        ),
      }))}
    />
  );
}
