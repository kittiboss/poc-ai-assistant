import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The brand is resolved in one place so it can later come from runtime configuration.
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/config/brands', '@/config/brands/*'],
              message: 'Read the brand with useBrand(); only server entry points (see below) call getBrand().',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['app/layout.tsx', 'app/favicon.ico/route.ts', 'i18n/request.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // Playwright fixtures receive a `use` callback (not React's `use`) and take `{}` when they need nothing.
    files: ['e2e/**'],
    rules: { 'react-hooks/rules-of-hooks': 'off', 'no-empty-pattern': 'off' },
  },
  // Must come last: turns off rules that conflict with Prettier formatting.
  prettier,
  // Replaces the default ignores of eslint-config-next, so they are repeated here.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
