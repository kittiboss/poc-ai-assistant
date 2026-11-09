import { expect, test as base, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { Tenant } from '../lib/api/types';

export { expect };

/** Set by e2e/stack.mjs (global setup) for every test. */
function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set: run the tests with \`playwright test\`, whose global setup sets it`);
  return value;
}

/** The throwaway vendor-control the console under test calls. */
export const vendorControlUrl = () => env('E2E_VENDOR_CONTROL_URL');

/** vendor-admin holds the console role; the other account, created for the run, does not. */
export type Account = 'staff' | 'noRole';
export const credentials = (account: Account) =>
  account === 'staff'
    ? { username: env('E2E_STAFF_USERNAME'), password: env('E2E_STAFF_PASSWORD') }
    : { username: env('E2E_NO_ROLE_USERNAME'), password: env('E2E_NO_ROLE_PASSWORD') };

/** Keycloak's session cookie of vendor-admin, saved by auth.setup.ts. */
export const sessionFile = path.join(__dirname, '.auth', 'staff.json');

/** The deployed customer e2e/stack.mjs seeds: $2 opening credit, and knowledge usage from the stub RAG engine. */
export const ACME = { id: 'acme', name: 'Acme Co', webPort: 3100, apiPort: 3101 } as const;

/** The page title in the header, on every screen size. */
export const pageTitle = (page: Page) => page.locator('header h1');
export const signInButton = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });

export async function fillLoginForm(page: Page, account: Account) {
  const { username, password } = credentials(account);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#kc-login').click();
}

/** Signs in as vendor-admin from the console's sign-in screen; with a Keycloak session the form is skipped. */
export async function signIn(page: Page, at = '/tenants') {
  await page.goto(at);
  await signInButton(page).click();
  const form = page.locator('#kc-form-login');
  await expect(form.or(pageTitle(page)).first()).toBeVisible();
  if (await form.isVisible()) await fillLoginForm(page, 'staff');
  await expect(pageTitle(page)).toBeVisible();
}

/** vendor-control's admin API, with the run's admin key: to set up and check what the console did. */
export async function admin<T>(path: string, { method = 'GET', body }: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${vendorControlUrl()}/admin${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env('E2E_ADMIN_KEY')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} /admin${path} failed (${response.status})`);
  return (await response.json()) as T;
}

export const tenantById = async (id: string) => (await admin<Tenant[]>('/tenants')).find((t) => t.id === id);

/** Runs a statement in the run's Postgres container and returns psql's unaligned output. */
export const sql = (statement: string) =>
  execFileSync('docker', ['exec', env('E2E_DB_CONTAINER'), 'psql', '-U', 'postgres', '-tAc', statement], {
    encoding: 'utf8',
  }).trim();

/** A refusal from vendor-control as the browser would receive it: JSON with CORS for the console. */
export const refusal = (status: number, message: string) => ({
  status,
  headers: { 'Access-Control-Allow-Origin': 'http://localhost:4070', 'Content-Type': 'application/json' },
  body: JSON.stringify({ error: { message } }),
});

/** The open dialog, its fields by label and their validation messages. */
export const dialog = (page: Page) => page.getByRole('dialog').last();
export const field = (page: Page, label: string) => dialog(page).getByLabel(label, { exact: true });
export const fieldError = (page: Page, text: string | RegExp) =>
  dialog(page).locator('.ant-form-item-explain-error').filter({ hasText: text });
export const toast = (page: Page, text: string | RegExp) =>
  page.locator('.ant-message-notice').filter({ hasText: text }).last();

/** The value of a labelled fact in a card. */
export const fact = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`);

/** The ledger tab on screen. */
export const openTab = (page: Page) => page.locator('[role=tabpanel]:visible');

interface Options {
  /** vendor-admin signs in before the test; null leaves the page on the sign-in screen */
  account: 'staff' | null;
  /** Console errors a test causes on purpose */
  expectedErrors: RegExp[];
}

interface Fixtures {
  /** A deployed customer of this test alone ($2 opening credit), for tests that change things */
  tenant: { id: string; name: string };
  failOnConsoleErrors: void;
}

export const test = base.extend<Options & Fixtures>({
  account: ['staff', { option: true }],
  expectedErrors: [[], { option: true }],

  storageState: async ({ account }, use) => use(account ? sessionFile : { cookies: [], origins: [] }),
  page: async ({ page, account }, use) => {
    if (account) await signIn(page);
    await use(page);
  },

  tenant: async ({}, use) => {
    const id = `t-${randomBytes(4).toString('hex')}`;
    // Below 3300, so the registration dialog's suggested port (after the highest) stays 3400.
    const webPort = 1100 + 2 * Math.floor(Math.random() * 900);
    const name = `Tenant ${id}`;
    await admin('/register', {
      method: 'POST',
      body: {
        config: {
          id,
          name,
          webPort,
          apiPort: webPort + 1,
          initialCreditUsd: 2,
          models: ['local-mock', 'mock-embedding', 'google-gemini'],
          dailyExternalLimits: { requests: 33, tokens: 33333 },
          embeddingBatch: { size: 8, intervalMs: 15500 },
        },
        key: `sk-${id}-console-e2e-only`,
        openingCredit: 2,
      },
    });
    await use({ id, name });
  },

  // Errors and warnings in the browser fail the test; Keycloak's own pages are not checked.
  failOnConsoleErrors: [
    async ({ page, expectedErrors }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (!['error', 'warning'].includes(message.type())) return;
        if (message.location().url.startsWith(env('E2E_KEYCLOAK_URL'))) return;
        if (expectedErrors.some((pattern) => pattern.test(message.text()))) return;
        problems.push(`${message.type()}: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      await use();
      expect(problems, 'console errors or warnings in the browser').toEqual([]);
    },
    { auto: true },
  ],
});
