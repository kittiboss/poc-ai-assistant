import {
  credentials,
  expect,
  fillLoginForm,
  pageTitle,
  refusal,
  signInButton,
  test,
  vendorControlUrl,
} from './fixtures';

test.describe('signed out', () => {
  // Each test signs in with the form, so it has a Keycloak session of its own.
  test.use({ account: null });

  test('signs in and returns to the page it started on', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('Sign in with your vendor staff account')).toBeVisible();
    await signInButton(page).click();
    await fillLoginForm(page, 'staff');
    await expect(pageTitle(page)).toHaveText('Pricing');
    await expect(page).toHaveURL(/\/pricing$/);
    // The session survives a reload.
    await page.reload();
    await expect(page.getByText('Current prices')).toBeVisible();
  });

  test('signing out ends the Keycloak session as well', async ({ page }) => {
    await page.goto('/tenants');
    await signInButton(page).click();
    await fillLoginForm(page, 'staff');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(signInButton(page)).toBeVisible();
    await signInButton(page).click();
    await expect(page.locator('#kc-form-login')).toBeVisible();
  });

  test('an account without the vendor-admin role has no access', async ({ page }) => {
    await page.goto('/tenants');
    await signInButton(page).click();
    await fillLoginForm(page, 'noRole');
    await expect(page.getByRole('heading', { name: 'No access' })).toBeVisible();
    await expect(page.getByText(credentials('noRole').username)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Console' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(signInButton(page)).toBeVisible();
  });
});

test.describe('a token vendor-control refuses', () => {
  test.use({ expectedErrors: [/status of 401/] });

  test('is renewed once, then the session ends', async ({ page }) => {
    let refused = 0;
    await page.route(`${vendorControlUrl()}/admin/**`, (route) => {
      refused++;
      return route.fulfill(refusal(401, 'Vendor authentication required'));
    });
    await page.reload();
    await expect(page.getByText('Your session has ended. Sign in again to continue.')).toBeVisible();
    expect(refused).toBeGreaterThanOrEqual(2);
  });
});
