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
              message: 'Read the brand with useBrand(); only app/layout.tsx calls getBrand().',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['app/layout.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  // Must come last: turns off rules that conflict with Prettier formatting.
  prettier,
  // Replaces the default ignores of eslint-config-next, so they are repeated here.
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
