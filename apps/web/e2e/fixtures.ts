import { expect, test as base, type Page } from '@playwright/test';
import path from 'node:path';
import en from '../messages/en.json';
import th from '../messages/th.json';

export { expect };
export type Messages = typeof en;
export const messages = { en, th } satisfies Record<string, Messages>;
export type AppLocale = keyof typeof messages;

/** Demo accounts of the development realm (infra/keycloak, listed in the README). */
export const accounts = {
  admin: { username: 'admin', password: 'Admin123!', email: 'admin@enterprise.local' },
  employee: { username: 'employee1', password: 'Employee123!', email: 'employee1@enterprise.local' },
} as const;
export type Account = keyof typeof accounts;

/** Keycloak's session cookie per account, saved by auth.setup.ts. */
export const sessionFile = (account: Account) => path.join(__dirname, '.auth', `${account}.json`);

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001/api';

/** The chat composer; it is on the page once the app has signed in. */
export const composer = (page: Page, m: Messages = en) => page.getByRole('textbox', { name: m.chat.messageLabel });

/** Goes through the app's sign-in screen and, without a Keycloak session, its login form. */
export async function signIn(page: Page, account: Account, m: Messages = en) {
  await page.goto('/');
  await page.getByRole('button', { name: m.auth.continue }).click();
  const form = page.locator('#kc-form-login');
  const app = composer(page, m);
  // With a saved Keycloak session the login form is skipped.
  await expect(form.or(app).first()).toBeVisible();
  if (await form.isVisible()) {
    await page.locator('#username').fill(accounts[account].username);
    await page.locator('#password').fill(accounts[account].password);
    await page.locator('#kc-login').click();
  }
  await expect(app).toBeVisible();
}

/** What the mock provider answers to any prompt. */
export const MOCK_REPLY = 'This is a mock AI response for local POC testing.';
export const CHAT_PATH = /\/c\/[0-9a-f-]{36}$/;

export const chatId = (page: Page) => new URL(page.url()).pathname.split('/c/')[1];
export const lastReply = (page: Page) => page.locator('.ant-bubble-start').last();

/** Exact, or it would also match a message's "Edit & resend". */
export const sendButton = (page: Page, m: Messages) => page.getByRole('button', { name: m.chat.send, exact: true });

/** The model field above the composer, and the box around it that shows the chosen model. */
export const modelField = (page: Page, m: Messages) => page.getByRole('combobox', { name: m.chat.chatModel });
export const chosenModel = (page: Page, m: Messages) =>
  page.locator('.ant-select').filter({ has: modelField(page, m) });

/** Types a prompt and sends it with Enter. */
export async function sendPrompt(page: Page, m: Messages, prompt: string) {
  await composer(page, m).fill(prompt);
  // Like the original app, sending waits until the model list has loaded and a model is chosen.
  await expect(sendButton(page, m)).toBeEnabled();
  await composer(page, m).press('Enter');
}

/** Sends the first message of a new chat and waits for the mock's whole reply; returns the chat id. */
export async function startChat(page: Page, m: Messages, createdChats: Set<string>, prompt: string) {
  await sendPrompt(page, m, prompt);
  await expect(page).toHaveURL(CHAT_PATH);
  const id = chatId(page);
  createdChats.add(id);
  await expect(lastReply(page)).toContainText(MOCK_REPLY);
  // The reply text arrives before the stream ends, and the composer ignores Enter until it has.
  await expect(page.getByRole('button', { name: m.chat.stop })).toHaveCount(0);
  return id;
}

/** Links of the chat list on screen: the sidebar, or the menu drawer on a phone. */
export const chatLinks = (page: Page) => page.locator('a[href^="/c/"]').filter({ visible: true });

/** A chat's row in the list on screen: its link and its ⋯ menu button. */
export const chatRow = (page: Page, id: string) =>
  page.locator(`a[href="/c/${id}"]`).filter({ visible: true }).locator('..');

/** Runs an item of a chat's ⋯ menu in the sidebar. */
export async function chatMenu(page: Page, m: Messages, id: string, item: string) {
  const row = chatRow(page, id);
  await row.hover();
  await row.getByRole('button', { name: m.chat.chatActions }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The account button at the bottom of the sidebar, or of the menu drawer on a phone. */
export const accountButton = (page: Page, m: Messages) => page.getByRole('button', { name: m.nav.accountMenu });

/** Runs an item of the account menu: a page, or logging out. */
export async function accountMenu(page: Page, m: Messages, item: string) {
  await accountButton(page, m).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** The access token the app holds in sessionStorage (oidc-client-ts). */
export const accessToken = (page: Page) =>
  page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((name) => name.startsWith('oidc.user:'));
    return key ? (JSON.parse(sessionStorage.getItem(key)!).access_token as string) : '';
  });

interface Options {
  /** The account the page is signed in with; null leaves it on the sign-in screen */
  account: Account | null;
  appLocale: AppLocale;
  /** Console errors a test causes on purpose */
  expectedErrors: RegExp[];
}

interface Fixtures {
  /** Texts in the page's language */
  m: Messages;
  /** Ids of chats the test created; they are deleted afterwards */
  createdChats: Set<string>;
  failOnConsoleErrors: void;
}

export const test = base.extend<Options & Fixtures>({
  account: ['admin', { option: true }],
  appLocale: ['en', { option: true }],
  expectedErrors: [[], { option: true }],
  m: async ({ appLocale }, use) => use(messages[appLocale]),

  storageState: async ({ account }, use) => use(account ? sessionFile(account) : { cookies: [], origins: [] }),
  context: async ({ context, appLocale, baseURL }, use) => {
    await context.addCookies([{ name: 'NEXT_LOCALE', value: appLocale, url: baseURL! }]);
    await use(context);
  },
  page: async ({ page, account, m }, use) => {
    if (account) await signIn(page, account, m);
    await use(page);
  },

  createdChats: async ({ page }, use) => {
    const ids = new Set<string>();
    await use(ids);
    if (!ids.size) return;
    const token = await accessToken(page);
    for (const id of ids)
      await page.request.delete(`${API_URL}/conversations/${id}`, { headers: { Authorization: `Bearer ${token}` } });
  },

  // Errors and warnings logged by the app fail the test; Keycloak's own pages are not checked.
  failOnConsoleErrors: [
    async ({ page, baseURL, expectedErrors }, use) => {
      const problems: string[] = [];
      page.on('console', (message) => {
        if (!['error', 'warning'].includes(message.type())) return;
        if (!message.location().url.startsWith(baseURL!)) return;
        if (expectedErrors.some((pattern) => pattern.test(message.text()))) return;
        problems.push(`${message.type()}: ${message.text()}`);
      });
      page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
      await use();
      expect(problems, 'console errors or warnings from the app').toEqual([]);
    },
    { auto: true },
  ],
});
