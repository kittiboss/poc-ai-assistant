import { test as setup } from '@playwright/test';
import { sessionFile, signIn } from './fixtures';

// The console keeps its own session in sessionStorage, which a storage state cannot hold; the Keycloak
// session cookie it saves lets the tests sign in without the login form.
setup('sign in as vendor-admin', async ({ page }) => {
  await signIn(page);
  await page.context().storageState({ path: sessionFile });
});
