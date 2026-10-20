import { test as setup } from '@playwright/test';
import { accounts, sessionFile, signIn, type Account } from './fixtures';

// The app keeps its own session in sessionStorage, which a storage state cannot hold; the Keycloak
// session cookie it saves lets later tests sign in without the login form.
for (const account of Object.keys(accounts) as Account[]) {
  setup(`sign in as ${accounts[account].username}`, async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: 'NEXT_LOCALE', value: 'en', url: baseURL! }]);
    await signIn(page, account);
    await page.context().storageState({ path: sessionFile(account) });
  });
}
