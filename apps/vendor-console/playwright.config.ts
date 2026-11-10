import { defineConfig, devices } from '@playwright/test';

// The console under test talks to a throwaway vendor-control with its own Postgres (e2e/stack.mjs), never
// the platform's: the ledger and price history are append-only, so test writes would stay there for good.
// Sign-in uses the platform Keycloak's `vendor` realm, which only redirects back to http://localhost:4070:
// stop the platform's console container first (docker stop platform-vendor-console-1).
const CONSOLE_URL = 'http://localhost:4070';
// e2e/stack.mjs starts vendor-control here and checks that the console calls it.
const VENDOR_CONTROL_URL = 'http://localhost:4051';
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
  globalSetup: './e2e/stack.mjs',
  webServer: {
    // A production build; E2E_SKIP_BUILD=1 reuses the last one while writing tests.
    command: process.env.E2E_SKIP_BUILD ? 'npm run start' : 'npm run build && npm run start',
    url: CONSOLE_URL,
    // Never the platform's console container: that one writes to the real vendor-control.
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      CONSOLE_VENDOR_CONTROL_URL: VENDOR_CONTROL_URL,
      CONSOLE_KEYCLOAK_URL: 'http://localhost:8180',
      CONSOLE_KEYCLOAK_REALM: 'vendor',
      CONSOLE_OIDC_CLIENT_ID: 'vendor-console',
    },
  },
  use: {
    baseURL: CONSOLE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Signs in once; the tests reuse its Keycloak session.
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
