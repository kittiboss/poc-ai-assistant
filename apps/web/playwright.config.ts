import { defineConfig, devices } from '@playwright/test';

// The tests run against a stack that is already up (docker compose up). Keycloak's development
// client only redirects back to http://localhost:3000, so that is the default.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
// An installed browser instead of Playwright's Chromium, e.g. "msedge" or "chrome".
const channel = process.env.E2E_BROWSER_CHANNEL || undefined;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Signs in once per account; the tests reuse its Keycloak session.
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { channel } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel },
      dependencies: ['setup'],
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, channel },
      dependencies: ['setup'],
      testMatch: /(mobile|pages)\.spec\.ts/,
    },
  ],
});
