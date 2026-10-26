import { accountButton, accountMenu, expect, messages, signIn, test } from './fixtures';

test.describe('signed out', () => {
  test.use({ account: null });

  test('signs in through Keycloak and out again', async ({ page, m }) => {
    await page.goto('/');
    await expect(page.getByText(m.auth.intro)).toBeVisible();

    // No saved session here, so this goes through the Keycloak login form.
    await signIn(page, 'admin', m);
    await expect(accountButton(page, m)).toContainText('admin');

    await accountMenu(page, m, m.nav.logout);
    await expect(page.getByRole('button', { name: m.auth.continue })).toBeVisible();
  });

  test('switches language on the sign-in screen', async ({ page, m }) => {
    await page.goto('/');
    await page.getByLabel(m.language.label).getByText('TH', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'th');
    await expect(page.getByRole('button', { name: messages.th.auth.continue })).toBeVisible();
  });
});

test('an administrator sees the admin console', async ({ page, m }) => {
  await accountMenu(page, m, m.nav.admin);
  await expect(page.getByRole('heading', { name: m.admin.title })).toBeVisible();
});

test.describe('employee', () => {
  test.use({ account: 'employee' });

  test('does not see the admin console', async ({ page, m }) => {
    await accountButton(page, m).click();
    await expect(page.getByRole('menuitem', { name: m.nav.settings })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: m.nav.admin })).toHaveCount(0);
  });
});
