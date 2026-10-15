export const themeModes = ['light', 'dark', 'system'] as const;

export type ThemeMode = (typeof themeModes)[number];

export type ResolvedTheme = 'light' | 'dark';

/** The user's choice: light, dark, or system */
export const THEME_COOKIE = 'theme';
/** The OS preference, written on every visit so the server can render "system" correctly */
export const SYSTEM_THEME_COOKIE = 'theme-system';

export const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (themeModes as readonly string[]).includes(value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
  return value === 'light' || value === 'dark';
}

export function resolveTheme(mode: ThemeMode, systemTheme: ResolvedTheme): ResolvedTheme {
  return mode === 'system' ? systemTheme : mode;
}
